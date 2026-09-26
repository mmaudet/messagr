//! Address-book discovery: proving a number (#397, #392, ADR 0014).
//!
//! Four routes, all authenticated by the account's Matrix token like the
//! others:
//!
//! - `GET /discovery/state`: whether discovery is served here, whether this
//!   account is findable and until when, and the countries whose numbers can
//!   be proved, each with its SMS provider, so the number screen can say both
//!   before anything is sent;
//! - `POST /discovery/proofs`: a number, in international form. The service
//!   masks it, keeps the mask and a digest of a fresh code, and sends the code
//!   by SMS. The number itself is forgotten when the request ends;
//! - `POST /discovery/proofs/finish`: the code. Right, the account becomes
//!   findable for 28 days, and the number stops making any other account
//!   findable: the last proof wins, and the account it replaces is told;
//! - `DELETE /discovery/number`: the account stops being findable at once.
//!   Its mask stays thirty days at the service, like that of a proof run
//!   out (#398).
//!
//! # WHAT THE SERVICE KEEPS OF A NUMBER
//!
//! Its mask under the current key, nothing else: not the number, not the
//! code, not the SMS. The number leaves the service once, towards the SMS
//! provider named on the number screen.

use std::sync::Arc;

use axum::{extract::State, http::HeaderMap, Json};
use serde::{Deserialize, Serialize};

use crate::{auth, countries as country, crypto, error::AppError, extract::Body, sms, AppState};

/// How long a code stays good: said to the provider as well, which does not
/// deliver it later.
const CODE_LIFETIME_MINUTES: i64 = 10;
const CODE_LIFETIME_SECONDS: i64 = CODE_LIFETIME_MINUTES * 60;
/// How many wrong codes end a proof.
const ATTEMPTS: u32 = 5;
/// How long a proof lasts: the shortest month, since a number can change hands
/// a month after it is given up (#392, Q36).
pub const PROOF_LIFETIME_SECONDS: i64 = 28 * 86_400;

#[derive(Serialize)]
pub struct OpenCountry {
    pub code: String,
    pub prefix: String,
    pub provider: &'static str,
}

#[derive(Deserialize)]
pub struct StartRequest {
    pub number: String,
    /// The application's language, for the SMS. Anything else reads French.
    #[serde(default)]
    pub language: String,
}

#[derive(Serialize)]
pub struct Started {
    pub provider: &'static str,
    pub expires_in: i64,
}

pub async fn start_proof(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
    Body(req): Body<StartRequest>,
) -> Result<Json<Started>, AppError> {
    let user = auth::authenticate(&st.mx, &headers).await?;
    let (keys, ovhcloud) = served(&st)?;
    if !country::is_international(&req.number) {
        return Err(AppError::NotANumber);
    }
    let open =
        country::open_country(&st.cfg.countries, &req.number).ok_or(AppError::CountryClosed)?;
    // WHO SENDS IS THE COUNTRY'S PROVIDER. One today; a second one (Q24)
    // gets its arm here, and the compiler asks for it.
    let sender = match open.provider {
        country::Provider::Ovhcloud => ovhcloud,
    };
    let key = keys.current();
    let mask = key
        .mask(req.number.as_bytes())
        .map_err(|e| anyhow::anyhow!("masking a number: {e}"))?;
    let code = crypto::proof_code();
    let now = st.cfg.clock.now();

    // ONE PROOF IN PROGRESS PER ACCOUNT: asking again replaces the code, and
    // the attempts start over with it.
    sqlx::query(
        "INSERT INTO pending_proofs (user_id, key_id, mask, code_digest, attempts, expires_at) \
         VALUES (?, ?, ?, ?, 0, ?) \
         ON CONFLICT(user_id) DO UPDATE SET key_id = excluded.key_id, mask = excluded.mask, \
           code_digest = excluded.code_digest, attempts = 0, expires_at = excluded.expires_at",
    )
    .bind(&user)
    .bind(i64::from(key.id()))
    .bind(mask.to_vec())
    .bind(crypto::proof_code_digest(&st.cfg.encryption_key, &user, &code).to_vec())
    .bind(now + CODE_LIFETIME_SECONDS)
    .execute(&st.pool)
    .await
    .map_err(anyhow::Error::from)?;

    // THE ONE PLACE THE NUMBER LEAVES THE SERVICE. A refused or lost send
    // withdraws the proof it was for: nobody holds its code. The job's id,
    // on success, is what #399 deletes the SMS at OVHcloud by.
    let message = sms::proof_message(&req.language, &code);
    if let Err(refused) = sender
        .send(&req.number, &message, CODE_LIFETIME_MINUTES, now)
        .await
    {
        tracing::warn!("a proof's code was not sent: {refused}");
        forget_the_proof(&st, &user).await?;
        return Err(AppError::SmsNotSent);
    }
    Ok(Json(Started {
        provider: open.provider.name(),
        expires_in: CODE_LIFETIME_SECONDS,
    }))
}

