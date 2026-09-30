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
//! - `POST /discovery/proofs/finish`: the code, and the device's public
//!   envelope key (#405). Right, the account becomes findable for 28 days,
//!   and the number stops making any other account findable: the last proof
//!   wins, and the account it replaces is told;
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
//! - `GET /discovery/directory`: every current proof, as a mask, an opaque
//!   reference and the envelope key published with it, the same for everyone.
//!   The device compares its masks with it, so the service never learns
//!   whether a contact was found; the key is what an inviter seals its name
//!   for (#405).
//!
//! # WHAT THE SERVICE KEEPS OF A NUMBER
//!
//! Its mask under the current key and, under that mask, how many numbers
//! were masked for it each day, kept thirty days (#401), and what the
//! extension of a key change let it mask (#409). While a proof is in
//! progress, its mask under every other key in service too, so that its end
//! finds the number under the key it was proven under before (#409). Nothing
//! else: not the number, not the code, not the SMS. The number leaves the
//! service once, towards the SMS provider named on the number screen.

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
/// proven number may have masked in thirty days (#401), so that no single
/// request asks for more than a whole allowance. The extension of a key
/// change is as large (#409), and a batch goes whole on one count or the
/// other (`masking_quota.rs`).
const MAX_BATCH: usize = masking_quota::PER_NUMBER as usize;

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
    // NO CODE SENT for a proof that could not finish (#451): see
    // `reference_key_outlived`.
    let mut conn = st.pool.acquire().await.map_err(anyhow::Error::from)?;
    if reference_key_outlived(&mut conn, served.reference_key)
        .await
        .map_err(anyhow::Error::from)?
    {
        return Err(AppError::DiscoveryOff);
    }
    drop(conn);
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
    // THE SAME NUMBER UNDER EVERY OTHER KEY IN SERVICE (#409), while it is
    // in clear: what the end of the proof finds it by under a key it was
    // proven under before. Nothing but masks is kept, as for the proof.
    let under_other_keys = keys
        .iter()
        .filter(|other| other.id() != key.id())
        .map(|other| {
            other
                .mask(req.number.as_bytes())
                .map(|masked| (other.id(), masked))
        })
        .collect::<Result<Vec<_>, _>>()
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
        renewal: proves_it_now(&st, keys, &user, &req.number, now).await?
            || ended_by_a_retired_key(&st, &user).await?,
        at: now,
    };
    let counted = match ceilings::count_if_allowed(&st.pool, &st.cfg.sms_ceilings, &asked).await? {
        ceilings::Verdict::Counted(counted) => counted,
        ceilings::Verdict::TooMany { retry_at } => return Err(AppError::TooManyCodes { retry_at }),
        ceilings::Verdict::Later(reached) => {
            reached.tell_the_operator_once_a_day(&st, now).await;
            return Err(AppError::SmsLater);
        }
    };

    // ONE PROOF IN PROGRESS PER ACCOUNT: asking again replaces the code, and
    // the attempts start over with it, as do the masks under the other keys.
    let mut tx = st.pool.begin().await.map_err(anyhow::Error::from)?;
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
    .execute(&mut *tx)
    .await
    .map_err(anyhow::Error::from)?;
    sqlx::query("DELETE FROM pending_proof_masks WHERE user_id = ?")
        .bind(&user)
        .execute(&mut *tx)
        .await
        .map_err(anyhow::Error::from)?;
    for (other, masked) in &under_other_keys {
        sqlx::query("INSERT INTO pending_proof_masks (user_id, key_id, mask) VALUES (?, ?, ?)")
            .bind(&user)
            .bind(i64::from(*other))
            .bind(masked.to_vec())
            .execute(&mut *tx)
            .await
            .map_err(anyhow::Error::from)?;
    }
    tx.commit().await.map_err(anyhow::Error::from)?;

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
    /// The public envelope key of the device proving the number (#405):
    /// X25519, 32 bytes, base64. An inviter seals its name for it, and the
    /// service never holds what opens it. Absent, invitations to this account
    /// arrive without a name.
    #[serde(default)]
    pub envelope_key: Option<String>,
}

/// The size of an envelope key: an X25519 public key.
pub const ENVELOPE_KEY_BYTES: usize = 32;

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
    let reference_key = *served(&st)?.reference_key;
    let envelope_key = req
        .envelope_key
        .as_deref()
        .map(|key| decoded_of_size(key, ENVELOPE_KEY_BYTES))
        .transpose()?;
    let now = st.cfg.clock.now();
    // ONE LOCK FOR THE WHOLE ANSWER (#409). The proof in progress, its masks
    // under the other keys, and what they end are read and written in one
    // immediate transaction, as the limits are (`masking_quota.rs`): a proof
    // started again meanwhile, or another proof finishing, cannot fall
    // between the reading and the writing. What is decided is kept, a wrong
    // code's attempt as much as a proof's end; a failure to read or to write
    // leaves nothing. A transaction sqlx knows about, for the reason
    // `ceilings.rs` gives: a request dropped while it waits for the lock rolls
    // back with it.
    let mut tx = st
        .pool
        .begin_with("BEGIN IMMEDIATE")
        .await
        .map_err(anyhow::Error::from)?;
    let decided = finish_under_the_lock(
        &mut tx,
        &st,
        &reference_key,
        &user,
        &req.code,
        envelope_key,
        now,
    )
    .await;
    if decided.is_ok() {
        tx.commit().await.map_err(anyhow::Error::from)?;
    } else {
        tx.rollback().await.map_err(anyhow::Error::from)?;
    }
    decided?.map(Json)
}

