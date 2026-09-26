//! Address-book discovery: proving a number (#397, #392, ADR 0014), and
//! looking for one's contacts (#400).
//!
//! Seven routes, all authenticated by the account's Matrix token like the
//! others. Four prove a number and keep the account findable:
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
//! Three serve a findable account looking for its contacts, and the last two
//! are for findable accounts only:
//!
//! - `GET /discovery/keys`: the public keys, by key number, that a device
//!   checks every masked batch against;
//! - `POST /discovery/masks`: a batch of blinded elements, evaluated under
//!   the key named, with one proof for all of them. The service cannot read
//!   what it masks;
//! - `GET /discovery/directory`: every current proof, as a mask and an
//!   opaque reference, the same for everyone. The device compares its masks
//!   with it, so the service never learns whether a contact was found.
//!
//! # WHAT THE SERVICE KEEPS OF A NUMBER
//!
//! Its mask under the current key, nothing else: not the number, not the
//! code, not the SMS. The number leaves the service once, towards the SMS
//! provider named on the number screen.

use std::sync::Arc;

use axum::{extract::State, http::HeaderMap, Json};
use data_encoding::BASE64;
use serde::{Deserialize, Serialize};

use crate::{
    auth, ceilings, countries as country, crypto, error::AppError, extract::Body, masking_quota,
    sms, sms_history, AppState,
};