#[derive(Deserialize)]
pub struct FinishRequest {
    pub code: String,
}

#[derive(Serialize)]
pub struct Findable {
    pub findable_until: i64,
}

pub async fn finish_proof(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
    Body(req): Body<FinishRequest>,
) -> Result<Json<Findable>, AppError> {
    let user = auth::authenticate(&st.mx, &headers).await?;
    served(&st)?;
    let now = st.cfg.clock.now();
    let pending: Option<(i64, Vec<u8>, Vec<u8>, i64)> = sqlx::query_as(
        "SELECT key_id, mask, code_digest, expires_at FROM pending_proofs WHERE user_id = ?",
    )
    .bind(&user)
    .fetch_optional(&st.pool)
    .await
    .map_err(anyhow::Error::from)?;
    let Some((key_id, mask, digest, expires_at)) = pending else {
        return Err(AppError::NoProofPending);
    };
    if expires_at <= now {
        forget_the_proof(&st, &user).await?;
        return Err(AppError::CodeExpired);
    }
    let given = crypto::proof_code_digest(&st.cfg.encryption_key, &user, req.code.trim());
    if !crypto::equal_in_constant_time(&digest, &given) {
        // COUNTED IN ONE STATEMENT, so two answers sent together cannot both
        // read the same count.
        let used: i64 = sqlx::query_scalar(
            "UPDATE pending_proofs SET attempts = attempts + 1 WHERE user_id = ? \
             RETURNING attempts",
        )
        .bind(&user)
        .fetch_one(&st.pool)
        .await
        .map_err(anyhow::Error::from)?;
        let left = i64::from(ATTEMPTS) - used;
        if left <= 0 {
            forget_the_proof(&st, &user).await?;
        }
        return Err(AppError::CodeWrong {
            attempts_left: u32::try_from(left.max(0)).unwrap_or(0),
        });
    }

    // THE LAST PROOF WINS. The number stops making anybody else findable, and
    // this account stops being findable by any other number. The account it
    // made findable until now is told, at its next reading (#398).
    let until = now + PROOF_LIFETIME_SECONDS;
    let mut tx = st.pool.begin().await.map_err(anyhow::Error::from)?;
    // A NUMBER HOLDS ONE ROW, whoever proved it (the table's key), so there
    // is at most one account to tell. Told whether its proof was still
    // running or had run out: either way, the number now leads to somebody
    // else. An account that withdrew its number has nothing to be told.
    let replaced: Option<String> = sqlx::query_scalar(
        "SELECT user_id FROM findable_numbers WHERE key_id = ? AND mask = ? \
         AND user_id <> ? AND withdrawn_at IS NULL",
    )
    .bind(key_id)
    .bind(&mask)
    .bind(&user)
    .fetch_optional(&mut *tx)
    .await
    .map_err(anyhow::Error::from)?;
    if let Some(other) = replaced {
        sqlx::query(
            "INSERT INTO replaced_proofs (user_id, replaced_at) VALUES (?, ?) \
             ON CONFLICT(user_id) DO UPDATE SET replaced_at = excluded.replaced_at",
        )
        .bind(other)
        .bind(now)
        .execute(&mut *tx)
        .await
        .map_err(anyhow::Error::from)?;
    }
    // THE SAME ACCOUNT PROVING THE SAME NUMBER KEEPS ITS REFERENCE. Whoever
    // already found it must not read a renewal as a number that changed
    // hands (#392, #407); another number, or another account, gets a new one.
    let kept_reference: Option<String> = sqlx::query_scalar(
        "SELECT reference FROM findable_numbers WHERE key_id = ? AND mask = ? AND user_id = ?",
    )
    .bind(key_id)
    .bind(&mask)
    .bind(&user)
    .fetch_optional(&mut *tx)
    .await
    .map_err(anyhow::Error::from)?;
    sqlx::query("DELETE FROM replaced_proofs WHERE user_id = ?")
        .bind(&user)
        .execute(&mut *tx)
        .await
        .map_err(anyhow::Error::from)?;
    sqlx::query("DELETE FROM findable_numbers WHERE (key_id = ? AND mask = ?) OR user_id = ?")
        .bind(key_id)
        .bind(&mask)
        .bind(&user)
        .execute(&mut *tx)
        .await
        .map_err(anyhow::Error::from)?;
    sqlx::query(
        "INSERT INTO findable_numbers (key_id, mask, user_id, reference, proven_at, expires_at) \
         VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(key_id)
    .bind(&mask)
    .bind(&user)
    .bind(kept_reference.unwrap_or_else(|| uuid::Uuid::new_v4().simple().to_string()))
    .bind(now)
    .bind(until)
    .execute(&mut *tx)
    .await
    .map_err(anyhow::Error::from)?;
    sqlx::query("DELETE FROM pending_proofs WHERE user_id = ?")
        .bind(&user)
        .execute(&mut *tx)
        .await
        .map_err(anyhow::Error::from)?;
    tx.commit().await.map_err(anyhow::Error::from)?;
    Ok(Json(Findable {
        findable_until: until,
    }))
}

#[derive(Serialize)]
pub struct DiscoveryState {
    /// Whether this service holds its masking keys and its SMS provider.
    pub on: bool,
    pub findable_until: Option<i64>,
    /// Why an account that was findable is not any more, for thirty days
    /// (#398).
    pub ended: Option<Ended>,
    pub countries: Vec<OpenCountry>,
}

/// How being findable ended: the proof ran out, the number was withdrawn, or
/// another account proved it since.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Ended {
    Expired,
    Withdrawn,
    Replaced,
}

