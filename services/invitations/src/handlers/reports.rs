//! Reports (#468, #462, ADR 0015): the messages a recipient chose, sealed on
//! its device for the operator key, reach the service with a reason, and
//! leave it with a report number.
//!
//! - `POST /reports`, with the header `idempotency-key`:
//!   `{ "reason": <code>, "sealed": <base64> }`, answered
//!   `201 { "number": "K7QM-4ZT2" }`.
//!
//! # WHAT THE SERVICE KEEPS, AND WHAT IT NEVER LEARNS
//!
//! The number, the reporting account as the homeserver's `whoami` names the
//! caller's token, the reason's code, the sealed report as it came, the
//! instant it came, and the idempotency key it came with. The reported
//! account, the conversation and the messages are inside the sealed report,
//! which the operator alone opens, on its own machine: this service cannot.
//!
//! The reporting account is the caller, never a field of the body, and a body
//! with any field beside the reason and the sealed report is refused: nothing
//! in clear reaches the service by this route but the reason. The two travel
//! unsealed because the service keeps them, and the seal binds both
//! (`packages/app/src/runtime/reportFormat.ts`): a report kept under another
//! reason or another account does not open.
//!
//! # THE SAME REPORT, SENT AGAIN, IS KEPT ONCE
//!
//! The device draws an idempotency key for a report and sends it again with
//! every new attempt of the same report, as `POST /invitations` has one
//! (`handlers::create`, which says why a header). An answer lost after the
//! report was kept, then « Réessayer », finds the report the same account
//! already sent under that key: the service answers its number, and keeps
//! nothing more and tells the operator nothing more.
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
    handlers::create::extract_idempotency_key,
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
/// account, once per idempotency key, and answers its number.
pub async fn report(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
    Body(req): Body<ReportRequest>,
) -> Result<(StatusCode, Json<Reported>), AppError> {
    let reporter = auth::authenticate(&st.mx, &headers).await?;
    let key = extract_idempotency_key(&headers, PROTECTS_A_REPORT)?;
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
        key: &key,
        reason,
        sealed: &sealed,
        at,
    };
    let number = match insert_under_a_free_number(&st.pool, &received, ReportNumber::draw).await? {
        Kept::Now(number) => {
            // IN THE BACKGROUND: OVHcloud may take fifteen seconds to answer,
            // and the person is waiting for the number, not for the
            // operator's telephone.
            if let Some(reports) = Reports::new(vec![(number, reason)]) {
                let told = st.clone();
                tokio::spawn(async move {
                    alert::tell_the_operator(&told, &Alert::ReportsReceived(reports), at).await;
                });
            }
            number
        }
        Kept::Before(number) => number,
    };
    Ok((
        StatusCode::CREATED,
        Json(Reported {
            number: number.to_string(),
        }),
    ))
}

/// What the key of a report protects, said to a caller that sent none:
/// without it, an answer lost then a new attempt would keep the report twice,
/// and tell the operator twice. The key itself is read as a key of
/// `POST /invitations` is, by the one reading of both
/// (`extract_idempotency_key`).
const PROTECTS_A_REPORT: &str = "it keeps a report sent again from being kept twice";

/// A report as it is received, before it has a number.
struct Received<'a> {
    reporter: &'a str,
    key: &'a str,
    reason: Reason,
    sealed: &'a SealedReport,
    at: i64,
}

/// Where a report received stands once it is kept.
enum Kept {
    /// Kept now, under this number: the operator is to be told.
    Now(ReportNumber),
    /// Kept by an earlier attempt of the same account under the same key.
    Before(ReportNumber),
}

