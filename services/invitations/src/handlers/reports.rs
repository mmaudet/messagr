//! Reports (#468, #462, ADR 0015): the messages a recipient chose, sealed on
//! its device for the operator key, reach the service with a reason, and
//! leave it with a report number.
//!
//! - `POST /reports`: `{ "reason": <code>, "sealed": <base64> }`, answered
//!   `201 { "number": "K7QM-4ZT2" }`.
//!
//! # WHAT THE SERVICE KEEPS, AND WHAT IT NEVER LEARNS
//!
//! The number, the reporting account as the homeserver's `whoami` names the
//! caller's token, the reason's code, the sealed report as it came, and the
//! instant it came. The reported account, the conversation and the messages
//! are inside the sealed report, which the operator alone opens, on its own
//! machine: this service cannot.
//!
//! The reporting account is the caller, never a field of the body, and a body
//! with any field beside the reason and the sealed report is refused: nothing
//! in clear reaches the service by this route but the reason. The two travel
//! unsealed because the service keeps them, and the seal binds both
//! (`packages/app/src/runtime/reportFormat.ts`): a report kept under another
//! reason or another account does not open.
//!
//! # THE OPERATOR IS TOLD OF EACH REPORT
//!
//! By an SMS that names its number and its reason, nothing else (`alert`),
//! told in the background: the answer does not wait for OVHcloud.
//!
//! # WHAT IS NOT HERE YET
//!
//! The limit of ten a day and the grouping of the SMS (#478); the decision,
//! the export of a sealed report, and the erasing that follows a decision
//! (#473).

use std::sync::Arc;

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    Json,
};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use crate::{
    alert::{self, Alert},
    auth,
    error::AppError,
    extract::Body,
    report::{Reason, ReportNumber, Reports, SealedReport},
    AppState,
};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReportRequest {
    /// One of the eight codes of the terms (`Reason::code`).
    pub reason: String,
    /// The sealed report, in standard base64 (`SealedReport::from_base64`).
    pub sealed: String,
}

#[derive(Serialize)]
pub struct Reported {
    /// The report number, `K7QM-4ZT2`, which the person quotes to learn the
    /// decision.
    pub number: String,
}

/// How many numbers are drawn for one report before the service gives up:
/// with forty bits each, a second draw is already rare.
const DRAWS: usize = 8;

/// `POST /reports`: keeps a sealed report and its reason, for the calling
/// account, and answers its number.
pub async fn report(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
    Body(req): Body<ReportRequest>,
) -> Result<(StatusCode, Json<Reported>), AppError> {
    let reporter = auth::authenticate(&st.mx, &headers).await?;
    let reason = Reason::from_code(&req.reason).ok_or_else(|| {
        AppError::InvalidRequest("reason: not one of the eight codes of the terms".into())
    })?;
    let sealed = SealedReport::from_base64(&req.sealed).ok_or_else(|| {
        AppError::InvalidRequest(
            "sealed: not a sealed report of format 1 in standard base64, of one to sixteen \
             blocks"
                .into(),
        )
    })?;
    let at = st.cfg.clock.now();
    let received = Received {
        reporter: &reporter,
        reason,
        sealed: &sealed,
        at,
    };
    let number = kept(&st.pool, &received, ReportNumber::draw).await?;

    // IN THE BACKGROUND: OVHcloud may take fifteen seconds to answer, and the
    // person is waiting for the number, not for the operator's telephone.
    if let Some(reports) = Reports::new(vec![(number, reason)]) {
        let told = st.clone();
        tokio::spawn(async move {
            alert::tell_the_operator(&told, &Alert::ReportsReceived(reports), at).await;
        });
    }
    Ok((
        StatusCode::CREATED,
        Json(Reported {
            number: number.to_string(),
        }),
    ))
}

/// A report as it is received, before it has a number.
struct Received<'a> {
    reporter: &'a str,
    reason: Reason,
    sealed: &'a SealedReport,
    at: i64,
}