pub async fn state(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<DiscoveryState>, AppError> {
    let user = auth::authenticate(&st.mx, &headers).await?;
    let now = st.cfg.clock.now();
    let proof: Option<(i64, Option<i64>)> =
        sqlx::query_as("SELECT expires_at, withdrawn_at FROM findable_numbers WHERE user_id = ?")
            .bind(&user)
            .fetch_optional(&st.pool)
            .await
            .map_err(anyhow::Error::from)?;
    let replaced: bool =
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM replaced_proofs WHERE user_id = ?)")
            .bind(&user)
            .fetch_one(&st.pool)
            .await
            .map_err(anyhow::Error::from)?;
    let (findable_until, ended) = match proof {
        Some((until, None)) if until > now => (Some(until), None),
        Some((_, Some(_))) => (None, Some(Ended::Withdrawn)),
        Some((_, None)) => (None, Some(Ended::Expired)),
        None if replaced => (None, Some(Ended::Replaced)),
        None => (None, None),
    };
    Ok(Json(DiscoveryState {
        on: st.cfg.discovery().is_ok(),
        findable_until,
        ended,
        countries: st
            .cfg
            .countries
            .iter()
            .map(|c| OpenCountry {
                code: c.code.clone(),
                prefix: c.prefix.clone(),
                provider: c.provider.name(),
            })
            .collect(),
    }))
}