/// Inserts `received` under the first number `draw` gives that no report
/// holds, DRAWING AGAIN ON A COLLISION; or, when the same account already sent
/// a report under the same key, inserts nothing and answers that report's
/// number. The number is written as it is shown, `K7QM-4ZT2`.
///
/// The key is looked up before each insert: two attempts that cross both find
/// nothing, one inserts, and the other's insert, refused by the key's unique
/// index, finds it on its next turn.
async fn insert_under_a_free_number(
    pool: &SqlitePool,
    received: &Received<'_>,
    mut draw: impl FnMut() -> ReportNumber,
) -> Result<Kept, AppError> {
    for _ in 0..DRAWS {
        if let Some(number) = sent_before(pool, received).await? {
            return Ok(Kept::Before(number));
        }
        let number = draw();
        let written = sqlx::query(
            "INSERT INTO reports \
             (number, reporter_user_id, reason, sealed, received_at, idempotency_key) \
             VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING",
        )
        .bind(number.to_string())
        .bind(received.reporter)
        .bind(received.reason.code())
        .bind(received.sealed.bytes())
        .bind(received.at)
        .bind(received.key)
        .execute(pool)
        .await
        .map_err(anyhow::Error::from)?;
        if written.rows_affected() == 1 {
            return Ok(Kept::Now(number));
        }
    }
    Err(anyhow::anyhow!("no report number left free in {DRAWS} draws").into())
}