/// Keeps `received` under the first number `draw` gives that no report holds
/// yet, and answers it. The number is written as it is shown, `K7QM-4ZT2`.
async fn kept(
    pool: &SqlitePool,
    received: &Received<'_>,
    mut draw: impl FnMut() -> ReportNumber,
) -> Result<ReportNumber, AppError> {
    for _ in 0..DRAWS {
        let number = draw();
        let written = sqlx::query(
            "INSERT INTO reports (number, reporter_user_id, reason, sealed, received_at) \
             VALUES (?, ?, ?, ?, ?) ON CONFLICT(number) DO NOTHING",
        )
        .bind(number.to_string())
        .bind(received.reporter)
        .bind(received.reason.code())
        .bind(received.sealed.bytes())
        .bind(received.at)
        .execute(pool)
        .await
        .map_err(anyhow::Error::from)?;
        if written.rows_affected() == 1 {
            return Ok(number);
        }
    }
    Err(anyhow::anyhow!("no report number left free in {DRAWS} draws").into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::Config;
    use crate::handlers::discovery::test_support::{bearer, state_from, whoami_hs, T0};
    use crate::sms::test_support::{fake_ovhcloud, sms_through, Inbox, OPERATOR_NUMBER};
    use data_encoding::BASE64;
    use std::sync::Mutex;

    /// The strong suffix's alphabet, as #462 gives it: no 0, O, 1 or I.
    const ALPHABET: &str = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    /// A sealed report as `reportFormat.ts` lays one out: the format's
    /// number, a 32-byte encapsulated key, then `blocks` blocks of 4,096
    /// bytes and the 16-byte tag, every byte after the first `fill`. The
    /// service cannot tell it from one that opens, and has no need to.
    fn sealed_of(blocks: usize, fill: u8) -> Vec<u8> {
        let mut bytes = vec![0x01];
        bytes.resize(1 + 32 + blocks * 4096 + 16, fill);
        bytes
    }

    /// The service at `T0`, its homeserver reduced to `whoami`, telling the
    /// operator by SMS through a fake OVHcloud.
    async fn service(pool: SqlitePool) -> (Arc<AppState>, Arc<Mutex<Inbox>>) {
        let (ovh, inbox) = fake_ovhcloud(false).await;
        let hs = whoami_hs().await;
        let (clock, _) = crate::util::Clock::settable(T0);
        let st = state_from(
            pool,
            hs.clone(),
            Config {
                homeserver_url: hs,
                sms: sms_through(ovh),
                clock,
                ..Config::for_tests()
            },
        );
        (st, inbox)
    }

    /// The status and the number of a report sent with `headers`.
    async fn sent(
        st: &Arc<AppState>,
        headers: HeaderMap,
        reason: &str,
        sealed: &str,
    ) -> Result<(StatusCode, String), AppError> {
        report(
            State(st.clone()),
            headers,
            Body(ReportRequest {
                reason: reason.into(),
                sealed: sealed.into(),
            }),
        )
        .await
        .map(|(status, Json(reported))| (status, reported.number))
    }

    type Row = (String, String, String, Vec<u8>, i64);

    /// Every report the service keeps, as its columns hold it.
    async fn kept_rows(pool: &SqlitePool) -> Vec<Row> {
        sqlx::query_as(
            "SELECT number, reporter_user_id, reason, sealed, received_at FROM reports \
             ORDER BY received_at, number",
        )
        .fetch_all(pool)
        .await
        .unwrap()
    }

    /// The SMS that reached the operator's number once `count` of them have,
    /// or after two seconds: the alert is told in the background.
    async fn told(inbox: &Arc<Mutex<Inbox>>, count: usize) -> Vec<String> {
        for _ in 0..200 {
            if inbox.lock().unwrap().sent.len() >= count {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
        let inbox = inbox.lock().unwrap();
        for (to, _) in &inbox.sent {
            assert_eq!(to, &[OPERATOR_NUMBER]);
        }
        inbox.sent.iter().map(|(_, text)| text.clone()).collect()
    }

    fn number(typed: &str) -> ReportNumber {
        ReportNumber::parse(typed).unwrap()
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn a_sealed_report_is_kept_as_it_came_under_a_number_of_the_strong_suffix(
        pool: SqlitePool,
    ) {
        let (st, _) = service(pool.clone()).await;
        let sealed = sealed_of(1, 7);

        let (status, number) = sent(&st, bearer("alice"), "harassment", &BASE64.encode(&sealed))
            .await
            .unwrap();

        assert_eq!(status, StatusCode::CREATED);
        // #462: eight characters of the strong suffix, grouped by four.
        let (first, second) = number.split_once('-').expect(&number);
        for group in [first, second] {
            assert_eq!(group.len(), 4, "{number}");
            assert!(group.chars().all(|c| ALPHABET.contains(c)), "{number}");
        }
        // The account is the one the homeserver names the token for, the
        // sealed report is byte for byte what came, and the instant is the
        // service's own.
        assert_eq!(
            kept_rows(&pool).await,
            [(
                number,
                "@alice:h".to_string(),
                "harassment".to_string(),
                sealed,
                T0
            )]
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn a_report_keeps_its_number_its_account_its_reason_its_sealed_report_and_its_instant_and_nothing_else(
        pool: SqlitePool,
    ) {
        // #462: « rien d'autre que le motif, le compte qui signale et le pli
        // n'est enregistré ». The reported account, the conversation and the
        // messages are in the sealed report, and no column could hold them.
        let columns: Vec<String> =
            sqlx::query_scalar("SELECT name FROM pragma_table_info('reports')")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert_eq!(
            columns,
            [
                "number",
                "reporter_user_id",
                "reason",
                "sealed",
                "received_at"
            ]
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn every_reason_of_the_terms_is_taken_and_no_other(pool: SqlitePool) {
        let (st, _) = service(pool.clone()).await;
        let sealed = BASE64.encode(&sealed_of(1, 7));
        for reason in [
            "child_sexual_abuse",
            "threat",
            "harassment",
            "impersonation",
            "hate",
            "sexual_without_consent",
            "solicitation",
            "other_illegal",
        ] {
            let taken = sent(&st, bearer("alice"), reason, &sealed).await;
            assert!(matches!(taken, Ok((StatusCode::CREATED, _))), "{reason}");
        }
        for reason in ["", "spam", "Threat", "harassment ", "other"] {
            let refused = sent(&st, bearer("alice"), reason, &sealed).await;
            assert!(
                matches!(refused, Err(AppError::InvalidRequest(_))),
                "{reason:?}"
            );
        }
        let reasons: Vec<String> = kept_rows(&pool).await.into_iter().map(|r| r.2).collect();
        assert_eq!(reasons.len(), 8, "{reasons:?}");
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn a_sealed_report_the_format_does_not_write_is_refused_and_nothing_is_kept_or_told(
        pool: SqlitePool,
    ) {
        let (st, inbox) = service(pool.clone()).await;
        let mut another_format = sealed_of(1, 7);
        another_format[0] = 0x02;
        for (what, sealed) in [
            ("not base64", "!!!!".to_string()),
            (
                "without its padding",
                BASE64.encode(&sealed_of(1, 7)).replace('=', ""),
            ),
            ("another format's number", BASE64.encode(&another_format)),
            ("no block", BASE64.encode(&sealed_of(0, 7))),
            (
                "a block short of a byte",
                BASE64.encode(&sealed_of(1, 7)[..4144]),
            ),
            ("seventeen blocks", BASE64.encode(&sealed_of(17, 7))),
        ] {
            let refused = sent(&st, bearer("alice"), "harassment", &sealed).await;
            assert!(
                matches!(refused, Err(AppError::InvalidRequest(_))),
                "{what}"
            );
        }
        assert_eq!(kept_rows(&pool).await, []);
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        assert_eq!(told(&inbox, 0).await, Vec::<String>::new());
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn a_call_without_a_valid_token_is_refused_and_nothing_is_kept_or_told(pool: SqlitePool) {
        let (st, inbox) = service(pool.clone()).await;
        let sealed = BASE64.encode(&sealed_of(1, 7));
        assert!(matches!(
            sent(&st, HeaderMap::new(), "harassment", &sealed).await,
            Err(AppError::Unauthenticated)
        ));
        // A token the homeserver does not vouch for: here, one nobody answers.
        let unreachable = state_from(
            pool.clone(),
            "http://127.0.0.1:1".into(),
            Config::for_tests(),
        );
        assert!(matches!(
            sent(&unreachable, bearer("alice"), "harassment", &sealed).await,
            Err(AppError::Unauthenticated)
        ));
        assert_eq!(kept_rows(&pool).await, []);
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        assert_eq!(told(&inbox, 0).await, Vec::<String>::new());
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn each_report_tells_the_operator_its_number_and_its_reason_and_nothing_else(
        pool: SqlitePool,
    ) {
        // #462: « un SMS part à chaque signalement, avec le numéro et le
        // motif, sans contenu ».
        let (st, inbox) = service(pool.clone()).await;
        let sealed = BASE64.encode(&sealed_of(1, 7));

        let (_, first) = sent(&st, bearer("alice"), "harassment", &sealed)
            .await
            .unwrap();
        let after_the_first = told(&inbox, 1).await;
        let (_, second) = sent(&st, bearer("bob"), "threat", &sealed).await.unwrap();
        let after_the_second = told(&inbox, 2).await;

        assert_eq!(
            after_the_first,
            [format!(
                "Messagr : 1 signalement reçu : {first} (harcèlement)."
            )]
        );
        assert_eq!(
            after_the_second,
            [
                format!("Messagr : 1 signalement reçu : {first} (harcèlement)."),
                format!("Messagr : 1 signalement reçu : {second} (menace)."),
            ]
        );
        for text in after_the_second {
            assert!(!text.contains("alice") && !text.contains("bob"), "{text}");
        }
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn a_number_already_given_is_drawn_again(pool: SqlitePool) {
        let sealed = SealedReport::from_base64(&BASE64.encode(&sealed_of(1, 7))).unwrap();
        let received = |reporter| Received {
            reporter,
            reason: Reason::Harassment,
            sealed: &sealed,
            at: T0,
        };
        let first = kept(&pool, &received("@alice:h"), || number("K7QM-4ZT2"))
            .await
            .unwrap();
        let mut draws = [number("K7QM-4ZT2"), number("ABCD-EFGH")].into_iter();
        let second = kept(&pool, &received("@bob:h"), || draws.next().unwrap())
            .await
            .unwrap();

        assert_eq!((first, second), (number("K7QM-4ZT2"), number("ABCD-EFGH")));
        let kept: Vec<(String, String)> = kept_rows(&pool)
            .await
            .into_iter()
            .map(|row| (row.0, row.1))
            .collect();
        assert_eq!(
            kept,
            [
                ("ABCD-EFGH".to_string(), "@bob:h".to_string()),
                ("K7QM-4ZT2".to_string(), "@alice:h".to_string()),
            ]
        );
    }

    /// Through the service's own router and over HTTP, since the application
    /// reads the answer there: the status, the body, and the refusals made
    /// before the handler.
    #[sqlx::test(migrations = "./migrations")]
    async fn on_the_wire_a_report_answers_201_with_its_number_and_a_body_naming_anything_else_is_refused(
        pool: SqlitePool,
    ) {
        let (st, _) = service(pool.clone()).await;
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let app = crate::router(st);
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let http = reqwest::Client::new();
        let sealed = BASE64.encode(&sealed_of(1, 7));

        let taken = http
            .post(format!("{base}/reports"))
            .bearer_auth("alice")
            .json(&serde_json::json!({"reason": "hate", "sealed": sealed}))
            .send()
            .await
            .unwrap();
        assert_eq!(taken.status(), StatusCode::CREATED);
        let body: serde_json::Value = taken.json().await.unwrap();
        let rows = kept_rows(&pool).await;
        assert_eq!(body, serde_json::json!({"number": rows[0].0}));

        // The reporting account is the caller's: a body that names one, or
        // names the reported account or the conversation, is refused whole.
        for extra in [
            ("reporter", "@bob:h"),
            ("reported", "@carol:h"),
            ("room", "!r:h"),
        ] {
            let mut body = serde_json::json!({"reason": "hate", "sealed": sealed});
            body[extra.0] = serde_json::json!(extra.1);
            let refused = http
                .post(format!("{base}/reports"))
                .bearer_auth("alice")
                .json(&body)
                .send()
                .await
                .unwrap();
            assert_eq!(refused.status(), StatusCode::BAD_REQUEST, "{}", extra.0);
            let said: serde_json::Value = refused.json().await.unwrap();
            assert_eq!(said["errcode"], "M_INVALID_PARAM", "{}", extra.0);
        }

        let anonymous = http
            .post(format!("{base}/reports"))
            .json(&serde_json::json!({"reason": "hate", "sealed": sealed}))
            .send()
            .await
            .unwrap();
        assert_eq!(anonymous.status(), StatusCode::UNAUTHORIZED);
        let said: serde_json::Value = anonymous.json().await.unwrap();
        assert_eq!(said["errcode"], "M_UNAUTHORIZED");

        assert_eq!(kept_rows(&pool).await.len(), 1);
    }
}