/// `DELETE /discovery/number`: this account stops being findable at once.
///
/// Its mask stays at the service for thirty days, as a proof that ran out
/// does (`cleanup::purge_ended_proofs`), and a proof in progress is dropped.
/// Nothing to withdraw is not a refusal: the answer is the same, and so is
/// what is left. Served even with discovery off, so that a number can always
/// be withdrawn.
pub async fn withdraw_number(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<axum::http::StatusCode, AppError> {
    let user = auth::authenticate(&st.mx, &headers).await?;
    let now = st.cfg.clock.now();
    sqlx::query(
        "UPDATE findable_numbers SET withdrawn_at = ?1, expires_at = MIN(expires_at, ?1) \
         WHERE user_id = ?2 AND withdrawn_at IS NULL",
    )
    .bind(now)
    .bind(&user)
    .execute(&st.pool)
    .await
    .map_err(anyhow::Error::from)?;
    forget_the_proof(&st, &user).await?;
    Ok(axum::http::StatusCode::NO_CONTENT)
}

/// Refuses when a mask still in service was made with a key that
/// `MASKING_KEYS` does not hold, naming the key number and never a key.
///
/// ABSENT KEYS LEAVE DISCOVERY OFF ONLY WHILE THERE IS NOTHING TO LOSE. Once a
/// number is proven, its mask is useless without the key it was made with: a
/// variable dropped, or a key renumbered, while the environment file is being
/// edited would leave every findable account unfindable without a word. So the
/// service refuses to start instead, until the key is back, until the masks
/// made with it have run out, or until they are deleted, which is how a key is
/// retired at once (ADR 0014's emergency, `deploy/messagr-eu-invitations.md`,
/// and #409 after it).
pub async fn keys_of_live_masks_are_held(
    pool: &sqlx::SqlitePool,
    keys: Option<&crate::masking::MaskingKeys>,
    now: i64,
) -> anyhow::Result<()> {
    let in_service: Vec<i64> = sqlx::query_scalar(
        "SELECT key_id FROM findable_numbers WHERE expires_at > ?1 \
         UNION SELECT key_id FROM pending_proofs WHERE expires_at > ?1",
    )
    .bind(now)
    .fetch_all(pool)
    .await?;
    for id in in_service {
        let held = u32::try_from(id)
            .ok()
            .and_then(|id| keys.and_then(|k| k.get(id)))
            .is_some();
        if !held {
            anyhow::bail!(
                "masks still in service were made with masking key #{id}, \
                 which MASKING_KEYS does not hold: put it back, or retire it \
                 at once as deploy/messagr-eu-invitations.md says"
            );
        }
    }
    Ok(())
}

/// The keys and the provider, or `DiscoveryOff` (`Config::discovery`).
fn served(st: &AppState) -> Result<(&crate::masking::MaskingKeys, &sms::Ovhcloud), AppError> {
    st.cfg.discovery().map_err(|_| AppError::DiscoveryOff)
}

async fn forget_the_proof(st: &AppState, user: &str) -> Result<(), AppError> {
    sqlx::query("DELETE FROM pending_proofs WHERE user_id = ?")
        .bind(user)
        .execute(&st.pool)
        .await
        .map_err(anyhow::Error::from)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::util;
    use axum::routing::{get, post};
    use sqlx::SqlitePool;
    use std::sync::Mutex;

    const NUMBER: &str = "+33612345678";

    async fn whoami_hs() -> String {
        async fn whoami(headers: HeaderMap) -> Json<serde_json::Value> {
            let bearer = headers
                .get("authorization")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.strip_prefix("Bearer "))
                .unwrap_or("unknown");
            Json(serde_json::json!({"user_id": format!("@{bearer}:h")}))
        }
        let app = axum::Router::new().route("/_matrix/client/v3/account/whoami", get(whoami));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        base
    }

    /// OVHcloud reduced to the one call a proof makes. It keeps what it was
    /// sent, so a test can read the code the way a phone would.
    #[derive(Default)]
    struct Inbox {
        sent: Vec<(Vec<String>, String)>,
    }

    async fn fake_ovhcloud(refuse: bool) -> (String, Arc<Mutex<Inbox>>) {
        let inbox = Arc::new(Mutex::new(Inbox::default()));
        let kept = inbox.clone();
        let app = axum::Router::new().route(
            "/sms/sms-test-1/jobs",
            post(move |Json(body): Json<serde_json::Value>| {
                let kept = kept.clone();
                async move {
                    let receivers: Vec<String> =
                        serde_json::from_value(body["receivers"].clone()).unwrap();
                    let message = body["message"].as_str().unwrap().to_string();
                    kept.lock().unwrap().sent.push((receivers, message));
                    if refuse {
                        Json(serde_json::json!({"ids": [], "invalidReceivers": [NUMBER]}))
                    } else {
                        Json(serde_json::json!({"ids": [7], "invalidReceivers": []}))
                    }
                }
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        (base, inbox)
    }

    fn keys() -> Arc<crate::masking::MaskingKeys> {
        let key = crate::masking::MaskingKey::from_seed(1, &[0x01; 32]).unwrap();
        Arc::new(crate::masking::MaskingKeys::new(vec![key]).unwrap())
    }

    fn state_with(pool: SqlitePool, hs: String, ovh: Option<String>) -> Arc<AppState> {
        state_at(pool, hs, ovh, crate::util::Clock::system())
    }

    /// The same, at a time the test moves: see `crate::util::Clock::settable`.
    fn state_at(
        pool: SqlitePool,
        hs: String,
        ovh: Option<String>,
        clock: crate::util::Clock,
    ) -> Arc<AppState> {
        Arc::new(AppState {
            pool,
            mx: Arc::new(crate::matrix::MatrixClient::new(hs.clone(), "token".into())),
            cfg: crate::config::Config {
                homeserver_url: hs,
                masking_keys: ovh.as_ref().map(|_| keys()),
                sms_provider: ovh.map(|base_url| sms::Ovhcloud {
                    base_url,
                    application_key: "ak".into(),
                    application_secret: "as".into(),
                    consumer_key: "ck".into(),
                    service_name: "sms-test-1".into(),
                    sender: "Messagr".into(),
                }),
                clock,
                ..crate::config::Config::for_tests()
            },
        })
    }

    async fn reading(st: &Arc<AppState>, who: &str) -> DiscoveryState {
        state(State(st.clone()), bearer(who))
            .await
            .map(|Json(s)| s)
            .unwrap()
    }

    async fn prove(st: &Arc<AppState>, inbox: &Arc<Mutex<Inbox>>, who: &str, number: &str) {
        start(st, who, number).await.unwrap();
        finish(st, who, &last_code(inbox)).await.unwrap();
    }

    const DAY: i64 = 86_400;
    const T0: i64 = 1_790_000_000;

    fn set(time: &std::sync::atomic::AtomicI64, at: i64) {
        time.store(at, std::sync::atomic::Ordering::SeqCst);
    }

    /// The reference a findable account is known by. No route shows it yet:
    /// the directory that will is #400's, so the test reads the table.
    async fn reference_of(pool: &SqlitePool, who: &str) -> Option<String> {
        sqlx::query_scalar("SELECT reference FROM findable_numbers WHERE user_id = ?")
            .bind(format!("@{who}:h"))
            .fetch_optional(pool)
            .await
            .unwrap()
    }

    fn bearer(who: &str) -> HeaderMap {
        let mut h = HeaderMap::new();
        h.insert("authorization", format!("Bearer {who}").parse().unwrap());
        h
    }

    async fn start(st: &Arc<AppState>, who: &str, number: &str) -> Result<Started, AppError> {
        start_proof(
            State(st.clone()),
            bearer(who),
            Body(StartRequest {
                number: number.into(),
                language: "fr".into(),
            }),
        )
        .await
        .map(|Json(r)| r)
    }

    async fn finish(st: &Arc<AppState>, who: &str, code: &str) -> Result<Findable, AppError> {
        finish_proof(
            State(st.clone()),
            bearer(who),
            Body(FinishRequest { code: code.into() }),
        )
        .await
        .map(|Json(r)| r)
    }

    /// The code the last SMS carried, read from its last line as iOS reads it.
    fn last_code(inbox: &Arc<Mutex<Inbox>>) -> String {
        let inbox = inbox.lock().unwrap();
        let (_, message) = inbox.sent.last().expect("an SMS was sent");
        let last = message.lines().last().unwrap();
        last.strip_prefix("@messagr.eu #").unwrap().to_string()
    }

    async fn findable_until(st: &Arc<AppState>, who: &str) -> Option<i64> {
        reading(st, who).await.findable_until
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn the_number_screen_learns_the_open_countries_and_their_provider(pool: SqlitePool) {
        let (ovh, _) = fake_ovhcloud(false).await;
        let st = state_with(pool, whoami_hs().await, Some(ovh));
        let Json(listed) = state(State(st), bearer("alice")).await.unwrap();

        assert!(listed.on);
        let france = listed.countries.iter().find(|c| c.code == "FR").unwrap();
        assert_eq!(
            (france.prefix.as_str(), france.provider),
            ("33", "OVHcloud")
        );
        assert!(
            listed.countries.iter().all(|c| c.code != "IT"),
            "Italy waits"
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn without_its_keys_and_provider_discovery_is_off(pool: SqlitePool) {
        let st = state_with(pool, whoami_hs().await, None);
        let Json(listed) = state(State(st.clone()), bearer("alice")).await.unwrap();
        assert!(!listed.on);
        assert!(matches!(
            start(&st, "alice", NUMBER).await,
            Err(AppError::DiscoveryOff)
        ));
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn a_proof_needs_an_account(pool: SqlitePool) {
        let (ovh, _) = fake_ovhcloud(false).await;
        let st = state_with(pool, whoami_hs().await, Some(ovh));
        let refused = start_proof(
            State(st),
            HeaderMap::new(),
            Body(StartRequest {
                number: NUMBER.into(),
                language: "fr".into(),
            }),
        )
        .await;
        assert!(matches!(refused, Err(AppError::Unauthenticated)));
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn a_closed_country_is_refused_before_any_sms(pool: SqlitePool) {
        let (ovh, inbox) = fake_ovhcloud(false).await;
        let st = state_with(pool, whoami_hs().await, Some(ovh));

        assert!(matches!(
            start(&st, "alice", "+393123456789").await,
            Err(AppError::CountryClosed)
        ));
        assert!(matches!(
            start(&st, "alice", "06 12 34 56 78").await,
            Err(AppError::NotANumber)
        ));
        assert!(inbox.lock().unwrap().sent.is_empty(), "no SMS may leave");
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn the_right_code_makes_the_account_findable_for_28_days(pool: SqlitePool) {
        let (ovh, inbox) = fake_ovhcloud(false).await;
        let st = state_with(pool, whoami_hs().await, Some(ovh));

        let started = start(&st, "alice", NUMBER).await.unwrap();
        assert_eq!(started.provider, "OVHcloud");
        assert_eq!(started.expires_in, 600);
        {
            let inbox = inbox.lock().unwrap();
            assert_eq!(inbox.sent.len(), 1);
            assert_eq!(inbox.sent[0].0, vec![NUMBER.to_string()]);
        }
        assert_eq!(findable_until(&st, "alice").await, None);

        let before = util::now();
        let done = finish(&st, "alice", &last_code(&inbox)).await.unwrap();
        assert!(done.findable_until >= before + 28 * 86_400);
        assert!(done.findable_until <= util::now() + 28 * 86_400);
        assert_eq!(
            findable_until(&st, "alice").await,
            Some(done.findable_until)
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn five_wrong_codes_end_the_proof(pool: SqlitePool) {
        let (ovh, inbox) = fake_ovhcloud(false).await;
        let st = state_with(pool, whoami_hs().await, Some(ovh));
        start(&st, "alice", NUMBER).await.unwrap();
        let right = last_code(&inbox);
        let wrong = if right == "000000" {
            "111111"
        } else {
            "000000"
        };

        for left in (0..5).rev() {
            match finish(&st, "alice", wrong).await {
                Err(AppError::CodeWrong { attempts_left }) => assert_eq!(attempts_left, left),
                other => panic!("expected a wrong code, got {:?}", other.err()),
            }
        }
        assert!(matches!(
            finish(&st, "alice", &right).await,
            Err(AppError::NoProofPending)
        ));
        assert_eq!(findable_until(&st, "alice").await, None);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn an_expired_code_is_refused(pool: SqlitePool) {
        let (ovh, inbox) = fake_ovhcloud(false).await;
        let st = state_with(pool.clone(), whoami_hs().await, Some(ovh));
        start(&st, "alice", NUMBER).await.unwrap();
        sqlx::query("UPDATE pending_proofs SET expires_at = ?")
            .bind(util::now() - 1)
            .execute(&pool)
            .await
            .unwrap();

        assert!(matches!(
            finish(&st, "alice", &last_code(&inbox)).await,
            Err(AppError::CodeExpired)
        ));
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn a_refused_sms_leaves_no_proof_behind(pool: SqlitePool) {
        let (ovh, _) = fake_ovhcloud(true).await;
        let st = state_with(pool.clone(), whoami_hs().await, Some(ovh));
        assert!(matches!(
            start(&st, "alice", NUMBER).await,
            Err(AppError::SmsNotSent)
        ));
        let pending: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM pending_proofs")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(pending, 0);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn the_last_proof_of_a_number_wins(pool: SqlitePool) {
        let (ovh, inbox) = fake_ovhcloud(false).await;
        let st = state_with(pool, whoami_hs().await, Some(ovh));

        start(&st, "alice", NUMBER).await.unwrap();
        finish(&st, "alice", &last_code(&inbox)).await.unwrap();
        start(&st, "bob", NUMBER).await.unwrap();
        finish(&st, "bob", &last_code(&inbox)).await.unwrap();

        assert!(findable_until(&st, "bob").await.is_some());
        assert_eq!(
            findable_until(&st, "alice").await,
            None,
            "the number now makes bob findable, and alice no more"
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn a_live_mask_without_its_key_stops_the_start(pool: SqlitePool) {
        let (ovh, inbox) = fake_ovhcloud(false).await;
        let st = state_with(pool.clone(), whoami_hs().await, Some(ovh));
        let now = util::now();
        let only = |id, byte| {
            let key = crate::masking::MaskingKey::from_seed(id, &[byte; 32]).unwrap();
            crate::masking::MaskingKeys::new(vec![key]).unwrap()
        };

        // Nothing proven yet: absent keys leave discovery off, and that is all.
        keys_of_live_masks_are_held(&pool, None, now).await.unwrap();

        start(&st, "alice", NUMBER).await.unwrap();
        finish(&st, "alice", &last_code(&inbox)).await.unwrap();

        keys_of_live_masks_are_held(&pool, Some(&only(1, 0x01)), now)
            .await
            .unwrap();
        for held in [None, Some(only(2, 0x02))] {
            let refused = keys_of_live_masks_are_held(&pool, held.as_ref(), now)
                .await
                .expect_err("a live mask without its key stops the start")
                .to_string();
            assert!(refused.contains("#1"), "{refused}");
        }

        // Once the proof has run out, nothing is lost without the key.
        let after = now + PROOF_LIFETIME_SECONDS + 1;
        keys_of_live_masks_are_held(&pool, None, after)
            .await
            .unwrap();
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn withdrawing_leaves_discovery_at_once_and_keeps_the_mask_thirty_days(pool: SqlitePool) {
        let (ovh, inbox) = fake_ovhcloud(false).await;
        let (clock, _) = crate::util::Clock::settable(T0);
        let st = state_at(pool.clone(), whoami_hs().await, Some(ovh), clock);
        prove(&st, &inbox, "alice", NUMBER).await;

        withdraw_number(State(st.clone()), bearer("alice"))
            .await
            .unwrap();

        let now = reading(&st, "alice").await;
        assert_eq!(now.findable_until, None, "not findable any more, at once");
        assert_eq!(now.ended, Some(Ended::Withdrawn));
        let masks = || async {
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM findable_numbers")
                .fetch_one(&pool)
                .await
                .unwrap()
        };
        assert_eq!(masks().await, 1, "the mask stays at the service");

        crate::cleanup::purge_ended_proofs(
            &pool,
            T0 + crate::cleanup::ENDED_PROOFS_KEPT_SECONDS - 1,
        )
        .await
        .unwrap();
        assert_eq!(masks().await, 1, "for thirty days");
        crate::cleanup::purge_ended_proofs(&pool, T0 + crate::cleanup::ENDED_PROOFS_KEPT_SECONDS)
            .await
            .unwrap();
        assert_eq!(masks().await, 0, "and not a day more");
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn a_proof_runs_out_on_its_28th_day_and_says_so(pool: SqlitePool) {
        let (ovh, inbox) = fake_ovhcloud(false).await;
        let (clock, time) = crate::util::Clock::settable(T0);
        let st = state_at(pool, whoami_hs().await, Some(ovh), clock);
        prove(&st, &inbox, "alice", NUMBER).await;

        set(&time, T0 + 28 * DAY - 1);
        assert_eq!(
            reading(&st, "alice").await.findable_until,
            Some(T0 + 28 * DAY)
        );

        set(&time, T0 + 28 * DAY);
        let ran_out = reading(&st, "alice").await;
        assert_eq!(ran_out.findable_until, None);
        assert_eq!(ran_out.ended, Some(Ended::Expired));
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn renewing_counts_28_days_from_the_new_proof(pool: SqlitePool) {
        let (ovh, inbox) = fake_ovhcloud(false).await;
        let (clock, time) = crate::util::Clock::settable(T0);
        let st = state_at(pool, whoami_hs().await, Some(ovh), clock);
        prove(&st, &inbox, "alice", NUMBER).await;

        set(&time, T0 + 22 * DAY);
        prove(&st, &inbox, "alice", NUMBER).await;

        let renewed = reading(&st, "alice").await;
        assert_eq!(renewed.findable_until, Some(T0 + 22 * DAY + 28 * DAY));
        assert_eq!(renewed.ended, None);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn the_account_a_later_proof_replaces_is_told(pool: SqlitePool) {
        let (ovh, inbox) = fake_ovhcloud(false).await;
        let (clock, time) = crate::util::Clock::settable(T0);
        let st = state_at(pool, whoami_hs().await, Some(ovh), clock);
        prove(&st, &inbox, "alice", NUMBER).await;
        set(&time, T0 + DAY);
        prove(&st, &inbox, "bob", NUMBER).await;

        let alice = reading(&st, "alice").await;
        assert_eq!(alice.findable_until, None);
        assert_eq!(alice.ended, Some(Ended::Replaced));
        assert_eq!(reading(&st, "bob").await.ended, None);

        // Proving again, alice takes the number back, and is told nothing
        // more: bob is the one replaced now.
        set(&time, T0 + 2 * DAY);
        prove(&st, &inbox, "alice", NUMBER).await;
        assert_eq!(reading(&st, "alice").await.ended, None);
        assert_eq!(reading(&st, "bob").await.ended, Some(Ended::Replaced));
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn renewing_keeps_the_reference_the_account_is_known_by(pool: SqlitePool) {
        let (ovh, inbox) = fake_ovhcloud(false).await;
        let (clock, time) = crate::util::Clock::settable(T0);
        let st = state_at(pool.clone(), whoami_hs().await, Some(ovh), clock);
        prove(&st, &inbox, "alice", NUMBER).await;
        let first = reference_of(&pool, "alice").await.expect("a reference");

        set(&time, T0 + 22 * DAY);
        prove(&st, &inbox, "alice", NUMBER).await;

        // The same account, the same number: whoever found it already must
        // not read the renewal as a number that changed hands (#392, #407).
        assert_eq!(reference_of(&pool, "alice").await, Some(first));
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn an_account_whose_proof_ran_out_is_told_when_its_number_goes_to_another(
        pool: SqlitePool,
    ) {
        let (ovh, inbox) = fake_ovhcloud(false).await;
        let (clock, time) = crate::util::Clock::settable(T0);
        let st = state_at(pool, whoami_hs().await, Some(ovh), clock);
        prove(&st, &inbox, "alice", NUMBER).await;

        set(&time, T0 + 29 * DAY);
        assert_eq!(reading(&st, "alice").await.ended, Some(Ended::Expired));
        prove(&st, &inbox, "bob", NUMBER).await;

        assert_eq!(reading(&st, "alice").await.ended, Some(Ended::Replaced));
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn withdrawing_without_a_proof_changes_nothing(pool: SqlitePool) {
        let (ovh, _) = fake_ovhcloud(false).await;
        let st = state_with(pool, whoami_hs().await, Some(ovh));
        withdraw_number(State(st.clone()), bearer("alice"))
            .await
            .unwrap();
        let alice = reading(&st, "alice").await;
        assert_eq!((alice.findable_until, alice.ended), (None, None));
    }

    /// Every value of every table: text and blobs as their raw bytes, numbers
    /// as the digits they would print. A number or a code kept in any readable
    /// form, ASCII inside a blob or an integer included, shows. The flag says
    /// which values were numbers.
    async fn every_readable_value(pool: &SqlitePool) -> Vec<(String, Vec<u8>, bool)> {
        let tables: Vec<String> = sqlx::query_scalar(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
        )
        .fetch_all(pool)
        .await
        .unwrap();
        let mut found = Vec::new();
        for table in tables {
            let columns: Vec<String> =
                sqlx::query_scalar(&format!("SELECT name FROM pragma_table_info('{table}')"))
                    .fetch_all(pool)
                    .await
                    .unwrap();
            for column in columns {
                for (types, numeric) in [("'text', 'blob'", false), ("'integer', 'real'", true)] {
                    let cast = if numeric { "TEXT" } else { "BLOB" };
                    let values: Vec<Vec<u8>> = sqlx::query_scalar(&format!(
                        "SELECT CAST(CAST(\"{column}\" AS {cast}) AS BLOB) FROM \"{table}\" \
                         WHERE typeof(\"{column}\") IN ({types})"
                    ))
                    .fetch_all(pool)
                    .await
                    .unwrap();
                    found.extend(
                        values
                            .into_iter()
                            .map(|v| (format!("{table}.{column}"), v, numeric)),
                    );
                }
            }
        }
        found
    }

    fn holds(value: &[u8], needle: &str) -> bool {
        value.windows(needle.len()).any(|w| w == needle.as_bytes())
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn no_table_holds_the_number_or_the_code_in_any_readable_form(pool: SqlitePool) {
        let (ovh, inbox) = fake_ovhcloud(false).await;
        let st = state_with(pool.clone(), whoami_hs().await, Some(ovh));
        start(&st, "alice", NUMBER).await.unwrap();
        let code = last_code(&inbox);

        let pending = every_readable_value(&pool).await;
        finish(&st, "alice", &code).await.unwrap();
        let proven = every_readable_value(&pool).await;

        for (moment, values) in [("pending", pending), ("proven", proven)] {
            for (place, value, numeric) in values {
                assert!(
                    !holds(&value, "612345678"),
                    "{moment}: {place} holds the number"
                );
                // Not among the numbers: six digits turn up inside a
                // timestamp now and then, and the code is not one to keep.
                if !numeric {
                    assert!(!holds(&value, &code), "{moment}: {place} holds the code");
                }
            }
        }
        // Control: the reading does see integers, or the loop above proves
        // nothing about them.
        let seen = every_readable_value(&pool).await;
        assert!(seen
            .iter()
            .any(|(place, _, numeric)| *numeric && place == "findable_numbers.expires_at"));
    }
}