/// The answer to a code, under the lock `finish_proof` holds: a refusal or
/// the account made findable, both to keep; or a failure, to roll back.
async fn finish_under_the_lock(
    conn: &mut sqlx::SqliteConnection,
    st: &AppState,
    reference_key: &[u8; 32],
    user: &str,
    code: &str,
    envelope_key: Option<Vec<u8>>,
    now: i64,
) -> anyhow::Result<Result<Findable, AppError>> {
    let pending: Option<(i64, Vec<u8>, Vec<u8>, i64)> = sqlx::query_as(
        "SELECT key_id, mask, code_digest, expires_at FROM pending_proofs WHERE user_id = ?",
    )
    .bind(user)
    .fetch_optional(&mut *conn)
    .await?;
    let Some((key_id, mask, digest, expires_at)) = pending else {
        return Ok(Err(AppError::NoProofPending));
    };
    // AND READ AGAIN UNDER THE LOCK (#451): a retirement between the start of
    // the proof and its end leaves it without a reference to give.
    if reference_key_outlived(conn, reference_key).await? {
        return Ok(Err(AppError::DiscoveryOff));
    }
    if expires_at <= now {
        forget_the_proof_on(conn, user).await?;
        return Ok(Err(AppError::CodeExpired));
    }
    let given = crypto::proof_code_digest(&st.cfg.encryption_key, user, code.trim());
    if !crypto::equal_in_constant_time(&digest, &given) {
        // COUNTED IN ONE STATEMENT, so two answers sent together cannot both
        // read the same count.
        let used: i64 = sqlx::query_scalar(
            "UPDATE pending_proofs SET attempts = attempts + 1 WHERE user_id = ? \
             RETURNING attempts",
        )
        .bind(user)
        .fetch_one(&mut *conn)
        .await?;
        let left = i64::from(ATTEMPTS) - used;
        if left <= 0 {
            forget_the_proof_on(conn, user).await?;
        }
        return Ok(Err(AppError::CodeWrong {
            attempts_left: u32::try_from(left.max(0)).unwrap_or(0),
        }));
    }

    // THE LAST PROOF WINS. The number stops making anybody else findable, and
    // this account stops being findable by any other number. The account it
    // made findable until now is told, at its next reading (#398).
    let until = now + PROOF_LIFETIME_SECONDS;
    // THE NUMBER UNDER EACH KEY IN SERVICE (#409): under the key this proof is
    // made under first, then under the others, as the start of the proof
    // masked it while it was in clear.
    let proven = Masked { key_id, mask };
    let mut the_number = vec![Masked {
        key_id,
        mask: proven.mask.clone(),
    }];
    the_number.extend(
        sqlx::query_as::<_, (i64, Vec<u8>)>(
            "SELECT key_id, mask FROM pending_proof_masks WHERE user_id = ? ORDER BY key_id",
        )
        .bind(user)
        .fetch_all(&mut *conn)
        .await?
        .into_iter()
        .map(|(key_id, mask)| Masked { key_id, mask }),
    );
    // THE ACCOUNT KEEPS THE REFERENCE IT HOLDS (#409, #451), whatever number
    // it proves now and under whichever key: whoever already found it must
    // not read a renewal, or a new number, as a number that changed hands
    // (#392, #407). Kept rather than computed again: computed under a
    // reference key a retirement replaced, it stays the account's until its
    // proof is forgotten. Read before the rows below go.
    let kept_reference: Option<String> =
        sqlx::query_scalar("SELECT reference FROM findable_numbers WHERE user_id = ?")
            .bind(user)
            .fetch_optional(&mut *conn)
            .await?;
    for masked in &the_number {
        // A NUMBER HOLDS ONE ROW UNDER A KEY, whoever proved it (the table's
        // key), and one row in all, since a proof under one key ends every
        // proof of it under another, and a proof in progress when a new key
        // starts serving starts again (`note_keys_served`). Its account is
        // told whether its proof was still running or had run out: either
        // way, the number now leads to somebody else. An account that
        // withdrew it has nothing to be told.
        let replaced: Option<String> = sqlx::query_scalar(
            "SELECT user_id FROM findable_numbers WHERE key_id = ? AND mask = ? \
             AND user_id <> ? AND withdrawn_at IS NULL",
        )
        .bind(masked.key_id)
        .bind(&masked.mask)
        .bind(user)
        .fetch_optional(&mut *conn)
        .await?;
        if let Some(other_account) = replaced {
            sqlx::query(
                "INSERT INTO replaced_proofs (user_id, replaced_at) VALUES (?, ?) \
                 ON CONFLICT(user_id) DO UPDATE SET replaced_at = excluded.replaced_at",
            )
            .bind(other_account)
            .bind(now)
            .execute(&mut *conn)
            .await?;
        }
        sqlx::query("DELETE FROM findable_numbers WHERE key_id = ? AND mask = ?")
            .bind(masked.key_id)
            .bind(&masked.mask)
            .execute(&mut *conn)
            .await?;
        // THE COUNTS OF #401 FOLLOW THE NUMBER onto the key it is proven
        // under now (#409): a change of key never starts them afresh.
        if masked.key_id != proven.key_id {
            masking_quota::carry(conn, &masked.number(), &proven.number()).await?;
        }
    }
    sqlx::query("DELETE FROM replaced_proofs WHERE user_id = ?")
        .bind(user)
        .execute(&mut *conn)
        .await?;
    sqlx::query("DELETE FROM retired_key_proofs WHERE user_id = ?")
        .bind(user)
        .execute(&mut *conn)
        .await?;
    sqlx::query("DELETE FROM findable_numbers WHERE user_id = ?")
        .bind(user)
        .execute(&mut *conn)
        .await?;
    // THE ENVELOPE KEY GOES WITH THE PROOF (#405): a new proof replaces it,
    // and one that brings none leaves the account without one.
    sqlx::query(
        "INSERT INTO findable_numbers \
         (key_id, mask, user_id, reference, proven_at, expires_at, envelope_key) \
         VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(proven.key_id)
    .bind(&proven.mask)
    .bind(user)
    // THE REFERENCE FOLLOWS THE ACCOUNT (#451): computed from it, so that
    // the same account comes back as itself after the thirty days its proof
    // is forgotten, and another account never reads as it.
    .bind(kept_reference.unwrap_or_else(|| crypto::account_reference(reference_key, user)))
    .bind(now)
    .bind(until)
    .bind(envelope_key)
    .execute(&mut *conn)
    .await?;
    sqlx::query("DELETE FROM pending_proofs WHERE user_id = ?")
        .bind(user)
        .execute(&mut *conn)
        .await?;
    Ok(Ok(Findable {
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

/// How being findable ended: the proof ran out, the number was withdrawn,
/// another account proved it since, or the key it was masked under was
/// retired at once (#409).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Ended {
    Expired,
    Withdrawn,
    Replaced,
    #[serde(rename = "key-changed")]
    KeyChanged,
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
    let retired: bool =
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM retired_key_proofs WHERE user_id = ?)")
            .bind(&user)
            .fetch_one(&st.pool)
            .await
            .map_err(anyhow::Error::from)?;
    let (findable_until, ended) = match proof {
        Some((until, None)) if until > now => (Some(until), None),
        Some((_, Some(_))) => (None, Some(Ended::Withdrawn)),
        Some((_, None)) => (None, Some(Ended::Expired)),
        None if replaced => (None, Some(Ended::Replaced)),
        None if retired => (None, Some(Ended::KeyChanged)),
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
    let mut conn = st.pool.acquire().await.map_err(anyhow::Error::from)?;
    let now = st.cfg.clock.now();
    withdraw_on(&mut conn, &user, now, now).await?;
    Ok(axum::http::StatusCode::NO_CONTENT)
}

/// Takes `user`'s number out of discovery at once: its entry leaves the
/// directory, and a proof in progress goes. Its mask stays at most thirty
/// days after that (ADR 0014, amended on 30 September 2026), and the count of
/// numbers it had masked goes by its own days, so that a proof of the same
/// number by any account meanwhile finds the count again (`masking_quota`).
/// The withdrawal does it, and the deletion of the account (#410), inside its
/// own transaction.
///
/// `dated` is the date the withdrawal is written with: `now` for a
/// withdrawal, the day of `now` for a deletion, which is dated by the day
/// (#473). A proof that had already run out before `now` keeps its end.
pub(crate) async fn withdraw_on(
    conn: &mut sqlx::SqliteConnection,
    user: &str,
    now: i64,
    dated: i64,
) -> anyhow::Result<()> {
    sqlx::query(
        "UPDATE findable_numbers SET withdrawn_at = ?1, \
         expires_at = CASE WHEN expires_at > ?2 THEN ?1 ELSE expires_at END \
         WHERE user_id = ?3 AND withdrawn_at IS NULL",
    )
    .bind(dated)
    .bind(now)
    .bind(user)
    .execute(&mut *conn)
    .await?;
    forget_the_proof_on(conn, user).await
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
    /// The keys retired at once (#409), by key number: a device forgets what
    /// it kept under them rather than carrying it onto a key in service, since
    /// the accounts they stopped get new references at their next proof. A
    /// key that left at the end of a planned change is not listed: the
    /// references it led to were carried onto the new key.
    pub retired: Vec<u32>,
}

/// `GET /discovery/keys`: the public keys a device checks every masked batch
/// against. Any account may read them, findable or not: they are public.
pub async fn public_keys(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<PublicKeys>, AppError> {
    auth::authenticate(&st.mx, &headers).await?;
    let served = served(&st)?;
    let retired: Vec<i64> = sqlx::query_scalar("SELECT key_id FROM retired_keys ORDER BY key_id")
        .fetch_all(&st.pool)
        .await
        .map_err(anyhow::Error::from)?;
    Ok(Json(PublicKeys {
        keys: served
            .keys
            .iter()
            .map(|k| PublicKey {
                key_number: k.id(),
                public_key: BASE64.encode(&k.public_key()),
            })
            .collect(),
        retired: retired
            .into_iter()
            .map(u32::try_from)
            .collect::<Result<_, _>>()
            .map_err(anyhow::Error::from)?,
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
    let user = findable_caller(&st, &headers).await?;
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
    // work, and given back when the batch turns out not to be one; or the
    // extension of a key change (#409), for a batch under the new key.
    let elements = i64::try_from(blinded.len()).map_err(anyhow::Error::from)?;
    let counted = match masking_quota::count_if_allowed(
        &st.pool,
        &user,
        &keys,
        key_number,
        elements,
        st.cfg.clock.now(),
    )
    .await?
    {
        masking_quota::Verdict::Counted(counted) => counted,
        // Its proof ended since it was asked: as if it had asked then.
        masking_quota::Verdict::NotFindable => return Err(AppError::NotFindable),
        masking_quota::Verdict::Over {
            remaining,
            frees_at,
        } => {
            return Err(AppError::MaskingQuotaReached {
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
        Ok(Some(Ok(masked))) => Ok(masked),
        Ok(Some(Err(
            crate::masking::MaskingError::EmptyBatch | crate::masking::MaskingError::NotAnElement,
        ))) => Err(AppError::NotABatch),
        Ok(Some(Err(other))) => Err(AppError::Internal(anyhow::anyhow!(
            "masking a batch: {other}"
        ))),
        Ok(None) => Err(AppError::UnknownMaskingKey),
        Err(joined) => Err(AppError::Internal(anyhow::anyhow!(
            "masking a batch: {joined}"
        ))),
    };
    // A batch that was not masked after all gives back what it counted.
    let masked = match masked {
        Ok(masked) => masked,
        Err(refused) => {
            masking_quota::release(&st.pool, counted).await?;
            return Err(refused);
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
    /// The public envelope key published with the proof, base64 (#405).
    /// Absent when the device published none.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub envelope_key: Option<String>,
}

#[derive(Serialize)]
pub struct Directory {
    pub entries: Vec<DirectoryEntry>,
}

/// A directory entry as the table holds it: key number, mask, reference, and
/// the envelope key published with the proof (#405).
type DirectoryRow = (i64, Vec<u8>, String, Option<Vec<u8>>);

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
    let rows: Vec<DirectoryRow> = sqlx::query_as(
        "SELECT key_id, mask, reference, envelope_key FROM findable_numbers \
         WHERE withdrawn_at IS NULL AND expires_at > ? ORDER BY key_id, mask",
    )
    .bind(st.cfg.clock.now())
    .fetch_all(&st.pool)
    .await
    .map_err(anyhow::Error::from)?;
    let entries = rows
        .into_iter()
        .map(|(key_number, mask, reference, envelope_key)| {
            Ok(DirectoryEntry {
                key_number: u32::try_from(key_number).map_err(anyhow::Error::from)?,
                mask: BASE64.encode(&mask),
                reference,
                envelope_key: envelope_key.map(|key| BASE64.encode(&key)),
            })
        })
        .collect::<Result<Vec<_>, AppError>>()?;
    Ok(Json(Directory { entries }))
}

/// The account asking, when it may look for its contacts or invite one it
/// found: discovery is served here, and the account is findable. What masking
/// a batch, downloading the directory and sending an invitation
/// (`delivered.rs`) all require, before anything else. The limit of #401 reads
/// its proof again, under its own lock (`masking_quota.rs`).
pub(crate) async fn findable_caller(
    st: &AppState,
    headers: &HeaderMap,
) -> Result<String, AppError> {
    let user = auth::authenticate(&st.mx, headers).await?;
    served(st)?;
    current_proof(st, &user, st.cfg.clock.now())
        .await?
        .ok_or(AppError::NotFindable)?;
    Ok(user)
}

/// A findable account's proven number, as the service holds it: its mask
/// under its key.
pub(crate) struct CurrentProof {
    key_id: i64,
    mask: Vec<u8>,
}

/// A number as one key masks it: what a table knows it by under that key.
struct Masked {
    key_id: i64,
    mask: Vec<u8>,
}

impl Masked {
    /// The number, as the counts of #401 know it.
    fn number(&self) -> masking_quota::Number<'_> {
        masking_quota::Number {
            key_id: self.key_id,
            mask: &self.mask,
        }
    }
}

/// The current proof of `user` at `now`: proven, not withdrawn and not run
/// out. An account whose number another one proved since has no row at all.
async fn current_proof(
    st: &AppState,
    user: &str,
    now: i64,
) -> Result<Option<CurrentProof>, AppError> {
    let proof: Option<(i64, Vec<u8>)> = sqlx::query_as(
        "SELECT key_id, mask FROM findable_numbers \
         WHERE user_id = ? AND withdrawn_at IS NULL AND expires_at > ?",
    )
    .bind(user)
    .bind(now)
    .fetch_optional(&st.pool)
    .await
    .map_err(anyhow::Error::from)?;
    Ok(proof.map(|(key_id, mask)| CurrentProof { key_id, mask }))
}

/// The account whose current proof `reference` names at `now`, if any: the
/// predicate of `current_proof`, reached by the reference the directory lists
/// rather than by the account (#404).
pub(crate) async fn account_behind(
    st: &AppState,
    reference: &str,
    now: i64,
) -> Result<Option<String>, AppError> {
    Ok(sqlx::query_scalar(
        "SELECT user_id FROM findable_numbers \
         WHERE reference = ? AND withdrawn_at IS NULL AND expires_at > ?",
    )
    .bind(reference)
    .bind(now)
    .fetch_optional(&st.pool)
    .await
    .map_err(anyhow::Error::from)?)
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

/// Notes, at the start, when each key in `MASKING_KEYS` was first served
/// (#409). A key already noted keeps its date: a restart is not a new key.
///
/// A NEW CURRENT KEY DROPS THE PROOFS IN PROGRESS made under another: their
/// number was masked, while it was in clear, under the keys served then, and
/// never under this one. Finished now, such a proof could make its account
/// findable under the old key while another account proved the same number
/// under the new one. Proofs last ten minutes and keys change once a year:
/// asking for another code is the whole cost.
pub async fn note_keys_served(
    pool: &sqlx::SqlitePool,
    keys: Option<&crate::masking::MaskingKeys>,
    now: i64,
) -> anyhow::Result<()> {
    let Some(keys) = keys else {
        return Ok(());
    };
    let current = keys.current().id();
    // Noting a key and dropping the proofs it makes stale are one step.
    let mut tx = pool.begin().await?;
    for key in keys.iter() {
        let noted =
            sqlx::query("INSERT OR IGNORE INTO masking_keys_served (key_id, since) VALUES (?, ?)")
                .bind(i64::from(key.id()))
                .bind(now)
                .execute(&mut *tx)
                .await?
                .rows_affected();
        if noted == 1 && key.id() == current {
            sqlx::query("DELETE FROM pending_proofs WHERE key_id <> ?")
                .bind(i64::from(current))
                .execute(&mut *tx)
                .await?;
        }
    }
    tx.commit().await?;
    Ok(())
}

/// Whether `key` may compute references (#451): not when a masking key was
/// retired at once after it began to serve, in the order of retirements and
/// not by the clock, nor, once any key has been retired, when it was never
/// noted. Read at each proof, on the connection that holds its lock, as well
/// as at the start.
///
/// THE REFERENCE FOLLOWS THE ACCOUNT: it is computed from the account under
/// this key (`crypto::account_reference`), so that the same account finds it
/// again whenever it proves a number, even after the thirty days the service
/// forgets its proof. A retirement at once must break that link for the
/// accounts it stops: nothing may relate their account to the masks made
/// under the lost key (ADR 0014, #409). So the key changes with the
/// retirement. A service still running through a retirement of a key that is
/// not its current one holds the old reference key until it restarts: its
/// proofs are refused until then, rather than handing a stopped account its
/// old reference back.
async fn reference_key_outlived(
    conn: &mut sqlx::SqliteConnection,
    key: &[u8; 32],
) -> sqlx::Result<bool> {
    sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM retirements WHERE seq > COALESCE( \
         (SELECT retirements_seen FROM reference_keys_served WHERE fingerprint = ?), 0))",
    )
    .bind(&crypto::key_fingerprint(key)[..])
    .fetch_one(conn)
    .await
}

/// What the start of the service checks and notes, after the modes of the
/// binary have had their turn and before it serves (#409, #451). `main` and
/// the tests that restart a service go through this one function.
///
/// CHECKED FIRST, NOTED AFTER: a start refused leaves nothing noted, neither
/// a masking key served too early nor a reference key.
pub async fn serving_start(
    pool: &sqlx::SqlitePool,
    cfg: &crate::config::Config,
    now: i64,
) -> anyhow::Result<()> {
    reference_key_may_serve(pool, cfg.reference_key.as_ref()).await?;
    note_keys_served(pool, cfg.masking_keys.as_deref(), now).await?;
    if let Some(key) = cfg.reference_key.as_ref() {
        sqlx::query(
            "INSERT OR IGNORE INTO reference_keys_served (fingerprint, since, retirements_seen) \
             VALUES (?, ?, (SELECT COALESCE(MAX(seq), 0) FROM retirements))",
        )
        .bind(&crypto::key_fingerprint(key)[..])
        .bind(now)
        .execute(pool)
        .await?;
    }
    Ok(())
}

/// Refuses a reference key that served before a masking key was retired at
/// once, and a new one given without a retirement since the previous one
/// began to serve: that change would give every account whose proof is later
/// forgotten a new reference, read as a number that changed hands by whoever
/// found it (#451). Both refusals name the variable and never the key; the
/// database keeps only its fingerprint.
async fn reference_key_may_serve(
    pool: &sqlx::SqlitePool,
    key: Option<&[u8; 32]>,
) -> anyhow::Result<()> {
    let Some(key) = key else {
        return Ok(());
    };
    let mut conn = pool.acquire().await?;
    let noted: Option<i64> =
        sqlx::query_scalar("SELECT since FROM reference_keys_served WHERE fingerprint = ?")
            .bind(&crypto::key_fingerprint(key)[..])
            .fetch_optional(&mut *conn)
            .await?;
    if noted.is_some() {
        if reference_key_outlived(&mut conn, key).await? {
            anyhow::bail!(
                "REFERENCE_KEY served before a masking key was retired at once: the \
                 accounts that retirement stopped would come back under their old \
                 reference. Give REFERENCE_KEY a new key, as \
                 deploy/messagr-eu-invitations.md says"
            );
        }
        return Ok(());
    }
    let changed_without_a_retirement: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM reference_keys_served) AND NOT EXISTS ( \
         SELECT 1 FROM retirements WHERE seq > \
         (SELECT MAX(retirements_seen) FROM reference_keys_served))",
    )
    .fetch_one(&mut *conn)
    .await?;
    if changed_without_a_retirement {
        anyhow::bail!(
            "REFERENCE_KEY changed without a masking key retired at once: every \
             account whose proof is forgotten would come back under a new reference. \
             Put the previous key back; if it is lost, retire the current masking \
             key at once, as deploy/messagr-eu-invitations.md says"
        );
    }
    Ok(())
}

/// Whether the retirement of a masking key ended `user`'s proof, less than
/// thirty days ago, while its reading says so (#409). Its next proof is then a
/// renewal for the ceilings of #399: the service stopped it, and neither a
/// country's ceiling nor the budget may keep it unfindable, the owner decided
/// on 27 September 2026. Its number cannot be compared with the one it
/// proved, whose masks went with the key: the account is what counts.
async fn ended_by_a_retired_key(st: &AppState, user: &str) -> Result<bool, AppError> {
    Ok(
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM retired_key_proofs WHERE user_id = ?)")
            .bind(user)
            .fetch_one(&st.pool)
            .await
            .map_err(anyhow::Error::from)?,
    )
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
    let Some(running) = current_proof(st, user, now).await? else {
        return Ok(false);
    };
    let Some(key) = u32::try_from(running.key_id)
        .ok()
        .and_then(|id| keys.get(id))
    else {
        return Ok(false);
    };
    let again = key
        .mask(number.as_bytes())
        .map_err(|e| anyhow::anyhow!("masking a number: {e}"))?;
    Ok(again.as_slice() == running.mask.as_slice())
}

/// `text`, base64, if it decodes to exactly `size` bytes: an envelope key or
/// a sealed name (#405).
pub(crate) fn decoded_of_size(text: &str, size: usize) -> Result<Vec<u8>, AppError> {
    BASE64
        .decode(text.as_bytes())
        .ok()
        .filter(|bytes| bytes.len() == size)
        .ok_or(AppError::MalformedEnvelope)
}

/// What discovery serves with, or `DiscoveryOff` (`Config::discovery`).
fn served(st: &AppState) -> Result<crate::config::Discovery<'_>, AppError> {
    st.cfg.discovery().map_err(|_| AppError::DiscoveryOff)
}

/// The same, on a connection a transaction holds: the one of `finish_proof`,
/// or the one of a withdrawal or a deletion (`withdraw_on`).
async fn forget_the_proof_on(conn: &mut sqlx::SqliteConnection, user: &str) -> anyhow::Result<()> {
    sqlx::query("DELETE FROM pending_proofs WHERE user_id = ?")
        .bind(user)
        .execute(&mut *conn)
        .await?;
    Ok(())
}

async fn forget_the_proof(st: &AppState, user: &str) -> Result<(), AppError> {
    sqlx::query("DELETE FROM pending_proofs WHERE user_id = ?")
        .bind(user)
        .execute(&st.pool)
        .await
        .map_err(anyhow::Error::from)?;
    Ok(())
}

/// What the tests of discovery, and of the invitations it delivers
/// (`delivered.rs`), set up alike: a homeserver that says whose a token is, a
/// service at a time the test moves, and a proof made the way a telephone
/// makes one, through the SMS double every test shares (`sms::test_support`).
#[cfg(test)]
pub(crate) mod test_support {
    use super::*;
    use crate::sms::test_support::{sms_through, Inbox};
    use axum::routing::get;
    use sqlx::SqlitePool;
    use std::sync::Mutex;

    pub(crate) const NUMBER: &str = "+33612345678";

    pub(crate) async fn whoami_hs() -> String {
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

    /// A homeserver whose `whoami` answers `status` and `body`, whatever the
    /// token: `401` for one that refuses every token, a `5xx` for one that
    /// does not answer as a homeserver does (#491).
    pub(crate) async fn whoami_answering(status: u16, body: &'static str) -> String {
        let app = axum::Router::new().route(
            "/_matrix/client/v3/account/whoami",
            get(move || async move {
                (
                    axum::http::StatusCode::from_u16(status).unwrap(),
                    [("content-type", "application/json")],
                    body,
                )
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        base
    }

    /// A homeserver that refuses every token it is shown.
    pub(crate) async fn refusing_hs() -> String {
        whoami_answering(401, r#"{"errcode":"M_UNKNOWN_TOKEN"}"#).await
    }

    /// A homeserver that takes every connection and never answers (#496):
    /// what a service stuck behind its homeserver sees, a request sent and
    /// nothing back. Each connection is held open, never closed, since a
    /// closed one would be an answer of its own.
    pub(crate) async fn mute_hs() -> String {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(async move {
            let mut held = Vec::new();
            while let Ok((connection, _)) = listener.accept().await {
                held.push(connection);
            }
        });
        base
    }

    /// The masking keys of these key numbers, each from its own seed: the
    /// same number is the same key in every test.
    fn masking_keys_numbered(ids: &[u32]) -> Arc<crate::masking::MaskingKeys> {
        let keys = ids
            .iter()
            .map(|&id| {
                crate::masking::MaskingKey::from_seed(id, &[u8::try_from(id).unwrap(); 32]).unwrap()
            })
            .collect();
        Arc::new(crate::masking::MaskingKeys::new(keys).unwrap())
    }

    pub(crate) fn keys() -> Arc<crate::masking::MaskingKeys> {
        masking_keys_numbered(&[1])
    }

    /// Key #1, `keys()`'s, and key #2, the current one: a key change under
    /// way (#409).
    pub(crate) fn keys_one_and_two() -> Arc<crate::masking::MaskingKeys> {
        masking_keys_numbered(&[1, 2])
    }

    /// The same service restarted with `keys` in `MASKING_KEYS` (#409): its
    /// database, its homeserver, its provider, its reference key and its
    /// clock, through the start `main` makes (`serving_start`).
    pub(crate) async fn restarted_with(
        st: &Arc<AppState>,
        keys: Arc<crate::masking::MaskingKeys>,
    ) -> Arc<AppState> {
        let mut cfg = st.cfg.clone();
        cfg.masking_keys = Some(keys);
        let restarted = Arc::new(AppState {
            pool: st.pool.clone(),
            mx: st.mx.clone(),
            cfg,
        });
        serving_start(&restarted.pool, &restarted.cfg, restarted.cfg.clock.now())
            .await
            .unwrap();
        restarted
    }

    /// Key #2 alone: key #1 retired at once, and #2 its successor (#409).
    pub(crate) fn key_two() -> Arc<crate::masking::MaskingKeys> {
        masking_keys_numbered(&[2])
    }

    /// The same service restarted with `keys` and `reference_key`, the start
    /// noting both as `main` does, or refusing as `main` would (#451).
    pub(crate) async fn restarted_with_reference_key(
        st: &Arc<AppState>,
        keys: Arc<crate::masking::MaskingKeys>,
        reference_key: [u8; 32],
    ) -> anyhow::Result<Arc<AppState>> {
        let mut cfg = st.cfg.clone();
        cfg.masking_keys = Some(keys);
        cfg.reference_key = Some(reference_key);
        let restarted = Arc::new(AppState {
            pool: st.pool.clone(),
            mx: st.mx.clone(),
            cfg,
        });
        let now = restarted.cfg.clock.now();
        keys_of_live_masks_are_held(&restarted.pool, restarted.cfg.masking_keys.as_deref(), now)
            .await?;
        serving_start(&restarted.pool, &restarted.cfg, now).await?;
        Ok(restarted)
    }

    pub(crate) fn state_with(pool: SqlitePool, hs: String, ovh: Option<String>) -> Arc<AppState> {
        state_at(pool, hs, ovh, crate::util::Clock::system())
    }

    /// The same, at a time the test moves: see `crate::util::Clock::settable`.
    pub(crate) fn state_at(
        pool: SqlitePool,
        hs: String,
        ovh: Option<String>,
        clock: crate::util::Clock,
    ) -> Arc<AppState> {
        let cfg = discovery_config(&hs, ovh, clock);
        state_from(pool, hs, cfg)
    }

    pub(crate) fn state_from(
        pool: SqlitePool,
        hs: String,
        cfg: crate::config::Config,
    ) -> Arc<AppState> {
        Arc::new(AppState {
            pool,
            mx: Arc::new(crate::matrix::MatrixClient::new(hs, "token".into())),
            cfg,
        })
    }

    /// Discovery served through a fake OVHcloud at `ovh`, when there is one.
    pub(crate) fn discovery_config(
        hs: &str,
        ovh: Option<String>,
        clock: crate::util::Clock,
    ) -> crate::config::Config {
        crate::config::Config {
            homeserver_url: hs.to_string(),
            masking_keys: ovh.as_ref().map(|_| keys()),
            reference_key: ovh.as_ref().map(|_| [0x07; 32]),
            sms: ovh.map(sms_through).unwrap_or_default(),
            clock,
            ..crate::config::Config::for_tests()
        }
    }

    pub(crate) async fn reading(st: &Arc<AppState>, who: &str) -> DiscoveryState {
        state(State(st.clone()), bearer(who))
            .await
            .map(|Json(s)| s)
            .unwrap()
    }

    pub(crate) async fn prove(
        st: &Arc<AppState>,
        inbox: &Arc<Mutex<Inbox>>,
        who: &str,
        number: &str,
    ) {
        start(st, who, number).await.unwrap();
        finish(st, who, &last_code(inbox)).await.unwrap();
    }

    pub(crate) const DAY: i64 = 86_400;
    pub(crate) const T0: i64 = 1_790_000_000;

    pub(crate) fn set_clock(time: &std::sync::atomic::AtomicI64, at: i64) {
        time.store(at, std::sync::atomic::Ordering::SeqCst);
    }

    /// The reference a findable account is known by, read from the table, so
    /// that a test can name the account behind a directory entry.
    pub(crate) async fn reference_of(pool: &SqlitePool, who: &str) -> Option<String> {
        sqlx::query_scalar("SELECT reference FROM findable_numbers WHERE user_id = ?")
            .bind(format!("@{who}:h"))
            .fetch_optional(pool)
            .await
            .unwrap()
    }

    pub(crate) fn bearer(who: &str) -> HeaderMap {
        let mut h = HeaderMap::new();
        h.insert("authorization", format!("Bearer {who}").parse().unwrap());
        h
    }

    pub(crate) async fn start(
        st: &Arc<AppState>,
        who: &str,
        number: &str,
    ) -> Result<Started, AppError> {
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

    pub(crate) async fn finish(
        st: &Arc<AppState>,
        who: &str,
        code: &str,
    ) -> Result<Findable, AppError> {
        finish_with_key(st, who, code, None).await
    }

    /// The same, publishing an envelope key (#405), base64.
    pub(crate) async fn finish_with_key(
        st: &Arc<AppState>,
        who: &str,
        code: &str,
        envelope_key: Option<&str>,
    ) -> Result<Findable, AppError> {
        finish_proof(
            State(st.clone()),
            bearer(who),
            Body(FinishRequest {
                code: code.into(),
                envelope_key: envelope_key.map(Into::into),
            }),
        )
        .await
        .map(|Json(r)| r)
    }

    /// The code the last SMS carried, read from its last line as iOS reads it.
    pub(crate) fn last_code(inbox: &Arc<Mutex<Inbox>>) -> String {
        let inbox = inbox.lock().unwrap();
        let (_, message) = inbox.sent.last().expect("an SMS was sent");
        let last = message.lines().last().unwrap();
        last.strip_prefix("@messagr.eu #").unwrap().to_string()
    }

    pub(crate) async fn findable_until(st: &Arc<AppState>, who: &str) -> Option<i64> {
        reading(st, who).await.findable_until
    }

    /// A second number of an open country, for a second findable account.
    pub(crate) const OTHER: &str = "+33687654321";
}

#[cfg(test)]
mod tests {
    use super::test_support::*;
    use super::*;
    use crate::sms::test_support::*;
    use crate::util;
    use sqlx::SqlitePool;
    use std::collections::HashMap;

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

        set_clock(&time, T0 + 28 * DAY - 1);
        assert_eq!(
            reading(&st, "alice").await.findable_until,
            Some(T0 + 28 * DAY)
        );

        set_clock(&time, T0 + 28 * DAY);
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

        set_clock(&time, T0 + 22 * DAY);
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
        set_clock(&time, T0 + DAY);
        prove(&st, &inbox, "bob", NUMBER).await;

        let alice = reading(&st, "alice").await;
        assert_eq!(alice.findable_until, None);
        assert_eq!(alice.ended, Some(Ended::Replaced));
        assert_eq!(reading(&st, "bob").await.ended, None);

        // Proving again, alice takes the number back, and is told nothing
        // more: bob is the one replaced now.
        set_clock(&time, T0 + 2 * DAY);
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

        set_clock(&time, T0 + 22 * DAY);
        prove(&st, &inbox, "alice", NUMBER).await;

        // The same account, the same number: whoever found it already must
        // not read the renewal as a number that changed hands (#392, #407).
        assert_eq!(reference_of(&pool, "alice").await, Some(first));
    }

    /// Its proof run out, and the thirty days after it gone with everything
    /// the service kept of it.
    async fn forgotten(st: &Arc<AppState>, time: &std::sync::atomic::AtomicI64) {
        let later = T0 + PROOF_LIFETIME_SECONDS + crate::cleanup::ENDED_PROOFS_KEPT_SECONDS;
        set_clock(time, later);
        crate::cleanup::purge_ended_proofs(&st.pool, later)
            .await
            .unwrap();
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn proving_again_after_the_thirty_days_gives_the_same_reference_back(pool: SqlitePool) {
        // #451, the owner's decision of 27 September 2026: whoever found the
        // account must not read its return as a number that changed hands,
        // and the database keeps nothing more for it.
        let (ovh, inbox) = fake_ovhcloud(false).await;
        let (clock, time) = crate::util::Clock::settable(T0);
        let st = state_at(pool.clone(), whoami_hs().await, Some(ovh), clock);
        prove(&st, &inbox, "alice", NUMBER).await;
        let first = reference_of(&pool, "alice").await.expect("a reference");

        forgotten(&st, &time).await;
        assert_eq!(
            reference_of(&pool, "alice").await,
            None,
            "nothing of it is kept"
        );
        prove(&st, &inbox, "alice", NUMBER).await;

        assert_eq!(reference_of(&pool, "alice").await, Some(first));
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn another_account_proving_the_number_is_known_by_another_reference(pool: SqlitePool) {
        let (ovh, inbox) = fake_ovhcloud(false).await;
        let (clock, time) = crate::util::Clock::settable(T0);
        let st = state_at(pool.clone(), whoami_hs().await, Some(ovh), clock);
        prove(&st, &inbox, "alice", NUMBER).await;
        let alices = reference_of(&pool, "alice").await.expect("a reference");

        forgotten(&st, &time).await;
        prove(&st, &inbox, "bob", NUMBER).await;

        // A number that changed hands still reads as one (#392, story 37).
        let bobs = reference_of(&pool, "bob").await.expect("a reference");
        assert_ne!(bobs, alices);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn an_account_whose_proof_ran_out_is_told_when_its_number_goes_to_another(
        pool: SqlitePool,
    ) {
        let (ovh, inbox) = fake_ovhcloud(false).await;
        let (clock, time) = crate::util::Clock::settable(T0);
        let st = state_at(pool, whoami_hs().await, Some(ovh), clock);
        prove(&st, &inbox, "alice", NUMBER).await;

        set_clock(&time, T0 + 29 * DAY);
        assert_eq!(reading(&st, "alice").await.ended, Some(Ended::Expired));
        prove(&st, &inbox, "bob", NUMBER).await;

        assert_eq!(reading(&st, "alice").await.ended, Some(Ended::Replaced));
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
            set_clock(&time, T0 + day * DAY);
            for _ in 0..3 {
                start(&st, "alice", NUMBER).await.unwrap();
            }
        }
        set_clock(&time, T0 + 3 * DAY);
        start(&st, "alice", NUMBER)
            .await
            .expect("the tenth code in thirty days");
        match start(&st, "alice", NUMBER).await {
            Err(AppError::TooManyCodes { retry_at }) => assert_eq!(retry_at, T0 + 30 * DAY),
            other => panic!("the eleventh code in thirty days: {:?}", other.err()),
        }
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn the_alert_of_a_ceiling_names_neither_the_account_nor_its_number(pool: SqlitePool) {
        // #464: no SMS to the operator carries an account.
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
            start(&st, "carol", NUMBER).await,
            Err(AppError::SmsLater)
        ));

        let inbox = inbox.lock().unwrap();
        let [(to, told)] = inbox.sent.as_slice() else {
            panic!("one SMS, to the operator: {:?}", inbox.sent);
        };
        assert_eq!(to, &[OPERATOR_NUMBER]);
        // The sentence of #399, word for word.
        assert_eq!(
            told,
            "Messagr : le plafond du jour est atteint pour les numéros FR (0 SMS). \
             Les nouvelles preuves attendent, les renouvellements passent."
        );
        for named in ["@carol:h", "carol", NUMBER] {
            assert!(!told.contains(named), "{named}: {told}");
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
        assert_eq!(sent_to(&inbox, OPERATOR_NUMBER), 1, "the operator is told");
        assert!(matches!(
            start(&st, "dave", "+33612345671").await,
            Err(AppError::SmsLater)
        ));
        assert_eq!(sent_to(&inbox, OPERATOR_NUMBER), 1, "and told once");

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
        set_clock(&time, T0 + 5 * DAY);
        start(&st, "bob", "+4915123456789")
            .await
            .expect("the second SMS of the month");
        assert!(matches!(
            start(&st, "carol", "+33612345670").await,
            Err(AppError::SmsLater)
        ));
        assert_eq!(sent_to(&inbox, OPERATOR_NUMBER), 1, "the operator is told");
        start(&st, "alice", "+33612345678")
            .await
            .expect("a renewal passes beyond the budget");

        // A renewal goes through, and still spends: the budget, counted by
        // calendar days, frees itself once the fifth day, bob's SMS and
        // alice's, leaves its thirty days.
        set_clock(&time, (day0 + 35) * DAY - 1);
        assert!(matches!(
            start(&st, "carol", "+33612345670").await,
            Err(AppError::SmsLater)
        ));
        set_clock(&time, (day0 + 35) * DAY);
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
        set_clock(&time, T0 + 28 * DAY);
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
        assert_eq!(sent_to(&inbox, OPERATOR_NUMBER), 1);

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

        crate::ceilings::check_the_credits(&st, T0).await;
        assert_eq!(
            sent_to(&inbox, OPERATOR_NUMBER),
            1,
            "12 credits left, under the threshold"
        );
        crate::ceilings::check_the_credits(&st, T0 + 3_600).await;
        assert_eq!(sent_to(&inbox, OPERATOR_NUMBER), 1, "told once a day");
        crate::ceilings::check_the_credits(&st, T0 + DAY).await;
        assert_eq!(
            sent_to(&inbox, OPERATOR_NUMBER),
            2,
            "and the next day again"
        );
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

        set_clock(&time, T0 + PROOF_LIFETIME_SECONDS);
        assert!(
            !may_look_for_contacts(&st, "carol").await,
            "run out on the 28th day"
        );
    }

    /// Each reference of the directory, with the envelope key it carries.
    async fn envelope_keys(st: &Arc<AppState>) -> HashMap<String, Option<String>> {
        directory_of(st, "bob")
            .await
            .unwrap()
            .entries
            .into_iter()
            .map(|e| (e.reference, e.envelope_key))
            .collect()
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn a_proof_publishes_the_envelope_key_the_directory_carries_and_the_next_replaces(
        pool: SqlitePool,
    ) {
        let (ovh, inbox) = fake_ovhcloud(false).await;
        let st = state_with(pool.clone(), whoami_hs().await, Some(ovh));
        let first = BASE64.encode(&[1; ENVELOPE_KEY_BYTES]);
        let second = BASE64.encode(&[2; ENVELOPE_KEY_BYTES]);

        start(&st, "alice", NUMBER).await.unwrap();
        finish_with_key(&st, "alice", &last_code(&inbox), Some(&first))
            .await
            .unwrap();
        prove(&st, &inbox, "bob", OTHER).await;
        let alice = reference_of(&pool, "alice").await.unwrap();
        let bob = reference_of(&pool, "bob").await.unwrap();

        let listed = envelope_keys(&st).await;
        assert_eq!(listed[&alice], Some(first));
        assert_eq!(listed[&bob], None, "a proof that published no key");

        // A RENEWAL IS A NEW PROOF, and its key replaces the last.
        start(&st, "alice", NUMBER).await.unwrap();
        finish_with_key(&st, "alice", &last_code(&inbox), Some(&second))
            .await
            .unwrap();
        assert_eq!(envelope_keys(&st).await[&alice], Some(second));
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn an_envelope_key_of_any_other_size_is_refused_and_spends_no_attempt(pool: SqlitePool) {
        let (ovh, inbox) = fake_ovhcloud(false).await;
        let st = state_with(pool, whoami_hs().await, Some(ovh));
        start(&st, "alice", NUMBER).await.unwrap();
        let code = last_code(&inbox);

        for wrong in [
            BASE64.encode(&[1; ENVELOPE_KEY_BYTES - 1]),
            BASE64.encode(&[1; ENVELOPE_KEY_BYTES + 1]),
            "not base64 at all".to_string(),
        ] {
            assert!(matches!(
                finish_with_key(&st, "alice", &code, Some(&wrong)).await,
                Err(AppError::MalformedEnvelope)
            ));
        }
        for _ in 0..ATTEMPTS {
            assert!(matches!(
                finish_with_key(&st, "alice", "000000", Some("not base64 at all")).await,
                Err(AppError::MalformedEnvelope)
            ));
        }
        assert!(
            finish_with_key(
                &st,
                "alice",
                &code,
                Some(&BASE64.encode(&[1; ENVELOPE_KEY_BYTES]))
            )
            .await
            .is_ok(),
            "the code is still good: a key refused is not a wrong code"
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn the_directory_holds_the_current_proofs_and_is_the_same_for_everyone(pool: SqlitePool) {
        let (ovh, inbox) = fake_ovhcloud(false).await;
        let (clock, time) = crate::util::Clock::settable(T0);
        let st = state_at(pool.clone(), whoami_hs().await, Some(ovh), clock);
        prove(&st, &inbox, "dave", "+33611111111").await;
        set_clock(&time, T0 + DAY);
        prove(&st, &inbox, "alice", NUMBER).await;
        prove(&st, &inbox, "bob", OTHER).await;
        prove(&st, &inbox, "carol", "+33622222222").await;
        withdraw_number(State(st.clone()), bearer("carol"))
            .await
            .unwrap();
        prove(&st, &inbox, "erin", "+33633333333").await;
        prove(&st, &inbox, "frank", "+33633333333").await;
        // Dave's proof, a day older than the others, runs out first.
        set_clock(&time, T0 + PROOF_LIFETIME_SECONDS);

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
            retired: vec![3],
        })
        .unwrap();
        assert_eq!(
            keys,
            serde_json::json!({
                "keys": [{"key_number": 1, "public_key": "pk"}],
                "retired": [3],
            })
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
            entries: vec![
                DirectoryEntry {
                    key_number: 1,
                    mask: "m".into(),
                    reference: "r".into(),
                    envelope_key: Some("k".into()),
                },
                // A PROOF THAT PUBLISHED NO ENVELOPE KEY (#405) has no field
                // for it, rather than a null the device would have to read.
                DirectoryEntry {
                    key_number: 1,
                    mask: "n".into(),
                    reference: "s".into(),
                    envelope_key: None,
                },
            ],
        })
        .unwrap();
        assert_eq!(
            listed,
            serde_json::json!({"entries": [
                {"key_number": 1, "mask": "m", "reference": "r", "envelope_key": "k"},
                {"key_number": 1, "mask": "n", "reference": "s"},
            ]})
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
        cfg.masking_keys = Some(keys_one_and_two());
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

    // ---- changing the key (#409) -----------------------------------------

    /// The key number and the mask of `who`'s proof, as the table holds them.
    async fn proof_of(pool: &SqlitePool, who: &str) -> Option<(i64, Vec<u8>)> {
        sqlx::query_as("SELECT key_id, mask FROM findable_numbers WHERE user_id = ?")
            .bind(format!("@{who}:h"))
            .fetch_optional(pool)
            .await
            .unwrap()
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn renewing_under_the_new_key_keeps_the_reference_and_moves_the_proof_to_it(
        pool: SqlitePool,
    ) {
        let (ovh, inbox) = fake_ovhcloud(false).await;
        let (clock, time) = crate::util::Clock::settable(T0);
        let one_key = state_at(pool.clone(), whoami_hs().await, Some(ovh), clock);
        prove(&one_key, &inbox, "alice", NUMBER).await;
        let first = reference_of(&pool, "alice").await.expect("a reference");

        set_clock(&time, T0 + 21 * DAY);
        let two_keys = restarted_with(&one_key, keys_one_and_two()).await;
        prove(&two_keys, &inbox, "alice", NUMBER).await;

        // Whoever found this account under the first key reads the same
        // account under the second (#402, #407), and one entry only.
        assert_eq!(reference_of(&pool, "alice").await, Some(first.clone()));
        assert_eq!(proof_of(&pool, "alice").await.map(|(key, _)| key), Some(2));
        let listed = directory_of(&two_keys, "alice").await.unwrap();
        assert_eq!(
            listed
                .entries
                .iter()
                .map(|e| (e.key_number, e.reference.as_str()))
                .collect::<Vec<_>>(),
            vec![(2, first.as_str())]
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn a_number_proven_under_the_new_key_by_another_account_ends_the_proof_under_the_old(
        pool: SqlitePool,
    ) {
        let (ovh, inbox) = fake_ovhcloud(false).await;
        let (clock, time) = crate::util::Clock::settable(T0);
        let one_key = state_at(pool.clone(), whoami_hs().await, Some(ovh), clock);
        prove(&one_key, &inbox, "alice", NUMBER).await;
        let alices = reference_of(&pool, "alice").await.expect("a reference");

        set_clock(&time, T0 + DAY);
        let two_keys = restarted_with(&one_key, keys_one_and_two()).await;
        prove(&two_keys, &inbox, "bob", NUMBER).await;

        // THE LAST PROOF WINS, under whichever key the first was made: one
        // number never makes two accounts findable, even for a day.
        assert_eq!(proof_of(&pool, "alice").await, None);
        assert_eq!(
            reading(&two_keys, "alice").await.ended,
            Some(Ended::Replaced)
        );
        let listed = directory_of(&two_keys, "bob").await.unwrap();
        assert_eq!(listed.entries.len(), 1);
        assert_eq!(listed.entries[0].key_number, 2);
        assert_ne!(listed.entries[0].reference, alices, "another account");
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn the_masking_count_follows_a_renewal_under_the_new_key(pool: SqlitePool) {
        let (ovh, inbox) = fake_ovhcloud(false).await;
        let (clock, time) = crate::util::Clock::settable(T0);
        let one_key = state_at(pool.clone(), whoami_hs().await, Some(ovh), clock);
        prove(&one_key, &inbox, "alice", NUMBER).await;
        assert_eq!(over_the_limit(&one_key, "alice", 4_000).await, Ok(()));

        set_clock(&time, T0 + 21 * DAY);
        let two_keys = restarted_with(&one_key, keys_one_and_two()).await;
        prove(&two_keys, &inbox, "alice", NUMBER).await;

        assert_eq!(
            over_the_limit(&two_keys, "alice", 1_001).await,
            Err((1_000, (DAY_ZERO + 30) * DAY)),
            "the 4,000 masked under the first key count under the second"
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn while_two_keys_serve_five_thousand_more_numbers_may_be_masked_under_the_new_one(
        pool: SqlitePool,
    ) {
        let (ovh, inbox) = fake_ovhcloud(false).await;
        let (clock, time) = crate::util::Clock::settable(T0);
        let one_key = state_at(pool.clone(), whoami_hs().await, Some(ovh), clock);
        prove(&one_key, &inbox, "alice", NUMBER).await;
        assert_eq!(over_the_limit(&one_key, "alice", 5_000).await, Ok(()));

        set_clock(&time, T0 + DAY);
        let two_keys = restarted_with(&one_key, keys_one_and_two()).await;
        let under = |key: u32, n: usize| {
            let st = two_keys.clone();
            async move {
                match send_batch(&st, "alice", key, batch_of(n)).await {
                    Ok(_) => Ok(()),
                    Err(AppError::MaskingQuotaReached { remaining, .. }) => Err(remaining),
                    Err(other) => panic!("{other}"),
                }
            }
        };

        assert_eq!(under(1, 1).await, Err(0), "under the old key, the limit");
        assert_eq!(
            under(2, 5_000).await,
            Ok(()),
            "under the new one, 5,000 more"
        );
        assert_eq!(under(2, 1).await, Err(0), "and not one more");
    }

    /// A batch of `n` under `key` for `who`: allowed, or how many numbers
    /// still are.
    async fn under_key(st: &Arc<AppState>, who: &str, key: u32, n: usize) -> Result<(), u32> {
        match send_batch(st, who, key, batch_of(n)).await {
            Ok(_) => Ok(()),
            Err(AppError::MaskingQuotaReached { remaining, .. }) => Err(remaining),
            Err(other) => panic!("{n} numbers under #{key}: {other}"),
        }
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn comparing_again_under_the_new_key_leaves_the_limit_to_the_old_one(pool: SqlitePool) {
        // #392, story 36: « sans entamer ma limite ». The batches under the
        // old key still find the accounts that have not renewed.
        let (ovh, inbox) = fake_ovhcloud(false).await;
        let (clock, time) = crate::util::Clock::settable(T0);
        let one_key = state_at(pool.clone(), whoami_hs().await, Some(ovh), clock);
        prove(&one_key, &inbox, "alice", NUMBER).await;
        assert_eq!(under_key(&one_key, "alice", 1, 3_000).await, Ok(()));
        set_clock(&time, T0 + DAY);
        let two_keys = restarted_with(&one_key, keys_one_and_two()).await;

        assert_eq!(
            under_key(&two_keys, "alice", 2, 3_000).await,
            Ok(()),
            "again"
        );
        assert_eq!(
            under_key(&two_keys, "alice", 1, 2_000).await,
            Ok(()),
            "new ones"
        );
        assert_eq!(under_key(&two_keys, "alice", 1, 1).await, Err(0));
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn a_batch_under_the_new_key_spends_what_is_left_of_the_extension_first(
        pool: SqlitePool,
    ) {
        // A second device of the same number, or a page that did not hold,
        // compares again: what the extension cannot hold goes on the limit,
        // and only that.
        let (ovh, inbox) = fake_ovhcloud(false).await;
        let (clock, _) = crate::util::Clock::settable(T0);
        let one_key = state_at(pool.clone(), whoami_hs().await, Some(ovh), clock);
        prove(&one_key, &inbox, "alice", NUMBER).await;
        let two_keys = restarted_with(&one_key, keys_one_and_two()).await;
        assert_eq!(under_key(&two_keys, "alice", 2, 3_000).await, Ok(()));
        assert_eq!(under_key(&two_keys, "alice", 2, 3_000).await, Ok(()));

        assert_eq!(
            under_key(&two_keys, "alice", 1, 4_001).await,
            Err(4_000),
            "2,000 of the second batch took the rest of the extension"
        );
        assert_eq!(
            under_key(&two_keys, "alice", 2, 4_001).await,
            Err(4_000),
            "and under the new key, what is left is the limit's"
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn what_the_extension_counted_never_counts_against_the_limit(pool: SqlitePool) {
        let (ovh, inbox) = fake_ovhcloud(false).await;
        let (clock, time) = crate::util::Clock::settable(T0);
        let one_key = state_at(pool.clone(), whoami_hs().await, Some(ovh), clock);
        prove(&one_key, &inbox, "alice", NUMBER).await;
        let two_keys = restarted_with(&one_key, keys_one_and_two()).await;
        assert_eq!(under_key(&two_keys, "alice", 2, 4_000).await, Ok(()));
        set_clock(&time, T0 + 20 * DAY);
        prove(&two_keys, &inbox, "alice", NUMBER).await;

        // The extension over, the limit is whole.
        set_clock(&time, T0 + 28 * DAY);
        assert_eq!(under_key(&two_keys, "alice", 2, 5_000).await, Ok(()));
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn a_renewal_carries_what_the_extension_counted(pool: SqlitePool) {
        let (ovh, inbox) = fake_ovhcloud(false).await;
        let (clock, time) = crate::util::Clock::settable(T0);
        let one_key = state_at(pool.clone(), whoami_hs().await, Some(ovh), clock);
        prove(&one_key, &inbox, "alice", NUMBER).await;
        let two_keys = restarted_with(&one_key, keys_one_and_two()).await;
        assert_eq!(under_key(&two_keys, "alice", 2, 4_000).await, Ok(()));

        set_clock(&time, T0 + 21 * DAY);
        prove(&two_keys, &inbox, "alice", NUMBER).await;

        // 1,000 left in the extension, and the limit whole: 5,000 fit in the
        // limit, and then 2,000 fit nowhere.
        assert_eq!(under_key(&two_keys, "alice", 2, 5_000).await, Ok(()));
        assert_eq!(under_key(&two_keys, "alice", 2, 2_000).await, Err(1_000));
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn the_extension_ends_28_days_after_the_new_key_was_first_served(pool: SqlitePool) {
        let (ovh, inbox) = fake_ovhcloud(false).await;
        let (clock, time) = crate::util::Clock::settable(T0);
        let one_key = state_at(pool.clone(), whoami_hs().await, Some(ovh), clock);
        prove(&one_key, &inbox, "alice", NUMBER).await;
        assert_eq!(over_the_limit(&one_key, "alice", 5_000).await, Ok(()));
        set_clock(&time, T0 + DAY);
        let two_keys = restarted_with(&one_key, keys_one_and_two()).await;
        // Renewed under the new key, so that the account is still findable
        // 28 days after the new key's first service.
        set_clock(&time, T0 + 20 * DAY);
        prove(&two_keys, &inbox, "alice", NUMBER).await;

        // A restart does not make the key new again, and an old key left in
        // MASKING_KEYS does not make the extension last.
        set_clock(&time, T0 + DAY + 28 * DAY);
        let restarted = restarted_with(&two_keys, keys_one_and_two()).await;
        assert!(
            matches!(
                send_batch(&restarted, "alice", 2, batch_of(1)).await,
                Err(AppError::MaskingQuotaReached { .. })
            ),
            "5,000 masked on the first day still count, and nothing extends them"
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn the_masks_under_the_other_keys_go_with_their_proof_in_progress(pool: SqlitePool) {
        let (ovh, _) = fake_ovhcloud(false).await;
        let one_key = state_with(pool.clone(), whoami_hs().await, Some(ovh));
        let two_keys = restarted_with(&one_key, keys_one_and_two()).await;
        let kept = || async {
            sqlx::query_as::<_, (String, i64)>("SELECT user_id, key_id FROM pending_proof_masks")
                .fetch_all(&pool)
                .await
                .unwrap()
        };

        start(&two_keys, "alice", NUMBER).await.unwrap();
        assert_eq!(kept().await, vec![("@alice:h".to_string(), 1)], "under #1");
        withdraw_number(State(two_keys.clone()), bearer("alice"))
            .await
            .unwrap();

        assert_eq!(kept().await, vec![], "gone with the proof");
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn a_proof_started_before_a_new_key_serves_starts_again_under_it(pool: SqlitePool) {
        let (ovh, inbox) = fake_ovhcloud(false).await;
        let (clock, _) = crate::util::Clock::settable(T0);
        let one_key = state_at(pool.clone(), whoami_hs().await, Some(ovh), clock);
        start(&one_key, "alice", NUMBER).await.unwrap();
        let code = last_code(&inbox);

        // Its number is known under #1 only: finished under #2's service, it
        // could make a second account findable by a number already proven
        // under #2 in the meantime.
        let two_keys = restarted_with(&one_key, keys_one_and_two()).await;

        assert!(matches!(
            finish(&two_keys, "alice", &code).await,
            Err(AppError::NoProofPending)
        ));
        prove(&two_keys, &inbox, "alice", NUMBER).await;
        assert_eq!(proof_of(&pool, "alice").await.map(|(key, _)| key), Some(2));
    }

    /// A start of the service holding `reference_key`, as `main` makes it.
    async fn starting_with(
        pool: &SqlitePool,
        reference_key: [u8; 32],
        now: i64,
    ) -> anyhow::Result<()> {
        let cfg = crate::config::Config {
            reference_key: Some(reference_key),
            ..crate::config::Config::for_tests()
        };
        serving_start(pool, &cfg, now).await
    }

    async fn retire_key_one_at(pool: &SqlitePool, at: i64) {
        crate::retire_key::run(pool, &["1".to_string()], None, at, |_| Some("1".into()))
            .await
            .unwrap();
    }

    /// A refusal names the variable, and no form of the key.
    fn names_no_key(refused: &str, key: [u8; 32]) {
        assert!(refused.contains("REFERENCE_KEY"), "{refused}");
        for shown in [
            BASE64.encode(&key),
            data_encoding::HEXLOWER.encode(&key),
            format!("{key:?}"),
            format!("{}, {}", key[0], key[1]),
        ] {
            assert!(!refused.contains(&shown), "the key is shown: {refused}");
        }
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn a_start_refuses_the_reference_key_a_retirement_at_once_outlived(pool: SqlitePool) {
        let old = [0x07; 32];
        let new = [0x08; 32];
        starting_with(&pool, old, T0).await.unwrap();
        starting_with(&pool, old, T0 + DAY)
            .await
            .expect("a restart is not a retirement");
        retire_key_one_at(&pool, T0 + 2 * DAY).await;

        let refused = starting_with(&pool, old, T0 + 3 * DAY).await.unwrap_err();
        names_no_key(&refused.to_string(), old);
        starting_with(&pool, new, T0 + 3 * DAY)
            .await
            .expect("a new key starts");
        starting_with(&pool, new, T0 + 4 * DAY)
            .await
            .expect("and restarts");
        assert!(
            starting_with(&pool, old, T0 + 5 * DAY).await.is_err(),
            "the old one does not come back"
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn a_start_refuses_a_reference_key_changed_without_a_retirement(pool: SqlitePool) {
        let first = [0x07; 32];
        let other = [0x08; 32];
        starting_with(&pool, first, T0).await.unwrap();

        let refused = starting_with(&pool, other, T0 + DAY).await.unwrap_err();
        names_no_key(&refused.to_string(), other);
        starting_with(&pool, first, T0 + DAY)
            .await
            .expect("the previous key is put back, and nothing of the other was noted");
        retire_key_one_at(&pool, T0 + 2 * DAY).await;
        starting_with(&pool, other, T0 + 3 * DAY)
            .await
            .expect("with a retirement, the key changes");
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn retirements_and_reference_keys_are_ordered_by_what_happened_not_by_the_clock(
        pool: SqlitePool,
    ) {
        // One second holds a start, a retirement and another start; and the
        // time of a retirement is read before its key number is typed back,
        // so a key may start while the prompt is open (#451).
        let a = [0x07; 32];
        let b = [0x08; 32];
        let c = [0x09; 32];
        starting_with(&pool, a, T0 + 10).await.unwrap();
        retire_key_one_at(&pool, T0).await;
        assert!(
            starting_with(&pool, a, T0 + 10).await.is_err(),
            "the retirement came after the key began, whatever its time says"
        );
        starting_with(&pool, b, T0 + 10)
            .await
            .expect("the key given after it");
        assert!(
            starting_with(&pool, c, T0 + 10).await.is_err(),
            "and no other without a retirement of its own"
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn a_start_refused_notes_no_masking_key(pool: SqlitePool) {
        starting_with(&pool, [0x07; 32], T0).await.unwrap();
        let cfg = crate::config::Config {
            masking_keys: Some(keys_one_and_two()),
            reference_key: Some([0x08; 32]),
            ..crate::config::Config::for_tests()
        };
        assert!(serving_start(&pool, &cfg, T0 + DAY).await.is_err());
        let noted: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM masking_keys_served")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(noted, 0, "a refused start is not a start");
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn a_running_service_proves_nothing_after_a_retirement_until_its_key_changes(
        pool: SqlitePool,
    ) {
        // A retirement of a key that is not the current one may be run beside
        // the service (#409). Until it restarts with a new reference key, a
        // proof it finished would hand an account the retirement stopped its
        // old reference back.
        let (ovh, inbox) = fake_ovhcloud(false).await;
        let (clock, time) = crate::util::Clock::settable(T0);
        let one_key = state_at(pool.clone(), whoami_hs().await, Some(ovh), clock);
        serving_start(&pool, &one_key.cfg, T0).await.unwrap();
        prove(&one_key, &inbox, "alice", NUMBER).await;
        let alices = reference_of(&pool, "alice").await.expect("a reference");
        set_clock(&time, T0 + DAY);
        let two_keys = restarted_with(&one_key, keys_one_and_two()).await;
        start(&two_keys, "bob", OTHER).await.unwrap();

        retire_key_one_at(&pool, T0 + DAY).await;

        assert!(
            matches!(
                finish(&two_keys, "bob", &last_code(&inbox)).await,
                Err(AppError::DiscoveryOff)
            ),
            "a proof started before the retirement does not finish"
        );
        assert!(matches!(
            start(&two_keys, "alice", NUMBER).await,
            Err(AppError::DiscoveryOff)
        ));
        set_clock(&time, T0 + DAY + 3_600);
        let restarted = restarted_with_reference_key(&two_keys, key_two(), [0x08; 32])
            .await
            .expect("a new reference key");
        prove(&restarted, &inbox, "alice", NUMBER).await;
        assert_ne!(reference_of(&pool, "alice").await, Some(alices));
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn an_account_the_retirement_did_not_stop_keeps_its_reference(pool: SqlitePool) {
        // Kept rather than computed again: computed under the new reference
        // key, it would read as a number that changed hands (#451).
        let (ovh, inbox) = fake_ovhcloud(false).await;
        let (clock, time) = crate::util::Clock::settable(T0);
        let one_key = state_at(pool.clone(), whoami_hs().await, Some(ovh), clock);
        serving_start(&pool, &one_key.cfg, T0).await.unwrap();
        set_clock(&time, T0 + DAY);
        let two_keys = restarted_with(&one_key, keys_one_and_two()).await;
        prove(&two_keys, &inbox, "bob", OTHER).await;
        let bobs = reference_of(&pool, "bob").await.expect("a reference");

        retire_key_one_at(&pool, T0 + 2 * DAY).await;
        set_clock(&time, T0 + 3 * DAY);
        let restarted = restarted_with_reference_key(&two_keys, key_two(), [0x08; 32])
            .await
            .expect("a new reference key");
        set_clock(&time, T0 + 23 * DAY);
        prove(&restarted, &inbox, "bob", OTHER).await;
        assert_eq!(reference_of(&pool, "bob").await, Some(bobs.clone()));

        // And with a new number: the reference follows the account.
        set_clock(&time, T0 + 24 * DAY);
        prove(&restarted, &inbox, "bob", "+33699999999").await;
        assert_eq!(reference_of(&pool, "bob").await, Some(bobs));
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn an_account_proving_a_new_number_keeps_its_reference(pool: SqlitePool) {
        // The reference follows the account, not the number (#451).
        let (ovh, inbox) = fake_ovhcloud(false).await;
        let (clock, time) = crate::util::Clock::settable(T0);
        let st = state_at(pool.clone(), whoami_hs().await, Some(ovh), clock);
        prove(&st, &inbox, "alice", NUMBER).await;
        let first = reference_of(&pool, "alice").await.expect("a reference");

        set_clock(&time, T0 + 2 * DAY);
        prove(&st, &inbox, "alice", OTHER).await;

        assert_eq!(reference_of(&pool, "alice").await, Some(first));
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn a_restart_with_the_same_keys_keeps_the_proofs_in_progress(pool: SqlitePool) {
        let (ovh, inbox) = fake_ovhcloud(false).await;
        let (clock, _) = crate::util::Clock::settable(T0);
        let one_key = state_at(pool.clone(), whoami_hs().await, Some(ovh), clock);
        let two_keys = restarted_with(&one_key, keys_one_and_two()).await;
        start(&two_keys, "alice", NUMBER).await.unwrap();

        let again = restarted_with(&two_keys, keys_one_and_two()).await;

        finish(&again, "alice", &last_code(&inbox)).await.unwrap();
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn a_planned_change_ends_with_the_old_key_left_by_every_proof(pool: SqlitePool) {
        // #409: « Au bout de 28 jours, l'ancienne clé est détruite, et ses
        // entrées quittent l'annuaire ». Alice renews, Bob does not.
        let (ovh, inbox) = fake_ovhcloud(false).await;
        let (clock, time) = crate::util::Clock::settable(T0);
        let one_key = state_at(pool.clone(), whoami_hs().await, Some(ovh), clock);
        prove(&one_key, &inbox, "alice", NUMBER).await;
        prove(&one_key, &inbox, "bob", OTHER).await;
        set_clock(&time, T0 + DAY);
        let two_keys = restarted_with(&one_key, keys_one_and_two()).await;
        set_clock(&time, T0 + 21 * DAY);
        prove(&two_keys, &inbox, "alice", NUMBER).await;

        set_clock(&time, T0 + 28 * DAY);
        let listed = directory_of(&two_keys, "alice").await.unwrap();
        assert_eq!(
            listed
                .entries
                .iter()
                .map(|e| e.key_number)
                .collect::<Vec<_>>(),
            vec![2],
            "Bob's proof under #1 ran out, and only Alice's under #2 is left"
        );
        let only_two = key_two();
        keys_of_live_masks_are_held(&pool, Some(&*only_two), T0 + 28 * DAY)
            .await
            .expect("#1 can leave MASKING_KEYS");
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn a_finish_dropped_while_it_waits_for_the_lock_leaves_no_transaction_behind(
        pool: SqlitePool,
    ) {
        use sqlx::Connection;
        let (ovh, inbox) = fake_ovhcloud(false).await;
        let st = state_with(pool.clone(), whoami_hs().await, Some(ovh));
        start(&st, "alice", NUMBER).await.unwrap();
        let code = last_code(&inbox);

        // Another writer holds the lock, and the finish waits for it until
        // its client goes away.
        let holder = pool.begin_with("BEGIN IMMEDIATE").await.unwrap();
        let waited = tokio::time::timeout(
            std::time::Duration::from_millis(300),
            finish(&st, "alice", &code),
        )
        .await;
        assert!(waited.is_err(), "the finish was still waiting");
        holder.rollback().await.unwrap();
        // Time for what the dropped finish had asked of its connection to
        // take the lock, if anything is left to take it.
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;

        // No connection of the pool is left inside a transaction: every
        // write commits, as a connection of its own sees.
        for key in 1..=10_i64 {
            sqlx::query("INSERT INTO masking_keys_served (key_id, since) VALUES (?, 0)")
                .bind(key)
                .execute(&pool)
                .await
                .unwrap();
        }
        let mut own = sqlx::SqliteConnection::connect_with(&pool.connect_options())
            .await
            .unwrap();
        let kept: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM masking_keys_served")
            .fetch_one(&mut own)
            .await
            .unwrap();
        assert_eq!(kept, 10);
    }

    #[test]
    fn a_key_retired_at_once_reads_as_key_changed() {
        assert_eq!(
            serde_json::to_value(Ended::KeyChanged).unwrap(),
            serde_json::json!("key-changed")
        );
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
            Err(AppError::MaskingQuotaReached {
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
        set_clock(&time, T0 + DAY);
        assert_eq!(over_the_limit(&st, "alice", 2_000).await, Ok(()));
        assert_eq!(
            over_the_limit(&st, "alice", 1).await,
            Err((0, (DAY_ZERO + 30) * DAY))
        );
        // Renewed on the 20th day, so that the account is still findable
        // when the first day leaves the window.
        set_clock(&time, T0 + 20 * DAY);
        prove(&st, &inbox, "alice", NUMBER).await;

        set_clock(&time, (DAY_ZERO + 30) * DAY - 1);
        assert_eq!(
            over_the_limit(&st, "alice", 1).await,
            Err((0, (DAY_ZERO + 30) * DAY)),
            "a second before the first day leaves"
        );
        set_clock(&time, (DAY_ZERO + 30) * DAY);
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
    #[sqlx::test(migrations = "./migrations")]
    async fn a_day_whose_batch_was_given_back_does_not_say_when_more_are_allowed(pool: SqlitePool) {
        let (ovh, inbox) = fake_ovhcloud(false).await;
        let (clock, time) = crate::util::Clock::settable(T0);
        let st = state_at(pool, whoami_hs().await, Some(ovh), clock);
        prove(&st, &inbox, "alice", NUMBER).await;
        let mut spoiled = batch_of(10);
        spoiled.push(BASE64.encode(&[0xff; 32]));
        assert!(matches!(
            send_batch(&st, "alice", 1, spoiled).await,
            Err(AppError::NotABatch)
        ));

        set_clock(&time, T0 + 5 * DAY);
        assert_eq!(over_the_limit(&st, "alice", 5_000).await, Ok(()));
        assert_eq!(
            over_the_limit(&st, "alice", 1).await,
            Err((0, (DAY_ZERO + 35) * DAY)),
            "when the fifth day leaves: the first counts nothing"
        );
    }

    /// The two sweeps that keep what a number leaves behind: the proofs that
    /// ended, and the days that left the window.
    async fn sweep(st: &Arc<AppState>, now: i64) {
        crate::cleanup::purge_ended_proofs(&st.pool, now)
            .await
            .unwrap();
        masking_quota::purge(&st.pool, now).await.unwrap();
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn the_count_stays_thirty_days_after_a_withdrawal(pool: SqlitePool) {
        let (ovh, inbox) = fake_ovhcloud(false).await;
        let (clock, time) = crate::util::Clock::settable(T0);
        let st = state_at(pool, whoami_hs().await, Some(ovh), clock);
        prove(&st, &inbox, "alice", NUMBER).await;
        assert_eq!(over_the_limit(&st, "alice", 5_000).await, Ok(()));
        withdraw_number(State(st.clone()), bearer("alice"))
            .await
            .unwrap();

        set_clock(&time, (DAY_ZERO + 30) * DAY - 1);
        sweep(&st, (DAY_ZERO + 30) * DAY - 1).await;
        prove(&st, &inbox, "bob", NUMBER).await;
        assert_eq!(
            over_the_limit(&st, "bob", 1).await,
            Err((0, (DAY_ZERO + 30) * DAY)),
            "a second before the thirtieth day, the sweep has kept the count"
        );

        set_clock(&time, (DAY_ZERO + 30) * DAY);
        sweep(&st, (DAY_ZERO + 30) * DAY).await;
        assert_eq!(over_the_limit(&st, "bob", 5_000).await, Ok(()));
    }

    /// The application announces `who`'s deletion, just before deactivating
    /// the account (#385).
    async fn deleted(st: &Arc<AppState>, who: &str) {
        let Json(_) = crate::handlers::deletion::announce(State(st.clone()), bearer(who))
            .await
            .unwrap();
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn a_deleted_account_leaves_discovery_at_once_and_its_mask_stays_thirty_days(
        pool: SqlitePool,
    ) {
        // #410: as a withdrawal does.
        let (ovh, inbox) = fake_ovhcloud(false).await;
        let (clock, _) = crate::util::Clock::settable(T0);
        let st = state_at(pool.clone(), whoami_hs().await, Some(ovh), clock);
        prove(&st, &inbox, "alice", NUMBER).await;
        prove(&st, &inbox, "bob", OTHER).await;
        let alices = reference_of(&pool, "alice").await.unwrap();
        start(&st, "alice", "+33633333333").await.unwrap();

        deleted(&st, "alice").await;

        let listed = directory_of(&st, "bob").await.unwrap();
        assert!(
            listed.entries.iter().all(|e| e.reference != alices),
            "out of the directory, at once"
        );
        assert!(
            matches!(
                finish(&st, "alice", &last_code(&inbox)).await,
                Err(AppError::NoProofPending)
            ),
            "and its proof in progress with it"
        );
        let masks = || async {
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM findable_numbers WHERE user_id = '@alice:h'",
            )
            .fetch_one(&pool)
            .await
            .unwrap()
        };
        // A deletion is dated by its day, never its hour (#473, the owner's
        // decision of 30 September 2026): the thirty days count from it.
        let the_day = crate::util::day_of(T0);
        crate::cleanup::purge_ended_proofs(
            &pool,
            the_day + crate::cleanup::ENDED_PROOFS_KEPT_SECONDS - 1,
        )
        .await
        .unwrap();
        assert_eq!(
            masks().await,
            1,
            "the mask stays thirty days from the day of the deletion"
        );
        crate::cleanup::purge_ended_proofs(
            &pool,
            the_day + crate::cleanup::ENDED_PROOFS_KEPT_SECONDS,
        )
        .await
        .unwrap();
        assert_eq!(masks().await, 0, "and not a day more");
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn the_count_of_a_deleted_account_stays_with_its_number(pool: SqlitePool) {
        // #410: a proof of the same number by another account, within the
        // thirty days, finds the count again. The count follows the number's
        // mask, so this holds a deletion to it rather than to the withdrawal:
        // it fails for a deletion that would purge the count.
        let (ovh, inbox) = fake_ovhcloud(false).await;
        let (clock, time) = crate::util::Clock::settable(T0);
        let st = state_at(pool, whoami_hs().await, Some(ovh), clock);
        prove(&st, &inbox, "alice", NUMBER).await;
        assert_eq!(over_the_limit(&st, "alice", 5_000).await, Ok(()));

        deleted(&st, "alice").await;
        set_clock(&time, T0 + 10 * DAY);
        prove(&st, &inbox, "bob", NUMBER).await;

        assert!(over_the_limit(&st, "bob", 1).await.is_err());
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn a_deleted_account_whose_proof_had_run_out_is_never_told_of_its_number_again(
        pool: SqlitePool,
    ) {
        // #410: its proof is withdrawn too, run out or not, so that another
        // account proving the number later writes no notice naming the
        // deleted one, which would outlive the thirty days of its purge.
        let (ovh, inbox) = fake_ovhcloud(false).await;
        let (clock, time) = crate::util::Clock::settable(T0);
        let st = state_at(pool.clone(), whoami_hs().await, Some(ovh), clock);
        prove(&st, &inbox, "alice", NUMBER).await;
        set_clock(&time, T0 + 29 * DAY);
        deleted(&st, "alice").await;

        set_clock(&time, T0 + 30 * DAY);
        prove(&st, &inbox, "bob", NUMBER).await;

        let notices: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM replaced_proofs WHERE user_id = '@alice:h'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(notices, 0);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn the_count_stays_thirty_days_after_a_proof_runs_out(pool: SqlitePool) {
        let (ovh, inbox) = fake_ovhcloud(false).await;
        let (clock, time) = crate::util::Clock::settable(T0);
        let st = state_at(pool, whoami_hs().await, Some(ovh), clock);
        prove(&st, &inbox, "alice", NUMBER).await;
        assert_eq!(over_the_limit(&st, "alice", 5_000).await, Ok(()));

        // The proof runs out on the 28th day, and alice is no longer findable.
        set_clock(&time, T0 + PROOF_LIFETIME_SECONDS);
        assert!(!may_look_for_contacts(&st, "alice").await);
        set_clock(&time, (DAY_ZERO + 30) * DAY - 1);
        sweep(&st, (DAY_ZERO + 30) * DAY - 1).await;
        prove(&st, &inbox, "alice", NUMBER).await;
        assert_eq!(
            over_the_limit(&st, "alice", 1).await,
            Err((0, (DAY_ZERO + 30) * DAY)),
            "proved again after running out, the number keeps its count"
        );

        set_clock(&time, (DAY_ZERO + 30) * DAY);
        sweep(&st, (DAY_ZERO + 30) * DAY).await;
        assert_eq!(over_the_limit(&st, "alice", 5_000).await, Ok(()));
    }
}
