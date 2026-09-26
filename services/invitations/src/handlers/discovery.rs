//! Address-book discovery: proving a number (#397, #392, ADR 0014).
//!
//! Three routes, all authenticated by the account's Matrix token like the
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
//!   findable: the last proof wins.
//!
//! # WHAT THE SERVICE KEEPS OF A NUMBER
//!
//! Its mask under the current key, nothing else: not the number, not the
//! code, not the SMS. The number leaves the service once, towards the SMS
//! provider named on the number screen.

use std::sync::Arc;

use axum::{extract::State, http::HeaderMap, Json};
use serde::{Deserialize, Serialize};

use crate::{
    auth, countries as country, crypto, error::AppError, extract::Body, sms, util, AppState,
};

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
    let now = util::now();

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
    let now = util::now();
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
    // this account stops being findable by any other number.
    let until = now + PROOF_LIFETIME_SECONDS;
    let mut tx = st.pool.begin().await.map_err(anyhow::Error::from)?;
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
    .bind(uuid::Uuid::new_v4().simple().to_string())
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
    pub countries: Vec<OpenCountry>,
}

pub async fn state(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<DiscoveryState>, AppError> {
    let user = auth::authenticate(&st.mx, &headers).await?;
    let until: Option<i64> = sqlx::query_scalar(
        "SELECT expires_at FROM findable_numbers WHERE user_id = ? AND expires_at > ?",
    )
    .bind(&user)
    .bind(util::now())
    .fetch_optional(&st.pool)
    .await
    .map_err(anyhow::Error::from)?;
    Ok(Json(DiscoveryState {
        on: st.cfg.discovery().is_ok(),
        findable_until: until,
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
                ..crate::config::Config::for_tests()
            },
        })
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
        state(State(st.clone()), bearer(who))
            .await
            .map(|Json(s)| s.findable_until)
            .unwrap()
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