/// The number of the report `received`'s account already sent under its key,
/// if it did.
async fn sent_before(
    pool: &SqlitePool,
    received: &Received<'_>,
) -> Result<Option<ReportNumber>, AppError> {
    let kept: Option<String> = sqlx::query_scalar(
        "SELECT number FROM reports WHERE reporter_user_id = ? AND idempotency_key = ?",
    )
    .bind(received.reporter)
    .bind(received.key)
    .fetch_optional(pool)
    .await
    .map_err(anyhow::Error::from)?;
    kept.map(|number| {
        ReportNumber::parse(&number)
            .ok_or_else(|| anyhow::anyhow!("a report number kept does not read back").into())
    })
    .transpose()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::Config;
    use crate::handlers::create::IDEMPOTENCY_HEADER;
    use crate::handlers::discovery::test_support::{
        bearer, refusing_hs, state_from, whoami_hs, T0,
    };
    use crate::report::test_support::sealed_of;
    use crate::sms::test_support::{fake_ovhcloud, sms_through, Inbox, OPERATOR_NUMBER};
    use data_encoding::BASE64;
    use std::sync::Mutex;

    /// The strong suffix's alphabet, as #462 gives it: no 0, O, 1 or I.
    const ALPHABET: &str = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

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

    /// `who`'s token, and `key` as the report's idempotency key.
    fn keyed(who: &str, key: &str) -> HeaderMap {
        let mut headers = bearer(who);
        headers.insert(IDEMPOTENCY_HEADER, key.parse().unwrap());
        headers
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

    type Row = (String, String, String, Vec<u8>, i64, String);

    /// Every report the service keeps, as its columns hold it.
    async fn kept_rows(pool: &SqlitePool) -> Vec<Row> {
        sqlx::query_as(
            "SELECT number, reporter_user_id, reason, sealed, received_at, idempotency_key \
             FROM reports ORDER BY received_at, number",
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

    /// Long enough for an alert spawned by mistake to have reached the fake
    /// OVHcloud, which answers at once.
    async fn a_moment() {
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
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

        let (status, number) = sent(
            &st,
            keyed("alice", "report-key-1"),
            "harassment",
            &BASE64.encode(&sealed),
        )
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
                T0,
                "report-key-1".to_string()
            )]
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn a_report_keeps_its_number_account_reason_sealed_report_instant_and_key_and_nothing_else(
        pool: SqlitePool,
    ) {
        // #462: « rien d'autre que le motif, le compte qui signale et le pli
        // n'est enregistré », beside what makes a report findable once: its
        // number, its instant, the key of its sending. The reported account,
        // the conversation and the messages are in the sealed report, and no
        // column could hold them.
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
                "received_at",
                "idempotency_key"
            ]
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn the_same_report_sent_again_under_its_key_is_kept_once_and_told_once(pool: SqlitePool) {
        // An answer lost after the report was kept, then « Réessayer »: the
        // same number comes back, and nothing else is kept or told.
        let (st, inbox) = service(pool.clone()).await;
        let sealed = BASE64.encode(&sealed_of(1, 7));

        let (_, first) = sent(&st, keyed("alice", "report-key-1"), "threat", &sealed)
            .await
            .unwrap();
        let told_once = told(&inbox, 1).await;
        let (status, again) = sent(&st, keyed("alice", "report-key-1"), "threat", &sealed)
            .await
            .unwrap();
        a_moment().await;

        assert_eq!((status, &again), (StatusCode::CREATED, &first));
        assert_eq!(kept_rows(&pool).await.len(), 1);
        assert_eq!(
            told_once,
            [format!("Messagr : 1 signalement reçu : {first} (menace).")]
        );
        assert_eq!(told(&inbox, 2).await, told_once, "told once");
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn a_key_is_the_reporting_account_s_own(pool: SqlitePool) {
        // Another account's report under the same key is another report.
        let (st, _) = service(pool.clone()).await;
        let sealed = BASE64.encode(&sealed_of(1, 7));

        let (_, alice) = sent(&st, keyed("alice", "report-key-1"), "hate", &sealed)
            .await
            .unwrap();
        let (_, bob) = sent(&st, keyed("bob", "report-key-1"), "hate", &sealed)
            .await
            .unwrap();

        assert_ne!(alice, bob);
        assert_eq!(kept_rows(&pool).await.len(), 2);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn a_report_without_an_idempotency_key_of_the_expected_form_is_refused(pool: SqlitePool) {
        // The key is read as a key of `POST /invitations` is, by the one
        // reading of both (#491): the same bounds, and a caller that sent
        // none told what it protects here.
        let (st, inbox) = service(pool.clone()).await;
        let sealed = BASE64.encode(&sealed_of(1, 7));
        let too_long = "k".repeat(201);
        match sent(&st, bearer("alice"), "harassment", &sealed).await {
            Err(AppError::InvalidRequest(said)) => {
                assert!(said.contains("kept twice"), "{said}");
            }
            other => panic!("a report without a key must be refused, got {other:?}"),
        }
        for (what, headers) in [
            ("seven characters", keyed("alice", "7-chars")),
            ("201 characters", keyed("alice", &too_long)),
            ("a space", keyed("alice", "report key 1")),
        ] {
            let refused = sent(&st, headers, "harassment", &sealed).await;
            assert!(
                matches!(refused, Err(AppError::InvalidRequest(_))),
                "{what}"
            );
        }
        assert_eq!(kept_rows(&pool).await, []);
        a_moment().await;
        assert_eq!(told(&inbox, 0).await, Vec::<String>::new());
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
            let taken = sent(
                &st,
                keyed("alice", &format!("key-{reason}")),
                reason,
                &sealed,
            )
            .await;
            assert!(matches!(taken, Ok((StatusCode::CREATED, _))), "{reason}");
        }
        for reason in ["", "spam", "Threat", "harassment ", "other"] {
            let refused = sent(&st, keyed("alice", "key-refused"), reason, &sealed).await;
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
            let refused = sent(&st, keyed("alice", "report-key-1"), "harassment", &sealed).await;
            assert!(
                matches!(refused, Err(AppError::InvalidRequest(_))),
                "{what}"
            );
        }
        assert_eq!(kept_rows(&pool).await, []);
        a_moment().await;
        assert_eq!(told(&inbox, 0).await, Vec::<String>::new());
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn a_call_without_a_valid_token_is_refused_and_nothing_is_kept_or_told(pool: SqlitePool) {
        let (st, inbox) = service(pool.clone()).await;
        let sealed = BASE64.encode(&sealed_of(1, 7));
        let mut no_token = HeaderMap::new();
        no_token.insert(IDEMPOTENCY_HEADER, "report-key-1".parse().unwrap());
        assert!(matches!(
            sent(&st, no_token, "harassment", &sealed).await,
            Err(AppError::Unauthenticated)
        ));
        // A token the homeserver does not vouch for.
        let refusing = state_from(pool.clone(), refusing_hs().await, Config::for_tests());
        assert!(matches!(
            sent(
                &refusing,
                keyed("alice", "report-key-1"),
                "harassment",
                &sealed
            )
            .await,
            Err(AppError::Unauthenticated)
        ));
        // A homeserver nobody reaches says nothing of the token (#491): the
        // report is not refused, it is to be sent again, and nothing of it
        // is kept meanwhile.
        let unreachable = state_from(
            pool.clone(),
            "http://127.0.0.1:1".into(),
            Config::for_tests(),
        );
        assert!(matches!(
            sent(
                &unreachable,
                keyed("alice", "report-key-1"),
                "harassment",
                &sealed
            )
            .await,
            Err(AppError::HomeserverUnavailable)
        ));
        assert_eq!(kept_rows(&pool).await, []);
        a_moment().await;
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

        let (_, first) = sent(&st, keyed("alice", "report-key-1"), "harassment", &sealed)
            .await
            .unwrap();
        let after_the_first = told(&inbox, 1).await;
        let (_, second) = sent(&st, keyed("bob", "report-key-2"), "threat", &sealed)
            .await
            .unwrap();
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
        let received = |reporter, key| Received {
            reporter,
            key,
            reason: Reason::Harassment,
            sealed: &sealed,
            at: T0,
        };
        let first = insert_under_a_free_number(&pool, &received("@alice:h", "key-1"), || {
            number("K7QM-4ZT2")
        })
        .await
        .unwrap();
        let mut draws = [number("K7QM-4ZT2"), number("ABCD-EFGH")].into_iter();
        let second = insert_under_a_free_number(&pool, &received("@bob:h", "key-2"), || {
            draws.next().unwrap()
        })
        .await
        .unwrap();

        assert!(matches!(first, Kept::Now(n) if n == number("K7QM-4ZT2")));
        assert!(matches!(second, Kept::Now(n) if n == number("ABCD-EFGH")));
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
    /// reads the answer there: the status, the body, the same number for the
    /// same key, and the refusals made before the handler.
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
        let post = |body: serde_json::Value| {
            http.post(format!("{base}/reports"))
                .bearer_auth("alice")
                .header(IDEMPOTENCY_HEADER, "report-key-1")
                .json(&body)
                .send()
        };

        let taken = post(serde_json::json!({"reason": "hate", "sealed": sealed}))
            .await
            .unwrap();
        assert_eq!(taken.status(), StatusCode::CREATED);
        let body: serde_json::Value = taken.json().await.unwrap();
        let rows = kept_rows(&pool).await;
        assert_eq!(body, serde_json::json!({"number": rows[0].0}));
        let again = post(serde_json::json!({"reason": "hate", "sealed": sealed}))
            .await
            .unwrap();
        assert_eq!(again.status(), StatusCode::CREATED);
        assert_eq!(again.json::<serde_json::Value>().await.unwrap(), body);

        // The reporting account is the caller's: a body that names one, or
        // names the reported account or the conversation, is refused whole.
        for extra in [
            ("reporter", "@bob:h"),
            ("reported", "@carol:h"),
            ("room", "!r:h"),
        ] {
            let mut body = serde_json::json!({"reason": "hate", "sealed": sealed});
            body[extra.0] = serde_json::json!(extra.1);
            let refused = post(body).await.unwrap();
            assert_eq!(refused.status(), StatusCode::BAD_REQUEST, "{}", extra.0);
            let said: serde_json::Value = refused.json().await.unwrap();
            assert_eq!(said["errcode"], "M_INVALID_PARAM", "{}", extra.0);
        }

        let anonymous = http
            .post(format!("{base}/reports"))
            .header(IDEMPOTENCY_HEADER, "report-key-1")
            .json(&serde_json::json!({"reason": "hate", "sealed": sealed}))
            .send()
            .await
            .unwrap();
        assert_eq!(anonymous.status(), StatusCode::UNAUTHORIZED);
        let said: serde_json::Value = anonymous.json().await.unwrap();
        assert_eq!(said["errcode"], "M_UNAUTHORIZED");

        // A service whose homeserver nobody reaches answers 503, which the
        // application reads as « nothing kept, send it again » (#491).
        let away = crate::router(state_from(
            pool.clone(),
            "http://127.0.0.1:1".into(),
            Config::for_tests(),
        ));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let away_base = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(listener, away).await.unwrap() });
        let later = http
            .post(format!("{away_base}/reports"))
            .bearer_auth("alice")
            .header(IDEMPOTENCY_HEADER, "report-key-2")
            .json(&serde_json::json!({"reason": "hate", "sealed": sealed}))
            .send()
            .await
            .unwrap();
        assert_eq!(later.status(), StatusCode::SERVICE_UNAVAILABLE);
        let said: serde_json::Value = later.json().await.unwrap();
        assert_eq!(said["errcode"], "MESSAGR_UPSTREAM");

        assert_eq!(kept_rows(&pool).await.len(), 1);
    }
}