/// How long a code stays good: said to the provider as well, which does not
/// deliver it later.
const CODE_LIFETIME_MINUTES: i64 = 10;
pub(crate) const CODE_LIFETIME_SECONDS: i64 = CODE_LIFETIME_MINUTES * 60;
/// How many wrong codes end a proof.
const ATTEMPTS: u32 = 5;
/// How long a proof lasts: the shortest month, since a number can change hands
/// a month after it is given up (#392, Q36).
pub const PROOF_LIFETIME_SECONDS: i64 = 28 * 86_400;
/// The most blinded elements one request may carry: the most numbers one
/// proven number may have masked in thirty days (#392, counted from #401), so
/// that no single request asks for more than a whole allowance.
const MAX_BATCH: usize = 5_000;

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
    let served = served(&st)?;
    let keys = served.keys;
    if !country::is_international(&req.number) {
        return Err(AppError::NotANumber);
    }
    let open =
        country::open_country(&st.cfg.countries, &req.number).ok_or(AppError::CountryClosed)?;
    // WHO SENDS IS THE COUNTRY'S PROVIDER. One today; a second one (Q24)
    // gets its arm here, and the compiler asks for it.
    let sender = match open.provider {
        country::Provider::Ovhcloud => served.provider,
    };
    let key = keys.current();
    let mask = key
        .mask(req.number.as_bytes())
        .map_err(|e| anyhow::anyhow!("masking a number: {e}"))?;
    let code = crypto::proof_code();
    let now = st.cfg.clock.now();

    // THE CEILINGS OF #399, before anything is kept or sent, and the code is
    // counted by the same step (`ceilings`). A renewal proves again the
    // number this account proves now: it goes through a country's ceiling
    // and the budget, never through the account's own.
    let asked = ceilings::Asked {
        user: &user,
        country: &open.code,
        renewal: proves_it_now(&st, keys, &user, &req.number, now).await?,
        at: now,
    };
    let counted = match ceilings::count_if_allowed(&st.pool, &st.cfg.sms_ceilings, &asked).await? {
        ceilings::Verdict::Counted(counted) => counted,
        ceilings::Verdict::TooMany { retry_at } => return Err(AppError::TooManyCodes { retry_at }),
        ceilings::Verdict::Later(reached) => {
            ceilings::tell_the_operator(&st, sender, served.operator, &reached, now).await;
            return Err(AppError::SmsLater);
        }
    };

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
    match sender
        .send(&req.number, &message, CODE_LIFETIME_MINUTES, now)
        .await
    {
        Err(refused) => {
            tracing::warn!("a proof's code was not sent: {refused}");
            forget_the_proof(&st, &user).await?;
            ceilings::release(&st.pool, counted).await?;
            return Err(AppError::SmsNotSent);
        }
        // TO BE ERASED from OVHcloud's history once the code has run out.
        Ok(message_id) => {
            sms_history::remember(&st.pool, message_id, now + CODE_LIFETIME_SECONDS).await?;
        }
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

#[derive(Serialize)]
pub struct PublicKey {
    pub key_number: u32,
    /// 32 bytes, standard base64 with padding.
    pub public_key: String,
}

#[derive(Serialize)]
pub struct PublicKeys {
    /// By key number: the last one is the current key.
    pub keys: Vec<PublicKey>,
}

/// `GET /discovery/keys`: the public keys a device checks every masked batch
/// against. Any account may read them, findable or not: they are public.
pub async fn public_keys(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<PublicKeys>, AppError> {
    auth::authenticate(&st.mx, &headers).await?;
    let served = served(&st)?;
    Ok(Json(PublicKeys {
        keys: served
            .keys
            .iter()
            .map(|k| PublicKey {
                key_number: k.id(),
                public_key: BASE64.encode(&k.public_key()),
            })
            .collect(),
    }))
}

#[derive(Deserialize)]
pub struct MaskRequest {
    /// The key number to mask under, read from `GET /discovery/keys`.
    pub key_number: u32,
    /// The blinded elements, 32 bytes each, in standard base64 with padding.
    /// What a device blinds is a number's international form, the exact
    /// bytes of `+` and its digits, as the service masks a number it proves.
    pub blinded: Vec<String>,
}

#[derive(Serialize)]
pub struct MaskedBatch {
    pub key_number: u32,
    /// One per blinded element, in the same order, base64.
    pub evaluated: Vec<String>,
    /// RFC 9497's one proof for the whole batch, 64 bytes, base64. Not the
    /// proof of a number.
    pub batch_proof: String,
}

/// `POST /discovery/masks`: a batch of blinded elements, evaluated under the
/// key named, with one proof for all of them.
///
/// The service cannot read what it masks: each element hides its number
/// under a blind that never leaves the device. What it learns is how many
/// elements a findable account sent, and when.
///
/// The work runs on the blocking pool: five thousand elements hold a thread
/// for about a fifth of a second, which on a worker would hold every other
/// route up with it.
pub async fn mask_batch(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
    Body(req): Body<MaskRequest>,
) -> Result<Json<MaskedBatch>, AppError> {
    let (_, proof) = findable_caller(&st, &headers).await?;
    let keys = st.cfg.masking_keys.clone().ok_or(AppError::DiscoveryOff)?;
    if req.blinded.is_empty() || req.blinded.len() > MAX_BATCH {
        return Err(AppError::NotABatch);
    }
    let blinded = req
        .blinded
        .iter()
        .map(|element| BASE64.decode(element.as_bytes()))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| AppError::NotABatch)?;
    let key_number = req.key_number;
    if keys.get(key_number).is_none() {
        return Err(AppError::UnknownMaskingKey);
    }

    // THE LIMIT OF #401, counted on the caller's proven number before the
    // work, and given back when the batch turns out not to be one.
    let number = masking_quota::Number {
        key_id: proof.key_id,
        mask: &proof.mask,
    };
    let elements = i64::try_from(blinded.len()).map_err(anyhow::Error::from)?;
    let counted =
        match masking_quota::count_if_allowed(&st.pool, &number, elements, st.cfg.clock.now())
            .await?
        {
            masking_quota::Verdict::Counted(counted) => counted,
            masking_quota::Verdict::Over {
                remaining,
                frees_at,
            } => {
                return Err(AppError::MaskingQuota {
                    remaining: u32::try_from(remaining).unwrap_or(0),
                    frees_at,
                })
            }
        };
    let masked = tokio::task::spawn_blocking(move || {
        keys.get(key_number)
            .map(|key| key.mask_blinded(&mut rand::rngs::OsRng, &blinded))
    })
    .await;
    let masked = match masked {
        Ok(Some(Ok(masked))) => masked,
        failed => {
            masking_quota::release(&st.pool, counted).await?;
            return Err(match failed {
                Ok(Some(Err(
                    crate::masking::MaskingError::EmptyBatch
                    | crate::masking::MaskingError::NotAnElement,
                ))) => AppError::NotABatch,
                Ok(Some(Err(other))) => {
                    AppError::Internal(anyhow::anyhow!("masking a batch: {other}"))
                }
                Ok(None) => AppError::UnknownMaskingKey,
                Err(joined) => AppError::Internal(anyhow::anyhow!("masking a batch: {joined}")),
                Ok(Some(Ok(_))) => unreachable!("matched above"),
            });
        }
    };
    Ok(Json(MaskedBatch {
        key_number,
        evaluated: masked
            .evaluated
            .iter()
            .map(|element| BASE64.encode(element))
            .collect(),
        batch_proof: BASE64.encode(&masked.batch_proof),
    }))
}

#[derive(Serialize)]
pub struct DirectoryEntry {
    /// The key number the mask was made under.
    pub key_number: u32,
    /// 64 bytes, base64.
    pub mask: String,
    /// What the service knows the account by, and nobody else can link to it.
    pub reference: String,
}

#[derive(Serialize)]
pub struct Directory {
    pub entries: Vec<DirectoryEntry>,
}

/// `GET /discovery/directory`: every current proof, the same for everyone.
///
/// Whole, always: the device compares its masks with it, so what it asks for
/// never depends on what it found. Sorted by key number and mask, so the order
/// says nothing of when anybody proved a number.
pub async fn directory(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Directory>, AppError> {
    findable_caller(&st, &headers).await?;
    let rows: Vec<(i64, Vec<u8>, String)> = sqlx::query_as(
        "SELECT key_id, mask, reference FROM findable_numbers \
         WHERE withdrawn_at IS NULL AND expires_at > ? ORDER BY key_id, mask",
    )
    .bind(st.cfg.clock.now())
    .fetch_all(&st.pool)
    .await
    .map_err(anyhow::Error::from)?;
    let entries = rows
        .into_iter()
        .map(|(key_number, mask, reference)| {
            Ok(DirectoryEntry {
                key_number: u32::try_from(key_number).map_err(anyhow::Error::from)?,
                mask: BASE64.encode(&mask),
                reference,
            })
        })
        .collect::<Result<Vec<_>, AppError>>()?;
    Ok(Json(Directory { entries }))
}

/// The account asking and its current proof, when it may look for its
/// contacts: discovery is served here, and the account is findable. What
/// masking a batch and downloading the directory both require, before
/// anything else.
async fn findable_caller(
    st: &AppState,
    headers: &HeaderMap,
) -> Result<(String, CurrentProof), AppError> {
    let user = auth::authenticate(&st.mx, headers).await?;
    served(st)?;
    let proof = current_proof(st, &user)
        .await?
        .ok_or(AppError::NotFindable)?;
    Ok((user, proof))
}

/// A findable account's proven number, as the service holds it: its mask
/// under its key.
struct CurrentProof {
    key_id: i64,
    mask: Vec<u8>,
}

/// The current proof of `user`: proven, not withdrawn and not run out. An
/// account whose number another one proved since has no row at all.
async fn current_proof(st: &AppState, user: &str) -> Result<Option<CurrentProof>, AppError> {
    let proof: Option<(i64, Vec<u8>)> = sqlx::query_as(
        "SELECT key_id, mask FROM findable_numbers \
         WHERE user_id = ? AND withdrawn_at IS NULL AND expires_at > ?",
    )
    .bind(user)
    .bind(st.cfg.clock.now())
    .fetch_optional(&st.pool)
    .await
    .map_err(anyhow::Error::from)?;
    Ok(proof.map(|(key_id, mask)| CurrentProof { key_id, mask }))
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

/// Whether `user` proves `number` now: a running proof of that number, made
/// under any key still in service. A proof that ran out, or was withdrawn, is
/// not one: proving the number again is a new proof.
async fn proves_it_now(
    st: &AppState,
    keys: &crate::masking::MaskingKeys,
    user: &str,
    number: &str,
    now: i64,
) -> Result<bool, AppError> {
    let running: Option<(i64, Vec<u8>)> = sqlx::query_as(
        "SELECT key_id, mask FROM findable_numbers \
         WHERE user_id = ? AND withdrawn_at IS NULL AND expires_at > ?",
    )
    .bind(user)
    .bind(now)
    .fetch_optional(&st.pool)
    .await
    .map_err(anyhow::Error::from)?;
    let Some((key_id, mask)) = running else {
        return Ok(false);
    };
    let Some(key) = u32::try_from(key_id).ok().and_then(|id| keys.get(id)) else {
        return Ok(false);
    };
    let again = key
        .mask(number.as_bytes())
        .map_err(|e| anyhow::anyhow!("masking a number: {e}"))?;
    Ok(again.as_slice() == mask.as_slice())
}

/// What discovery serves with, or `DiscoveryOff` (`Config::discovery`).
fn served(st: &AppState) -> Result<crate::config::Discovery<'_>, AppError> {
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
        /// The ids OVHcloud was asked to erase from its history (#399).
        erased: Vec<u64>,
    }

    async fn fake_ovhcloud(refuse: bool) -> (String, Arc<Mutex<Inbox>>) {
        fake_ovhcloud_with(refuse, 0, 1_000.0).await
    }

    /// The same, answering each SMS after `delay_ms`, and saying
    /// `credits_left` of the account.
    async fn fake_ovhcloud_with(
        refuse: bool,
        delay_ms: u64,
        credits_left: f64,
    ) -> (String, Arc<Mutex<Inbox>>) {
        let inbox = Arc::new(Mutex::new(Inbox::default()));
        let kept = inbox.clone();
        let erasing = inbox.clone();
        let app = axum::Router::new()
            .route(
                "/sms/sms-test-1",
                get(move || async move { Json(serde_json::json!({"creditsLeft": credits_left})) }),
            )
            .route(
                "/sms/sms-test-1/jobs",
                post(move |Json(body): Json<serde_json::Value>| {
                    let kept = kept.clone();
                    async move {
                        tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
                        let receivers: Vec<String> =
                            serde_json::from_value(body["receivers"].clone()).unwrap();
                        let message = body["message"].as_str().unwrap().to_string();
                        let mut inbox = kept.lock().unwrap();
                        inbox.sent.push((receivers, message));
                        // One id per SMS, as OVHcloud answers: the one its
                        // history knows the SMS by.
                        let id = inbox.sent.len();
                        if refuse {
                            Json(serde_json::json!({"ids": [], "invalidReceivers": [NUMBER]}))
                        } else {
                            Json(serde_json::json!({"ids": [id], "invalidReceivers": []}))
                        }
                    }
                }),
            )
            .route(
                "/sms/sms-test-1/outgoing/:id",
                axum::routing::delete(move |axum::extract::Path(id): axum::extract::Path<u64>| {
                    let erasing = erasing.clone();
                    async move {
                        erasing.lock().unwrap().erased.push(id);
                        Json(serde_json::Value::Null)
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
        let cfg = discovery_config(&hs, ovh, clock);
        state_from(pool, hs, cfg)
    }

    fn state_from(pool: SqlitePool, hs: String, cfg: crate::config::Config) -> Arc<AppState> {
        Arc::new(AppState {
            pool,
            mx: Arc::new(crate::matrix::MatrixClient::new(hs, "token".into())),
            cfg,
        })
    }

    /// Discovery served through a fake OVHcloud at `ovh`, when there is one.
    fn discovery_config(
        hs: &str,
        ovh: Option<String>,
        clock: crate::util::Clock,
    ) -> crate::config::Config {
        crate::config::Config {
            homeserver_url: hs.to_string(),
            alert_sms_to: ovh.as_ref().map(|_| ALERT.to_string()),
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
        }
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

    /// The reference a findable account is known by, read from the table, so
    /// that a test can name the account behind a directory entry.
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

    const ALERT: &str = "+33600000000";

    fn sent_to(inbox: &Arc<Mutex<Inbox>>, number: &str) -> usize {
        inbox
            .lock()
            .unwrap()
            .sent
            .iter()
            .filter(|(receivers, _)| receivers.iter().any(|r| r == number))
            .count()
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn an_account_gets_three_codes_a_day_and_ten_in_thirty_days(pool: SqlitePool) {
        let (ovh, _) = fake_ovhcloud(false).await;
        let (clock, time) = crate::util::Clock::settable(T0);
        let st = state_at(pool, whoami_hs().await, Some(ovh), clock);

        for _ in 0..3 {
            start(&st, "alice", NUMBER).await.unwrap();
        }
        match start(&st, "alice", NUMBER).await {
            Err(AppError::TooManyCodes { retry_at }) => assert_eq!(retry_at, T0 + DAY),
            other => panic!("the fourth code of the day: {:?}", other.err()),
        }
        for day in 1..=2 {
            set(&time, T0 + day * DAY);
            for _ in 0..3 {
                start(&st, "alice", NUMBER).await.unwrap();
            }
        }
        set(&time, T0 + 3 * DAY);
        start(&st, "alice", NUMBER)
            .await
            .expect("the tenth code in thirty days");
        match start(&st, "alice", NUMBER).await {
            Err(AppError::TooManyCodes { retry_at }) => assert_eq!(retry_at, T0 + 30 * DAY),
            other => panic!("the eleventh code in thirty days: {:?}", other.err()),
        }
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn a_country_s_ceiling_holds_new_proofs_back_but_lets_renewals_through(pool: SqlitePool) {
        let (ovh, inbox) = fake_ovhcloud(false).await;
        let hs = whoami_hs().await;
        let (clock, _) = crate::util::Clock::settable(T0);
        let st = state_from(
            pool,
            hs.clone(),
            crate::config::Config {
                sms_ceilings: crate::config::SmsCeilings {
                    per_country_day: 2,
                    ..crate::config::SmsCeilings::default()
                },
                ..discovery_config(&hs, Some(ovh), clock)
            },
        );

        prove(&st, &inbox, "alice", "+33612345678").await;
        start(&st, "bob", "+33612345679")
            .await
            .expect("the second SMS of the day");
        assert!(matches!(
            start(&st, "carol", "+33612345670").await,
            Err(AppError::SmsLater)
        ));
        assert_eq!(sent_to(&inbox, ALERT), 1, "the operator is told");
        assert!(matches!(
            start(&st, "dave", "+33612345671").await,
            Err(AppError::SmsLater)
        ));
        assert_eq!(sent_to(&inbox, ALERT), 1, "and told once");

        start(&st, "alice", "+33612345678")
            .await
            .expect("a renewal passes");
        start(&st, "erin", "+4915123456789")
            .await
            .expect("another country is not held back");
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn the_monthly_budget_holds_new_proofs_back_but_lets_renewals_through(pool: SqlitePool) {
        let (ovh, inbox) = fake_ovhcloud(false).await;
        let hs = whoami_hs().await;
        let (clock, time) = crate::util::Clock::settable(T0);
        let st = state_from(
            pool,
            hs.clone(),
            crate::config::Config {
                sms_ceilings: crate::config::SmsCeilings {
                    budget: 2,
                    ..crate::config::SmsCeilings::default()
                },
                ..discovery_config(&hs, Some(ovh), clock)
            },
        );

        let day0 = T0.div_euclid(DAY);
        prove(&st, &inbox, "alice", "+33612345678").await;
        set(&time, T0 + 5 * DAY);
        start(&st, "bob", "+4915123456789")
            .await
            .expect("the second SMS of the month");
        assert!(matches!(
            start(&st, "carol", "+33612345670").await,
            Err(AppError::SmsLater)
        ));
        assert_eq!(sent_to(&inbox, ALERT), 1, "the operator is told");
        start(&st, "alice", "+33612345678")
            .await
            .expect("a renewal passes beyond the budget");

        // A renewal goes through, and still spends: the budget, counted by
        // calendar days, frees itself once the fifth day, bob's SMS and
        // alice's, leaves its thirty days.
        set(&time, (day0 + 35) * DAY - 1);
        assert!(matches!(
            start(&st, "carol", "+33612345670").await,
            Err(AppError::SmsLater)
        ));
        set(&time, (day0 + 35) * DAY);
        start(&st, "carol", "+33612345670")
            .await
            .expect("the budget frees itself with the window");
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn requests_sent_together_cannot_get_past_an_account_s_ceiling(pool: SqlitePool) {
        // OVHcloud answers slowly, so that all five requests have read the
        // counts before the first SMS is sent.
        let (ovh, inbox) = fake_ovhcloud_with(false, 100, 1_000.0).await;
        let (clock, _) = crate::util::Clock::settable(T0);
        let st = state_at(pool, whoami_hs().await, Some(ovh), clock);

        let (a, b, c, d, e) = tokio::join!(
            start(&st, "alice", NUMBER),
            start(&st, "alice", NUMBER),
            start(&st, "alice", NUMBER),
            start(&st, "alice", NUMBER),
            start(&st, "alice", NUMBER),
        );
        let sent = [a, b, c, d, e].into_iter().filter(Result::is_ok).count();
        assert_eq!(sent, 3, "three codes a day, however they are asked for");
        assert_eq!(sent_to(&inbox, NUMBER), 3);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn a_renewal_is_a_running_proof_of_the_same_number_under_any_key_in_service(
        pool: SqlitePool,
    ) {
        let (ovh, inbox) = fake_ovhcloud(false).await;
        let hs = whoami_hs().await;
        let (clock, time) = crate::util::Clock::settable(T0);
        // Proved under key 1, alone in service then.
        let first = state_from(
            pool.clone(),
            hs.clone(),
            discovery_config(&hs, Some(ovh.clone()), clock.clone()),
        );
        prove(&first, &inbox, "alice", "+33612345678").await;
        prove(&first, &inbox, "bob", "+33612345679").await;

        // Key 2 joins and becomes the current one: both serve together.
        let key = |id, byte| crate::masking::MaskingKey::from_seed(id, &[byte; 32]).unwrap();
        let both =
            Arc::new(crate::masking::MaskingKeys::new(vec![key(1, 0x01), key(2, 0x02)]).unwrap());
        let later = state_from(
            pool,
            hs.clone(),
            crate::config::Config {
                masking_keys: Some(both),
                sms_ceilings: crate::config::SmsCeilings {
                    per_country_day: 0,
                    ..crate::config::SmsCeilings::default()
                },
                ..discovery_config(&hs, Some(ovh), clock)
            },
        );
        start(&later, "alice", "+33612345678")
            .await
            .expect("a renewal of a number proved under the older key passes");

        // Bob's proof ran out: proving his number again is a new proof.
        set(&time, T0 + 28 * DAY);
        assert!(matches!(
            start(&later, "bob", "+33612345679").await,
            Err(AppError::SmsLater)
        ));
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn an_alert_is_erased_only_once_it_has_had_a_day_to_arrive(pool: SqlitePool) {
        let (ovh, inbox) = fake_ovhcloud(false).await;
        let hs = whoami_hs().await;
        let (clock, _) = crate::util::Clock::settable(T0);
        let st = state_from(
            pool,
            hs.clone(),
            crate::config::Config {
                sms_ceilings: crate::config::SmsCeilings {
                    per_country_day: 0,
                    ..crate::config::SmsCeilings::default()
                },
                ..discovery_config(&hs, Some(ovh), clock)
            },
        );
        assert!(matches!(
            start(&st, "alice", NUMBER).await,
            Err(AppError::SmsLater)
        ));
        assert_eq!(sent_to(&inbox, ALERT), 1);

        let an_hour_later = T0 + 3_600;
        assert_eq!(
            crate::sms_history::erase_due(&st, an_hour_later)
                .await
                .unwrap(),
            0
        );
        let a_day_later = T0 + DAY;
        assert_eq!(
            crate::sms_history::erase_due(&st, a_day_later)
                .await
                .unwrap(),
            1
        );
        assert_eq!(inbox.lock().unwrap().erased, [1]);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn the_operator_is_told_once_a_day_when_the_prepaid_credits_run_low(pool: SqlitePool) {
        let (ovh, inbox) = fake_ovhcloud_with(false, 0, 12.0).await;
        let (clock, _) = crate::util::Clock::settable(T0);
        let st = state_at(pool, whoami_hs().await, Some(ovh), clock);

        crate::ceilings::check_the_credits(&st, T0).await.unwrap();
        assert_eq!(
            sent_to(&inbox, ALERT),
            1,
            "12 credits left, under the threshold"
        );
        crate::ceilings::check_the_credits(&st, T0 + 3_600)
            .await
            .unwrap();
        assert_eq!(sent_to(&inbox, ALERT), 1, "told once a day");
        crate::ceilings::check_the_credits(&st, T0 + DAY)
            .await
            .unwrap();
        assert_eq!(sent_to(&inbox, ALERT), 2, "and the next day again");
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn every_code_is_erased_at_ovhcloud_once_it_has_run_out(pool: SqlitePool) {
        let (ovh, inbox) = fake_ovhcloud(false).await;
        let (clock, _) = crate::util::Clock::settable(T0);
        let st = state_at(pool, whoami_hs().await, Some(ovh), clock);
        start(&st, "alice", NUMBER).await.unwrap();

        let still_good = T0 + CODE_LIFETIME_SECONDS - 1;
        assert_eq!(
            crate::sms_history::erase_due(&st, still_good)
                .await
                .unwrap(),
            0
        );
        assert!(inbox.lock().unwrap().erased.is_empty());

        let run_out = T0 + CODE_LIFETIME_SECONDS;
        assert_eq!(
            crate::sms_history::erase_due(&st, run_out).await.unwrap(),
            1
        );
        assert_eq!(inbox.lock().unwrap().erased, [1]);
        assert_eq!(
            crate::sms_history::erase_due(&st, run_out).await.unwrap(),
            0,
            "erased once"
        );
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

    // ---- looking for one's contacts (#400) --------------------------------

    /// A second number of an open country, for a second findable account.
    const OTHER: &str = "+33687654321";

    async fn public_keys_of(st: &Arc<AppState>, who: &str) -> Result<PublicKeys, AppError> {
        public_keys(State(st.clone()), bearer(who))
            .await
            .map(|Json(k)| k)
    }

    async fn send_batch(
        st: &Arc<AppState>,
        who: &str,
        key_number: u32,
        blinded: Vec<String>,
    ) -> Result<MaskedBatch, AppError> {
        mask_batch(
            State(st.clone()),
            bearer(who),
            Body(MaskRequest {
                key_number,
                blinded,
            }),
        )
        .await
        .map(|Json(m)| m)
    }

    async fn directory_of(st: &Arc<AppState>, who: &str) -> Result<Directory, AppError> {
        directory(State(st.clone()), bearer(who))
            .await
            .map(|Json(d)| d)
    }

    type Client = voprf::VoprfClient<voprf::Ristretto255>;

    /// What a device sends: each number blinded, as base64.
    fn blind(numbers: &[&str]) -> (Vec<Client>, Vec<String>) {
        numbers
            .iter()
            .map(|n| {
                let blinded = Client::blind(n.as_bytes(), &mut rand::rngs::OsRng).unwrap();
                (blinded.state, BASE64.encode(&blinded.message.serialize()))
            })
            .unzip()
    }

    /// What a device does with the answer: check the proof against the public
    /// key it read, and unblind. The masks come back as base64, the way the
    /// directory carries them.
    #[allow(clippy::ptr_arg)] // upstream iterates `&Vec`, not `&[_]`
    fn unblind(
        numbers: &[&str],
        clients: &Vec<Client>,
        answer: &MaskedBatch,
        public_key: &str,
    ) -> Vec<String> {
        use voprf::Group;
        let evaluated = answer
            .evaluated
            .iter()
            .map(|e| {
                voprf::EvaluationElement::deserialize(&BASE64.decode(e.as_bytes()).unwrap())
                    .unwrap()
            })
            .collect::<Vec<_>>();
        let proof =
            voprf::Proof::deserialize(&BASE64.decode(answer.batch_proof.as_bytes()).unwrap())
                .unwrap();
        let key =
            voprf::Ristretto255::deserialize_elem(&BASE64.decode(public_key.as_bytes()).unwrap())
                .unwrap();
        let inputs: Vec<&[u8]> = numbers.iter().map(|n| n.as_bytes()).collect();
        Client::batch_finalize(&inputs, clients, &evaluated, &proof, key)
            .expect("the proof checks against the published key")
            .map(|output| BASE64.encode(&output.unwrap()))
            .collect()
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn a_findable_account_finds_a_proven_number_and_only_it(pool: SqlitePool) {
        let (ovh, inbox) = fake_ovhcloud(false).await;
        let st = state_with(pool.clone(), whoami_hs().await, Some(ovh));
        prove(&st, &inbox, "alice", NUMBER).await;
        prove(&st, &inbox, "bob", OTHER).await;

        let keys = public_keys_of(&st, "bob").await.unwrap();
        let current = keys.keys.last().unwrap();
        let numbers = [NUMBER, "+33699999999"];
        let (clients, blinded) = blind(&numbers);
        let answer = send_batch(&st, "bob", current.key_number, blinded)
            .await
            .unwrap();
        let masks = unblind(&numbers, &clients, &answer, &current.public_key);

        let listed = directory_of(&st, "bob").await.unwrap();
        let alice = reference_of(&pool, "alice").await.unwrap();
        let found: Vec<&str> = listed
            .entries
            .iter()
            .filter(|e| masks.contains(&e.mask))
            .map(|e| e.reference.as_str())
            .collect();
        assert_eq!(
            found,
            vec![alice.as_str()],
            "alice, and nobody for the unknown number"
        );
    }

    /// Whether `who` may look for its contacts, read from the two routes that
    /// require it.
    async fn may_look_for_contacts(st: &Arc<AppState>, who: &str) -> bool {
        let (_, blinded) = blind(&[NUMBER]);
        let masked = send_batch(st, who, 1, blinded).await;
        let listed = directory_of(st, who).await;
        match (masked, listed) {
            (Ok(_), Ok(_)) => true,
            (Err(AppError::NotFindable), Err(AppError::NotFindable)) => false,
            (m, d) => panic!(
                "both routes must agree: {:?} and {:?}",
                m.err().map(|e| e.to_string()),
                d.err().map(|e| e.to_string())
            ),
        }
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn only_a_findable_account_may_look_for_its_contacts(pool: SqlitePool) {
        let (ovh, inbox) = fake_ovhcloud(false).await;
        let (clock, time) = crate::util::Clock::settable(T0);
        let st = state_at(pool, whoami_hs().await, Some(ovh), clock);

        assert!(!may_look_for_contacts(&st, "alice").await, "never proved");
        assert!(
            public_keys_of(&st, "alice").await.is_ok(),
            "the public keys are for anybody"
        );

        prove(&st, &inbox, "alice", NUMBER).await;
        assert!(may_look_for_contacts(&st, "alice").await, "proved");

        withdraw_number(State(st.clone()), bearer("alice"))
            .await
            .unwrap();
        assert!(!may_look_for_contacts(&st, "alice").await, "withdrawn");

        prove(&st, &inbox, "bob", OTHER).await;
        prove(&st, &inbox, "carol", OTHER).await;
        assert!(
            !may_look_for_contacts(&st, "bob").await,
            "replaced by carol"
        );
        assert!(may_look_for_contacts(&st, "carol").await);

        set(&time, T0 + PROOF_LIFETIME_SECONDS);
        assert!(
            !may_look_for_contacts(&st, "carol").await,
            "run out on the 28th day"
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn the_directory_holds_the_current_proofs_and_is_the_same_for_everyone(pool: SqlitePool) {
        let (ovh, inbox) = fake_ovhcloud(false).await;
        let (clock, time) = crate::util::Clock::settable(T0);
        let st = state_at(pool.clone(), whoami_hs().await, Some(ovh), clock);
        prove(&st, &inbox, "dave", "+33611111111").await;
        set(&time, T0 + DAY);
        prove(&st, &inbox, "alice", NUMBER).await;
        prove(&st, &inbox, "bob", OTHER).await;
        prove(&st, &inbox, "carol", "+33622222222").await;
        withdraw_number(State(st.clone()), bearer("carol"))
            .await
            .unwrap();
        prove(&st, &inbox, "erin", "+33633333333").await;
        prove(&st, &inbox, "frank", "+33633333333").await;
        // Dave's proof, a day older than the others, runs out first.
        set(&time, T0 + PROOF_LIFETIME_SECONDS);

        let for_alice = directory_of(&st, "alice").await.unwrap();
        let for_bob = directory_of(&st, "bob").await.unwrap();

        let mut expected = Vec::new();
        for who in ["alice", "bob", "frank"] {
            expected.push(reference_of(&pool, who).await.unwrap());
        }
        let mut listed: Vec<String> = for_alice
            .entries
            .iter()
            .map(|e| e.reference.clone())
            .collect();
        listed.sort();
        expected.sort();
        assert_eq!(
            listed, expected,
            "not carol (withdrawn), erin (replaced) nor dave (run out)"
        );
        let entries = |d: &Directory| {
            d.entries
                .iter()
                .map(|e| (e.key_number, e.mask.clone(), e.reference.clone()))
                .collect::<Vec<_>>()
        };
        assert_eq!(
            entries(&for_alice),
            entries(&for_bob),
            "the same for everyone"
        );
        let masks: Vec<&String> = for_alice.entries.iter().map(|e| &e.mask).collect();
        let mut by_mask = masks.clone();
        by_mask.sort_by_key(|m| BASE64.decode(m.as_bytes()).unwrap());
        assert_eq!(
            masks, by_mask,
            "in the order of the masks, not of the proofs"
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn a_batch_that_is_not_one_is_refused(pool: SqlitePool) {
        let (ovh, inbox) = fake_ovhcloud(false).await;
        let st = state_with(pool, whoami_hs().await, Some(ovh));
        prove(&st, &inbox, "alice", NUMBER).await;
        let (_, one) = blind(&[NUMBER]);

        let refused = |r: Result<MaskedBatch, AppError>| match r {
            Err(AppError::NotABatch) => "not a batch",
            Err(AppError::UnknownMaskingKey) => "unknown key",
            Err(_) => "another refusal",
            Ok(_) => "masked",
        };
        assert_eq!(
            refused(send_batch(&st, "alice", 1, vec![]).await),
            "not a batch"
        );
        assert_eq!(
            refused(send_batch(&st, "alice", 1, vec!["not base64 !".into()]).await),
            "not a batch"
        );
        assert_eq!(
            refused(send_batch(&st, "alice", 1, vec![BASE64.encode(&[0xff; 32])]).await),
            "not a batch",
            "32 bytes that are not a point of the group"
        );
        assert_eq!(
            refused(send_batch(&st, "alice", 1, vec![one[0].clone(); MAX_BATCH + 1]).await),
            "not a batch"
        );
        assert_eq!(
            refused(send_batch(&st, "alice", 1, vec![one[0].clone(); MAX_BATCH]).await),
            "masked",
            "the largest batch one request may carry"
        );
        assert_eq!(
            refused(send_batch(&st, "alice", 2, one).await),
            "unknown key"
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn without_its_keys_discovery_serves_neither_keys_nor_directory(pool: SqlitePool) {
        let st = state_with(pool, whoami_hs().await, None);
        assert!(matches!(
            public_keys_of(&st, "alice").await,
            Err(AppError::DiscoveryOff)
        ));
        assert!(matches!(
            directory_of(&st, "alice").await,
            Err(AppError::DiscoveryOff)
        ));
    }

    /// The shape the application reads, field by field: a rename here breaks
    /// it without breaking any test above, which read the structures.
    #[test]
    fn what_the_three_routes_answer_is_named_as_the_application_reads_it() {
        let keys = serde_json::to_value(PublicKeys {
            keys: vec![PublicKey {
                key_number: 1,
                public_key: "pk".into(),
            }],
        })
        .unwrap();
        assert_eq!(
            keys,
            serde_json::json!({"keys": [{"key_number": 1, "public_key": "pk"}]})
        );
        let masked = serde_json::to_value(MaskedBatch {
            key_number: 1,
            evaluated: vec!["e".into()],
            batch_proof: "p".into(),
        })
        .unwrap();
        assert_eq!(
            masked,
            serde_json::json!({"key_number": 1, "evaluated": ["e"], "batch_proof": "p"})
        );
        let listed = serde_json::to_value(Directory {
            entries: vec![DirectoryEntry {
                key_number: 1,
                mask: "m".into(),
                reference: "r".into(),
            }],
        })
        .unwrap();
        assert_eq!(
            listed,
            serde_json::json!({"entries": [{"key_number": 1, "mask": "m", "reference": "r"}]})
        );
        let asked: MaskRequest =
            serde_json::from_value(serde_json::json!({"key_number": 2, "blinded": ["b"]})).unwrap();
        assert_eq!(
            (asked.key_number, asked.blinded),
            (2, vec!["b".to_string()])
        );
    }

    /// Two keys in service, as during a planned change: both are published, a
    /// batch is masked under whichever it names, and each directory entry
    /// says the key its mask was made under.
    #[sqlx::test(migrations = "./migrations")]
    async fn with_two_keys_in_service_each_mask_is_found_under_its_own(pool: SqlitePool) {
        let (ovh, inbox) = fake_ovhcloud(false).await;
        let hs = whoami_hs().await;
        let one_key = state_with(pool.clone(), hs.clone(), Some(ovh.clone()));
        prove(&one_key, &inbox, "alice", NUMBER).await;

        let mut cfg = discovery_config(&hs, Some(ovh), crate::util::Clock::system());
        let both = crate::masking::MaskingKeys::new(vec![
            crate::masking::MaskingKey::from_seed(1, &[0x01; 32]).unwrap(),
            crate::masking::MaskingKey::from_seed(2, &[0x02; 32]).unwrap(),
        ])
        .unwrap();
        cfg.masking_keys = Some(Arc::new(both));
        let two_keys = state_from(pool, hs, cfg);
        prove(&two_keys, &inbox, "bob", OTHER).await;

        let keys = public_keys_of(&two_keys, "bob").await.unwrap();
        assert_eq!(
            keys.keys.iter().map(|k| k.key_number).collect::<Vec<_>>(),
            vec![1, 2],
            "both, the current one last"
        );
        let listed = directory_of(&two_keys, "bob").await.unwrap();
        for (key, number, who) in [
            (&keys.keys[0], NUMBER, "alice"),
            (&keys.keys[1], OTHER, "bob"),
        ] {
            let (clients, blinded) = blind(&[number]);
            let answer = send_batch(&two_keys, "bob", key.key_number, blinded)
                .await
                .unwrap();
            assert_eq!(answer.key_number, key.key_number);
            let masks = unblind(&[number], &clients, &answer, &key.public_key);
            let found: Vec<(u32, &str)> = listed
                .entries
                .iter()
                .filter(|e| masks.contains(&e.mask))
                .map(|e| (e.key_number, e.reference.as_str()))
                .collect();
            let reference = reference_of(&two_keys.pool, who).await.unwrap();
            assert_eq!(found, vec![(key.key_number, reference.as_str())], "{who}");
        }
    }

    // ---- the limit on masking (#401) --------------------------------------

    /// `n` copies of one blinded element: what a batch of `n` numbers weighs.
    fn batch_of(n: usize) -> Vec<String> {
        let (_, one) = blind(&[NUMBER]);
        vec![one[0].clone(); n]
    }

    /// The refusal of the limit, as (numbers still allowed, when the window
    /// frees), or what came instead.
    async fn over_the_limit(st: &Arc<AppState>, who: &str, n: usize) -> Result<(), (u32, i64)> {
        match send_batch(st, who, 1, batch_of(n)).await {
            Ok(_) => Ok(()),
            Err(AppError::MaskingQuota {
                remaining,
                frees_at,
            }) => Err((remaining, frees_at)),
            Err(other) => panic!("{n} numbers met another refusal: {other}"),
        }
    }

    const DAY_ZERO: i64 = T0 / DAY;

    #[sqlx::test(migrations = "./migrations")]
    async fn a_proven_number_has_five_thousand_numbers_masked_and_not_one_more(pool: SqlitePool) {
        let (ovh, inbox) = fake_ovhcloud(false).await;
        let (clock, _) = crate::util::Clock::settable(T0);
        let st = state_at(pool, whoami_hs().await, Some(ovh), clock);
        prove(&st, &inbox, "alice", NUMBER).await;

        assert_eq!(over_the_limit(&st, "alice", 4_999).await, Ok(()));
        assert_eq!(over_the_limit(&st, "alice", 1).await, Ok(()), "the 5,000th");
        assert_eq!(
            over_the_limit(&st, "alice", 1).await,
            Err((0, (DAY_ZERO + 30) * DAY)),
            "the 5,001st, and when the day they were masked leaves the window"
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn the_limit_frees_a_day_at_a_time_as_the_window_slides(pool: SqlitePool) {
        let (ovh, inbox) = fake_ovhcloud(false).await;
        let (clock, time) = crate::util::Clock::settable(T0);
        let st = state_at(pool, whoami_hs().await, Some(ovh), clock);
        prove(&st, &inbox, "alice", NUMBER).await;

        assert_eq!(over_the_limit(&st, "alice", 3_000).await, Ok(()));
        set(&time, T0 + DAY);
        assert_eq!(over_the_limit(&st, "alice", 2_000).await, Ok(()));
        assert_eq!(
            over_the_limit(&st, "alice", 1).await,
            Err((0, (DAY_ZERO + 30) * DAY))
        );
        // Renewed on the 20th day, so that the account is still findable
        // when the first day leaves the window.
        set(&time, T0 + 20 * DAY);
        prove(&st, &inbox, "alice", NUMBER).await;

        set(&time, (DAY_ZERO + 30) * DAY - 1);
        assert_eq!(
            over_the_limit(&st, "alice", 1).await,
            Err((0, (DAY_ZERO + 30) * DAY)),
            "a second before the first day leaves"
        );
        set(&time, (DAY_ZERO + 30) * DAY);
        assert_eq!(
            over_the_limit(&st, "alice", 3_001).await,
            Err((3_000, (DAY_ZERO + 31) * DAY)),
            "what the first day held is free, and not more"
        );
        assert_eq!(over_the_limit(&st, "alice", 3_000).await, Ok(()));
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn the_limit_follows_the_number_through_a_withdrawal_and_a_new_proof(pool: SqlitePool) {
        let (ovh, inbox) = fake_ovhcloud(false).await;
        let (clock, _) = crate::util::Clock::settable(T0);
        let st = state_at(pool, whoami_hs().await, Some(ovh), clock);
        prove(&st, &inbox, "alice", NUMBER).await;
        assert_eq!(over_the_limit(&st, "alice", 4_000).await, Ok(()));
        withdraw_number(State(st.clone()), bearer("alice"))
            .await
            .unwrap();

        prove(&st, &inbox, "bob", NUMBER).await;
        assert_eq!(over_the_limit(&st, "bob", 1_000).await, Ok(()));
        assert!(
            over_the_limit(&st, "bob", 1).await.is_err(),
            "the number masked 5,000 in thirty days, whichever account proved it"
        );

        prove(&st, &inbox, "alice", NUMBER).await;
        assert!(
            over_the_limit(&st, "alice", 1).await.is_err(),
            "proved again"
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn a_batch_refused_for_what_it_holds_costs_nothing(pool: SqlitePool) {
        let (ovh, inbox) = fake_ovhcloud(false).await;
        let (clock, _) = crate::util::Clock::settable(T0);
        let st = state_at(pool, whoami_hs().await, Some(ovh), clock);
        prove(&st, &inbox, "alice", NUMBER).await;
        let mut spoiled = batch_of(2_500);
        spoiled.push(BASE64.encode(&[0xff; 32]));

        assert!(matches!(
            send_batch(&st, "alice", 1, spoiled).await,
            Err(AppError::NotABatch)
        ));
        assert_eq!(over_the_limit(&st, "alice", 5_000).await, Ok(()));
    }
}
