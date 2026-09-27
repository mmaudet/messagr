//! Invitations delivered inside the application (#404, #392, ADR 0014): a
//! findable account invites the account behind a reference of the directory,
//! found by looking for its contacts, and never a number. An invitation so
//! delivered has no link: it is good for a week, and for one use.
//!
//! - `POST /discovery/invitations`: the inviter, findable, sends an
//!   invitation to a reference;
//! - `GET /discovery/invitations`: the recipient lists the invitations
//!   waiting for it, and those it joined and has not entered yet;
//! - `POST /discovery/invitations/:id/join`: the recipient joins. The service
//!   records the claim, which the inviter's device reads to invite the
//!   account into the conversation;
//! - `POST /discovery/invitations/:id/decline`: the recipient declines, and
//!   the invitation leaves its list;
//! - `POST /discovery/invitations/:id/block`: the recipient declines, and
//!   blocks the inviter (#406);
//! - `POST /discovery/invitations/:id/entered`: the recipient's device says it
//!   entered the conversation, and the invitation leaves its list;
//! - `GET /discovery/invitations/:id`: the inviter reads where its invitation
//!   stands.
//!
//! # ANY REFERENCE OF THE DIRECTORY, WITHIN LIMITS
//!
//! The directory is the same for everyone, and the service cannot tell a
//! reference found in an address book from any other it lists: it never
//! learns the address book. So how many invitations leave, and between whom,
//! is bounded (#406): one pending at a time between two accounts; fourteen
//! days after one ran out unanswered before the same account is invited
//! again; ten a day per inviter.
//!
//! # A BLOCK IS SILENT
//!
//! A recipient may decline and block the inviter. The inviter's later
//! invitations are taken, never delivered, and run out: they read
//! « pending », then « expired », like an invitation nobody saw, and the
//! limits apply to them as to any other, so that no refusal gives the block
//! away. Its earlier ones leave the recipient's list as well, one joined and
//! not entered included: the conversation its device opens then stands on
//! the threshold, where §13.3 puts it to the person again.
//!
//! A block is a refusal the service keeps, where a refusal is forgotten at the
//! deadline (`cleanup.rs`): the person chooses it for that. It lasts as long as
//! both accounts exist, and goes with the purge of a deleted one, either side,
//! never with an announcement, which is not a proof (`deletion.rs`, #423).
//!
//! # EACH SIDE LEARNS THE OTHER WHEN THE RECIPIENT JOINS
//!
//! The service knows the recipient from the moment the invitation leaves:
//! the reference names it. The inviter is told who it is when it joins,
//! which is when its device must invite that account; before, the invitation
//! reads « pending » and names nobody. The recipient is told the inviter's
//! account at the same moment (before, only the reference it is findable by:
//! see below), which is how its device recognises the room invite it
//! waits for among any other, days later if the inviter's device was asleep,
//! and after a relaunch as well: a joined invitation stays in its list, with
//! the inviter, until the device says it entered (`entered`), past the
//! deadline too, since the inviter's device may let it in late. Each entry
//! answers one invitation, so a later room of the same inviter is not taken
//! for it. A block is the exception: it withdraws even an invitation joined
//! (see below).
//!
//! # BEFORE IT ANSWERS, THE RECIPIENT LEARNS ITS INVITER'S REFERENCE (#407)
//!
//! Not its account: the reference its current proof is listed by in the
//! directory, which every findable account downloads. To a recipient who
//! never found that number in its own address book, it says nobody's name;
//! to one who did, from the results its device keeps, it says the inviter is
//! in it. It does say, to any recipient, that two invitations came from the
//! same inviter, since a renewal keeps it, and it goes when the inviter
//! withdraws its number or lets its proof run out: what an inviter's own
//! status reads say of an invitation, turned the other way.
//!
//! # A REFUSAL READS AS AN INVITATION NOBODY HAS SEEN
//!
//! Declining is written for the recipient alone, so that the invitation
//! leaves its list on every device. The inviter reads « pending » until the
//! deadline, then « expired », exactly as for an invitation never opened:
//! nothing tells it whether it was seen, or refused. The refusal carries no
//! date, and the cleanup forgets it at the deadline (`cleanup.rs`).
//!
//! # THE NAME THE INVITER GIVES ITSELF, SEALED FOR THE RECIPIENT (#405)
//!
//! A link carries it in its fragment, which never reaches a server. An
//! invitation delivered here has no link, so the inviter's device seals the
//! name for the envelope key the recipient's device published with its proof
//! (HPKE, RFC 9180), and the service passes the envelope on without being
//! able to open it. Every envelope has the same size, whatever the name. It
//! is erased as soon as the recipient answers, and at the deadline: past
//! either, no screen shows it any more.
//!
//! # WHAT THE SERVICE KEEPS
//!
//! Who invites whom, from the moment an invitation leaves, declined or never
//! answered included: ADR 0014 names that price, which a link pays only when
//! it is spent. Kept thirty days after the invitation ended, the retention of
//! a link's (#416). Never the conversation: the inviter's device holds it,
//! and invites the account into it when the claim comes. The sealed name
//! only until it is answered or runs out, as above.

use std::sync::Arc;

use axum::{
    extract::{Path, State},
    http::HeaderMap,
    Json,
};
use data_encoding::BASE64;
use serde::{Deserialize, Serialize};
use sqlx::Row;

use crate::{
    auth, error::AppError, extract::Body, handlers::discovery, handlers::status::InvitationStatus,
    AppState,
};

/// How long an invitation delivered inside the application stays good.
pub const DELIVERED_LIFETIME_SECONDS: i64 = 7 * 86_400;

/// How many invitations delivered inside Messagr an account may send a day,
/// UTC (#406). Links sent by SMS are not counted.
pub const PER_DAY: i64 = 10;

/// How long after an invitation ran out unanswered the same account may be
/// invited again (#406): fourteen days after its apparent end, the seventh.
pub const AGAIN_AFTER_SECONDS: i64 = 14 * 86_400;

const DAY_SECONDS: i64 = 86_400;

/// Whether the recipient has not blocked the inviter (#406): what keeps an
/// invitation from a blocked account out of its list, and out of its answers.
/// Columns named with their table, so that nothing added to
/// `delivered_blocks` can rebind them.
const NOT_BLOCKED: &str = "NOT EXISTS (SELECT 1 FROM delivered_blocks b \
     WHERE b.blocker_user_id = delivered_invitations.recipient_user_id \
       AND b.blocked_user_id = delivered_invitations.inviter_user_id)";

/// The size of a sealed name (#405): the 32-byte key HPKE encapsulates
/// (X25519), then the name padded to the 48 bytes a declared name may take,
/// and the 16-byte tag of ChaCha20-Poly1305. The same for every name, so the
/// size says nothing of it.
pub const SEALED_NAME_BYTES: usize = 32 + 48 + 16;

#[derive(Deserialize)]
pub struct SendRequest {
    /// A reference of the directory (`GET /discovery/directory`).
    pub reference: String,
    /// The name the inviter gives itself, sealed for the envelope key the
    /// directory lists with the reference, base64 (#405). Absent, the
    /// invitation arrives without a name.
    #[serde(default)]
    pub sealed_name: Option<String>,
}

/// An invitation, as the one who sent it and the one it waits for see it.
#[derive(Serialize)]
pub struct DeliveredInvitation {
    pub id: String,
    /// Unix time.
    pub expires_at: i64,
    /// Absent while the recipient has not joined; then the account whose room
    /// invite its device waits for (see the module).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inviter_user_id: Option<String>,
    /// The name the inviter gave itself, sealed, base64 (#405): for the
    /// recipient, while the invitation waits for its answer.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sealed_name: Option<String>,
    /// The reference its inviter is findable by now (#407): for the
    /// recipient, while the invitation waits for its answer, and absent once
    /// the inviter is findable no more. See the module.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inviter_reference: Option<String>,
}

#[derive(Serialize)]
pub struct Waiting {
    pub invitations: Vec<DeliveredInvitation>,
}

#[derive(Serialize)]
pub struct Joined {
    /// The account that invited the caller, whose room invite comes next.
    pub inviter_user_id: String,
}

/// `POST /discovery/invitations`: an invitation to the account behind a
/// reference, from a findable account.
///
/// The reference must name a current proof: one withdrawn, run out or
/// replaced since the directory was read names nobody any more. The
/// caller's own reference is refused, since an invitation to oneself leads
/// nowhere.
pub async fn send(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
    Body(req): Body<SendRequest>,
) -> Result<Json<DeliveredInvitation>, AppError> {
    let inviter = discovery::findable_caller(&st, &headers).await?;
    let sealed_name = req
        .sealed_name
        .as_deref()
        .map(|sealed| discovery::decoded_of_size(sealed, SEALED_NAME_BYTES))
        .transpose()?;
    let now = st.cfg.clock.now();
    let recipient = discovery::account_behind(&st, &req.reference, now)
        .await?
        .ok_or(AppError::UnknownReference)?;
    if recipient == inviter {
        return Err(AppError::OwnReference);
    }
    let id = uuid::Uuid::new_v4().simple().to_string();
    let expires_at = now + DELIVERED_LIFETIME_SECONDS;
    // CHECKED AND WRITTEN UNDER ONE LOCK (#406), as `masking_quota.rs` does:
    // two invitations sent together would otherwise both read the counts
    // before either is written, and get past the ten a day, or the one
    // pending, together.
    // A transaction sqlx knows about, for the reason `ceilings.rs` gives: a
    // request dropped while it waits for the lock rolls back with it.
    let mut tx = st
        .pool
        .begin_with("BEGIN IMMEDIATE")
        .await
        .map_err(anyhow::Error::from)?;
    let written = within_limits_then_written(
        &mut tx,
        &Sending {
            id: &id,
            inviter: &inviter,
            recipient: &recipient,
            now,
            expires_at,
            sealed_name,
        },
    )
    .await;
    if written.is_ok() {
        tx.commit().await.map_err(anyhow::Error::from)?;
    } else {
        tx.rollback().await.map_err(anyhow::Error::from)?;
    }
    written?;
    Ok(Json(DeliveredInvitation {
        id,
        expires_at,
        inviter_user_id: None,
        sealed_name: None,
        inviter_reference: None,
    }))
}

/// An invitation about to be written, once the limits allow it.
struct Sending<'a> {
    id: &'a str,
    inviter: &'a str,
    recipient: &'a str,
    now: i64,
    expires_at: i64,
    sealed_name: Option<Vec<u8>>,
}

/// The limits of #406, read under the caller's lock, then the invitation
/// written. They are read the same way whether or not the recipient blocked
/// the inviter, and count its withheld invitations as any other: no refusal
/// may give a block away.
async fn within_limits_then_written(
    conn: &mut sqlx::SqliteConnection,
    s: &Sending<'_>,
) -> Result<(), AppError> {
    let day_start = s.now.div_euclid(DAY_SECONDS) * DAY_SECONDS;
    let sent_today: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM delivered_invitations WHERE inviter_user_id = ? AND sent_at >= ?",
    )
    .bind(s.inviter)
    .bind(day_start)
    .fetch_one(&mut *conn)
    .await
    .map_err(anyhow::Error::from)?;
    if sent_today >= PER_DAY {
        return Err(AppError::DeliveryQuotaReached {
            retry_at: day_start + DAY_SECONDS,
        });
    }
    // THE LATEST DEADLINE OF AN INVITATION TO THIS ACCOUNT LEFT UNANSWERED:
    // one pending until then, and fourteen days more before another. An
    // unanswered one includes a refusal and one never delivered, which read
    // as pending to the inviter. One joined holds nothing back, as the owner
    // decided on 27 September 2026: the two are in a conversation, and the
    // next can still be refused, or blocked.
    let last_deadline: Option<i64> = sqlx::query_scalar(
        "SELECT MAX(expires_at) FROM delivered_invitations \
         WHERE inviter_user_id = ? AND recipient_user_id = ? AND claimed_at IS NULL",
    )
    .bind(s.inviter)
    .bind(s.recipient)
    .fetch_one(&mut *conn)
    .await
    .map_err(anyhow::Error::from)?;
    if let Some(deadline) = last_deadline {
        if s.now < deadline {
            return Err(AppError::InvitationPending);
        }
        if s.now < deadline + AGAIN_AFTER_SECONDS {
            return Err(AppError::InvitedRecently {
                retry_at: deadline + AGAIN_AFTER_SECONDS,
            });
        }
    }
    // A BLOCKED INVITER'S INVITATION IS TAKEN AND NEVER DELIVERED: written as
    // any other, so that it reads « pending » and runs out, and without its
    // sealed name, which nobody will ever open.
    let blocked: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM delivered_blocks \
         WHERE blocker_user_id = ? AND blocked_user_id = ?)",
    )
    .bind(s.recipient)
    .bind(s.inviter)
    .fetch_one(&mut *conn)
    .await
    .map_err(anyhow::Error::from)?;
    sqlx::query(
        "INSERT INTO delivered_invitations \
         (id, inviter_user_id, recipient_user_id, sent_at, expires_at, sealed_name) \
         VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(s.id)
    .bind(s.inviter)
    .bind(s.recipient)
    .bind(s.now)
    .bind(s.expires_at)
    .bind(if blocked {
        None
    } else {
        s.sealed_name.as_deref()
    })
    .execute(&mut *conn)
    .await
    .map_err(anyhow::Error::from)?;
    Ok(())
}

/// `GET /discovery/invitations`: the caller's invitations waiting for an
/// answer, not run out and not declined, and those it joined and has not
/// entered yet, whatever their deadline; oldest first. One waiting for an
/// answer names its inviter by the reference it is findable by, if it still
/// is (#407), and never by its account; one joined names the inviter's
/// account.
///
/// Served even with discovery off, as withdrawing a number is: an invitation
/// already delivered is still the recipient's to answer.
pub async fn waiting(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Waiting>, AppError> {
    let recipient = auth::authenticate(&st.mx, &headers).await?;
    // THE INVITER'S CURRENT PROOF, IF IT HAS ONE (#407): a withdrawn or
    // lapsed one names nobody any more. One account holds one row at most.
    let now = st.cfg.clock.now();
    let rows = sqlx::query(&format!(
        "SELECT id, delivered_invitations.expires_at AS expires_at, inviter_user_id, \
                claimed_at, sealed_name, f.reference AS inviter_reference \
         FROM delivered_invitations \
         LEFT JOIN findable_numbers f ON f.user_id = delivered_invitations.inviter_user_id \
           AND f.withdrawn_at IS NULL AND f.expires_at > ?1 \
         WHERE recipient_user_id = ?2 AND declined = 0 AND entered = 0 AND {NOT_BLOCKED} \
           AND (delivered_invitations.expires_at > ?1 OR claimed_at IS NOT NULL) \
         ORDER BY sent_at, id"
    ))
    .bind(now)
    .bind(&recipient)
    .fetch_all(&st.pool)
    .await
    .map_err(anyhow::Error::from)?;
    let invitations = rows
        .iter()
        .map(|row| {
            let joined = row.get::<Option<i64>, _>("claimed_at").is_some();
            DeliveredInvitation {
                id: row.get("id"),
                expires_at: row.get("expires_at"),
                inviter_user_id: joined.then(|| row.get("inviter_user_id")),
                sealed_name: row
                    .get::<Option<Vec<u8>>, _>("sealed_name")
                    .map(|sealed| BASE64.encode(&sealed)),
                // Joined, the account itself is named: the reference has
                // nothing more to say.
                inviter_reference: if joined {
                    None
                } else {
                    row.get("inviter_reference")
                },
            }
        })
        .collect();
    Ok(Json(Waiting { invitations }))
}

/// `POST /discovery/invitations/:id/join`: the recipient joins, and learns
/// who invited it.
///
/// Joining twice is joining once, and answers the same. See `answerable` for
/// what is refused.
pub async fn join(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Joined>, AppError> {
    let recipient = auth::authenticate(&st.mx, &headers).await?;
    let now = st.cfg.clock.now();
    let row = answerable(&st, &id, &recipient, now).await?;
    if !row.claimed {
        // THE SEALED NAME GOES WITH THE ANSWER (#405): nothing shows it once
        // the invitation is joined.
        sqlx::query(
            "UPDATE delivered_invitations SET claimed_at = ?, sealed_name = NULL \
             WHERE id = ? AND claimed_at IS NULL",
        )
        .bind(now)
        .bind(&id)
        .execute(&st.pool)
        .await
        .map_err(anyhow::Error::from)?;
    }
    Ok(Json(Joined {
        inviter_user_id: row.inviter,
    }))
}

/// `POST /discovery/invitations/:id/decline`: the recipient declines. The
/// invitation leaves its list; the inviter is not told (see the module). An
/// invitation already joined cannot be declined any more: the inviter's
/// device may have let the account in already.
pub async fn decline(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<axum::http::StatusCode, AppError> {
    let recipient = auth::authenticate(&st.mx, &headers).await?;
    let row = answerable(&st, &id, &recipient, st.cfg.clock.now()).await?;
    if row.claimed {
        return Err(AppError::InvitationInvalid);
    }
    let mut tx = st.pool.begin().await.map_err(anyhow::Error::from)?;
    declined_unless_joined(&mut tx, &id).await?;
    tx.commit().await.map_err(anyhow::Error::from)?;
    Ok(axum::http::StatusCode::NO_CONTENT)
}

/// `POST /discovery/invitations/:id/block`: the recipient declines, and
/// blocks the inviter (#406). The invitation leaves its list as a refusal
/// does; the inviter's invitations are never delivered to it any more, and
/// nothing tells the inviter (see the module).
///
/// RECORDED HOWEVER THE INVITATION STANDS, but joined: one that ran out while
/// the screen was open, one already declined on another device, and one
/// blocked already, since a second call after an answer that got lost must
/// not read as a failure. Blocking twice is blocking once.
pub async fn block(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<axum::http::StatusCode, AppError> {
    let recipient = auth::authenticate(&st.mx, &headers).await?;
    let row: Option<(String, Option<i64>)> = sqlx::query_as(
        "SELECT inviter_user_id, claimed_at FROM delivered_invitations \
         WHERE id = ? AND recipient_user_id = ?",
    )
    .bind(&id)
    .bind(&recipient)
    .fetch_optional(&st.pool)
    .await
    .map_err(anyhow::Error::from)?;
    let Some((inviter, None)) = row else {
        return Err(AppError::InvitationInvalid);
    };
    let mut tx = st.pool.begin().await.map_err(anyhow::Error::from)?;
    declined_unless_joined(&mut tx, &id).await?;
    sqlx::query(
        "INSERT INTO delivered_blocks (blocker_user_id, blocked_user_id) VALUES (?, ?) \
         ON CONFLICT DO NOTHING",
    )
    .bind(&recipient)
    .bind(&inviter)
    .execute(&mut *tx)
    .await
    .map_err(anyhow::Error::from)?;
    tx.commit().await.map_err(anyhow::Error::from)?;
    Ok(axum::http::StatusCode::NO_CONTENT)
}

/// Declines `id`, and forgets its sealed name, unless it was joined since it
/// was read: joining and declining can cross, and one joined can no longer be
/// declined (see `decline`).
async fn declined_unless_joined(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    id: &str,
) -> Result<(), AppError> {
    let done = sqlx::query(
        "UPDATE delivered_invitations SET declined = 1, sealed_name = NULL \
         WHERE id = ? AND claimed_at IS NULL",
    )
    .bind(id)
    .execute(&mut **tx)
    .await
    .map_err(anyhow::Error::from)?;
    if done.rows_affected() == 0 {
        return Err(AppError::InvitationInvalid);
    }
    Ok(())
}

/// `POST /discovery/invitations/:id/entered`: the recipient's device entered
/// the conversation of an invitation it joined, and the invitation leaves its
/// list. Saying it twice is saying it once. An invitation not joined, or not
/// the caller's, gets the answer of one that does not exist.
pub async fn entered(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<axum::http::StatusCode, AppError> {
    let recipient = auth::authenticate(&st.mx, &headers).await?;
    let done = sqlx::query(
        "UPDATE delivered_invitations SET entered = 1 \
         WHERE id = ? AND recipient_user_id = ? AND claimed_at IS NOT NULL",
    )
    .bind(&id)
    .bind(&recipient)
    .execute(&st.pool)
    .await
    .map_err(anyhow::Error::from)?;
    if done.rows_affected() == 0 {
        return Err(AppError::InvitationInvalid);
    }
    Ok(axum::http::StatusCode::NO_CONTENT)
}

/// An invitation the caller may still answer, as joining and declining read
/// it.
struct Answerable {
    inviter: String,
    claimed: bool,
}

/// The caller's invitation `id`, if it may still answer it.
///
/// One that is not the caller's, or that it declined, gets the answer of one
/// that does not exist (`InvitationInvalid`). One that ran out without being
/// joined gets `InvitationExpired`, for the reason a link's holder does
/// (`claim.rs`): the caller is named on it and saw its deadline, and knowing
/// that it ran out tells it to ask for another rather than to retry. Once
/// joined, the deadline no longer applies: the answer was given in time.
async fn answerable(
    st: &AppState,
    id: &str,
    recipient: &str,
    now: i64,
) -> Result<Answerable, AppError> {
    // One from an inviter the caller blocked is not the caller's to answer:
    // it was never delivered (#406).
    let row = sqlx::query(&format!(
        "SELECT inviter_user_id, expires_at, claimed_at, declined FROM delivered_invitations \
         WHERE id = ? AND recipient_user_id = ? AND {NOT_BLOCKED}"
    ))
    .bind(id)
    .bind(recipient)
    .fetch_optional(&st.pool)
    .await
    .map_err(anyhow::Error::from)?
    .ok_or(AppError::InvitationInvalid)?;
    if row.get::<i64, _>("declined") != 0 {
        return Err(AppError::InvitationInvalid);
    }
    let claimed = row.get::<Option<i64>, _>("claimed_at").is_some();
    if !claimed && now >= row.get::<i64, _>("expires_at") {
        return Err(AppError::InvitationExpired);
    }
    Ok(Answerable {
        inviter: row.get("inviter_user_id"),
        claimed,
    })
}

/// `GET /discovery/invitations/:id`: where the caller's invitation stands,
/// in the fields of a link's status (`status.rs`) with a meaning of its own.
///
/// « pending » until it runs out, whether the recipient has seen it, declined
/// it or neither; « expired » after; « claimed » once the recipient joined,
/// with the account the inviter's device invites (`entrant_user_id`).
///
/// A LINK'S STATUS NAMES ITS ENTRANT WHILE « pending », AND THIS ONE ONLY ONCE
/// « claimed »: the application reads the two with two readers. And unlike a
/// link, which reads « expired » once its deadline has passed even when
/// claimed, since its secrets are purged by then, an invitation joined in time
/// stays « claimed » after its deadline: the recipient answered before it,
/// and an inviter's device that reads late must still let it in. To anybody
/// but the inviter, it does not exist.
pub async fn status(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<InvitationStatus>, AppError> {
    let caller = auth::authenticate(&st.mx, &headers).await?;
    let row = sqlx::query(
        "SELECT inviter_user_id, recipient_user_id, expires_at, claimed_at \
         FROM delivered_invitations WHERE id = ?",
    )
    .bind(&id)
    .fetch_optional(&st.pool)
    .await
    .map_err(anyhow::Error::from)?
    .ok_or(AppError::InvitationInvalid)?;
    if row.get::<String, _>("inviter_user_id") != caller {
        return Err(AppError::InvitationInvalid);
    }
    let recipient: String = row.get("recipient_user_id");
    let expires_at: i64 = row.get("expires_at");
    let answer = match row.get::<Option<i64>, _>("claimed_at") {
        Some(claimed_at) => InvitationStatus {
            status: "claimed".into(),
            claimed_user_id: Some(recipient.clone()),
            claimed_at: Some(claimed_at),
            entrant_user_id: Some(recipient),
        },
        None => InvitationStatus {
            status: if st.cfg.clock.now() >= expires_at {
                "expired"
            } else {
                "pending"
            }
            .into(),
            claimed_user_id: None,
            claimed_at: None,
            entrant_user_id: None,
        },
    };
    Ok(Json(answer))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::handlers::discovery::test_support::{
        bearer, fake_ovhcloud, prove, reference_of, set_clock, state_at, whoami_hs, DAY, NUMBER,
        OTHER, T0,
    };
    use serde_json::json;
    use sqlx::SqlitePool;

    /// Alice and Bob, each findable with a number of their own, at `T0`, and
    /// Bob's reference.
    async fn two_findable(
        pool: SqlitePool,
    ) -> (Arc<AppState>, Arc<std::sync::atomic::AtomicI64>, String) {
        let (ovh, inbox) = fake_ovhcloud(false).await;
        let (clock, time) = crate::util::Clock::settable(T0);
        let st = state_at(pool, whoami_hs().await, Some(ovh), clock);
        prove(&st, &inbox, "alice", NUMBER).await;
        prove(&st, &inbox, "bob", OTHER).await;
        let bob = reference_of(&st.pool, "bob").await.unwrap();
        (st, time, bob)
    }

    async fn sent(st: &Arc<AppState>, who: &str, reference: &str) -> Result<String, AppError> {
        sent_with(st, who, reference, None).await
    }

    /// The same, with a sealed name (#405), base64.
    async fn sent_with(
        st: &Arc<AppState>,
        who: &str,
        reference: &str,
        sealed: Option<&str>,
    ) -> Result<String, AppError> {
        send(
            State(st.clone()),
            bearer(who),
            Body(SendRequest {
                reference: reference.into(),
                sealed_name: sealed.map(Into::into),
            }),
        )
        .await
        .map(|Json(s)| s.id)
    }

    /// `who`, findable at `T0` for 28 days, written straight into the table
    /// rather than proved: the limits need more accounts than a day's SMS
    /// ceilings let prove. Its reference.
    async fn listed(st: &Arc<AppState>, who: &str) -> String {
        let reference = format!("ref-{who}");
        sqlx::query(
            "INSERT INTO findable_numbers (key_id, mask, user_id, reference, proven_at, expires_at) \
             VALUES (1, ?, ?, ?, ?, ?)",
        )
        .bind(who.as_bytes())
        .bind(format!("@{who}:h"))
        .bind(&reference)
        .bind(T0)
        .bind(T0 + discovery::PROOF_LIFETIME_SECONDS)
        .execute(&st.pool)
        .await
        .unwrap();
        reference
    }

    /// `blocker` has blocked `blocked`, written straight into the table.
    async fn blocking(st: &Arc<AppState>, blocker: &str, blocked: &str) {
        sqlx::query(
            "INSERT INTO delivered_blocks (blocker_user_id, blocked_user_id) VALUES (?, ?)",
        )
        .bind(format!("@{blocker}:h"))
        .bind(format!("@{blocked}:h"))
        .execute(&st.pool)
        .await
        .unwrap();
    }

    async fn blocked(st: &Arc<AppState>, who: &str, id: &str) -> Result<(), AppError> {
        block(State(st.clone()), bearer(who), Path(id.into()))
            .await
            .map(|_| ())
    }

    /// An envelope of the size a device seals, every byte `fill`: the service
    /// cannot tell it from one that holds a name, and has no need to.
    fn envelope(fill: u8) -> String {
        BASE64.encode(&[fill; SEALED_NAME_BYTES])
    }

    /// What the service holds of an invitation's sealed name: `None` once
    /// erased, or once the invitation itself is gone.
    async fn sealed_kept(st: &Arc<AppState>, id: &str) -> Option<Vec<u8>> {
        sqlx::query_scalar::<_, Option<Vec<u8>>>(
            "SELECT sealed_name FROM delivered_invitations WHERE id = ?",
        )
        .bind(id)
        .fetch_optional(&st.pool)
        .await
        .unwrap()
        .flatten()
    }

    async fn waiting_for(st: &Arc<AppState>, who: &str) -> serde_json::Value {
        let Json(w) = waiting(State(st.clone()), bearer(who)).await.unwrap();
        serde_json::to_value(w).unwrap()["invitations"].clone()
    }

    async fn joined(
        st: &Arc<AppState>,
        who: &str,
        id: &str,
    ) -> Result<serde_json::Value, AppError> {
        join(State(st.clone()), bearer(who), Path(id.into()))
            .await
            .map(|Json(j)| serde_json::to_value(j).unwrap())
    }

    async fn said_entered(st: &Arc<AppState>, who: &str, id: &str) -> Result<(), AppError> {
        entered(State(st.clone()), bearer(who), Path(id.into()))
            .await
            .map(|_| ())
    }

    async fn declined(st: &Arc<AppState>, who: &str, id: &str) -> Result<(), AppError> {
        decline(State(st.clone()), bearer(who), Path(id.into()))
            .await
            .map(|_| ())
    }

    async fn status_of(
        st: &Arc<AppState>,
        who: &str,
        id: &str,
    ) -> Result<serde_json::Value, AppError> {
        status(State(st.clone()), bearer(who), Path(id.into()))
            .await
            .map(|Json(s)| serde_json::to_value(s).unwrap())
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn a_deleted_account_neither_waits_for_nor_is_waited_on(pool: SqlitePool) {
        // #410: the invitations delivered to it, and those it sent, run out
        // at once.
        let (st, _, bob) = two_findable(pool).await;
        let alice = reference_of(&st.pool, "alice").await.unwrap();
        let from_alice = sent(&st, "alice", &bob).await.unwrap();
        let to_alice = sent(&st, "bob", &alice).await.unwrap();

        let Json(_) = crate::handlers::deletion::announce(State(st.clone()), bearer("alice"))
            .await
            .unwrap();

        assert_eq!(
            waiting_for(&st, "bob").await,
            json!([]),
            "nothing from Alice waits"
        );
        assert_eq!(
            status_of(&st, "bob", &to_alice).await.unwrap(),
            json!({"status": "expired"}),
            "and Bob's invitation to her has run out"
        );
        assert!(matches!(
            joined(&st, "bob", &from_alice).await,
            Err(AppError::InvitationExpired)
        ));
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn a_deletion_leaves_the_end_of_an_invitation_already_run_out(pool: SqlitePool) {
        // #410: from that end are counted the thirty days of who invited whom
        // (#416) and the fourteen days before inviting again (#406).
        let (st, time, bob) = two_findable(pool).await;
        let id = sent(&st, "alice", &bob).await.unwrap();
        set_clock(&time, T0 + 10 * DAY);

        let Json(_) = crate::handlers::deletion::announce(State(st.clone()), bearer("alice"))
            .await
            .unwrap();

        let ends: i64 =
            sqlx::query_scalar("SELECT expires_at FROM delivered_invitations WHERE id = ?")
                .bind(&id)
                .fetch_one(&st.pool)
                .await
                .unwrap();
        assert_eq!(ends, T0 + 7 * DAY);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn a_findable_account_invites_a_reference_for_a_week(pool: SqlitePool) {
        let (st, _, bob) = two_findable(pool).await;

        let Json(invitation) = send(
            State(st.clone()),
            bearer("alice"),
            Body(SendRequest {
                reference: bob.clone(),
                sealed_name: None,
            }),
        )
        .await
        .unwrap();

        assert_eq!(invitation.expires_at, T0 + 7 * DAY);
        assert_eq!(
            waiting_for(&st, "bob").await,
            json!([{
                "id": invitation.id,
                "expires_at": T0 + 7 * DAY,
                "inviter_reference": reference_of(&st.pool, "alice").await.unwrap(),
            }]),
            "waiting for an answer, it names its inviter by reference only"
        );
        assert_eq!(waiting_for(&st, "alice").await, json!([]));
        let (inviter, recipient): (String, String) = sqlx::query_as(
            "SELECT inviter_user_id, recipient_user_id FROM delivered_invitations WHERE id = ?",
        )
        .bind(&invitation.id)
        .fetch_one(&st.pool)
        .await
        .unwrap();
        assert_eq!(
            (inviter.as_str(), recipient.as_str()),
            ("@alice:h", "@bob:h"),
            "who invites whom, from the moment it leaves"
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn only_a_findable_account_invites_and_only_a_current_proof_is_invited(pool: SqlitePool) {
        let (st, time, bob) = two_findable(pool).await;

        assert!(matches!(
            sent(&st, "carol", &bob).await,
            Err(AppError::NotFindable)
        ));
        assert!(matches!(
            sent(&st, "alice", "no-such-reference").await,
            Err(AppError::UnknownReference)
        ));
        let own = reference_of(&st.pool, "alice").await.unwrap();
        assert!(matches!(
            sent(&st, "alice", &own).await,
            Err(AppError::OwnReference)
        ));
        crate::handlers::discovery::withdraw_number(State(st.clone()), bearer("bob"))
            .await
            .unwrap();
        assert!(
            matches!(
                sent(&st, "alice", &bob).await,
                Err(AppError::UnknownReference)
            ),
            "a number withdrawn names nobody"
        );
        set_clock(&time, T0 + 28 * DAY);
        assert!(
            matches!(sent(&st, "alice", &own).await, Err(AppError::NotFindable)),
            "a proof run out invites nobody"
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn joining_tells_each_side_the_other_and_only_then(pool: SqlitePool) {
        let (st, _, bob) = two_findable(pool).await;
        let id = sent(&st, "alice", &bob).await.unwrap();
        assert_eq!(
            status_of(&st, "alice", &id).await.unwrap(),
            json!({"status": "pending"})
        );

        let answer = joined(&st, "bob", &id).await.unwrap();
        assert_eq!(answer, json!({"inviter_user_id": "@alice:h"}));
        assert_eq!(
            joined(&st, "bob", &id).await.unwrap(),
            answer,
            "joining twice is joining once"
        );

        assert_eq!(
            status_of(&st, "alice", &id).await.unwrap(),
            json!({
                "status": "claimed",
                "claimed_user_id": "@bob:h",
                "claimed_at": T0,
                "entrant_user_id": "@bob:h"
            })
        );
        assert_eq!(
            waiting_for(&st, "bob").await,
            json!([{"id": id, "expires_at": T0 + 7 * DAY, "inviter_user_id": "@alice:h"}]),
            "joined, it stays until the deadline, naming whose room invite comes"
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn nobody_but_the_recipient_answers_and_nobody_but_the_inviter_reads(pool: SqlitePool) {
        let (st, _, bob) = two_findable(pool).await;
        let id = sent(&st, "alice", &bob).await.unwrap();

        for who in ["alice", "carol"] {
            assert!(matches!(
                joined(&st, who, &id).await,
                Err(AppError::InvitationInvalid)
            ));
            assert!(matches!(
                declined(&st, who, &id).await,
                Err(AppError::InvitationInvalid)
            ));
        }
        for who in ["bob", "carol"] {
            assert!(matches!(
                status_of(&st, who, &id).await,
                Err(AppError::InvitationInvalid)
            ));
        }
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn an_invitation_runs_out_on_the_seventh_day_unless_joined_in_time(pool: SqlitePool) {
        let (st, time, bob) = two_findable(pool).await;
        // Two inviters, since one account has one invitation pending at a
        // time for another (#406).
        listed(&st, "carol").await;
        let ran_out = sent(&st, "alice", &bob).await.unwrap();
        let joined_in_time = sent(&st, "carol", &bob).await.unwrap();

        set_clock(&time, T0 + 7 * DAY - 1);
        joined(&st, "bob", &joined_in_time).await.unwrap();
        assert_eq!(
            status_of(&st, "alice", &ran_out).await.unwrap(),
            json!({"status": "pending"})
        );

        set_clock(&time, T0 + 7 * DAY);
        assert_eq!(
            waiting_for(&st, "bob").await,
            json!([{
                "id": joined_in_time,
                "expires_at": T0 + 7 * DAY,
                "inviter_user_id": "@carol:h"
            }]),
            "the one run out leaves the list; the one joined in time stays until entered"
        );
        assert_eq!(
            status_of(&st, "alice", &ran_out).await.unwrap(),
            json!({"status": "expired"})
        );
        assert!(matches!(
            joined(&st, "bob", &ran_out).await,
            Err(AppError::InvitationExpired)
        ));
        assert!(matches!(
            declined(&st, "bob", &ran_out).await,
            Err(AppError::InvitationExpired)
        ));
        assert_eq!(
            status_of(&st, "carol", &joined_in_time).await.unwrap()["status"],
            "claimed",
            "answered in time, it is let in however late the inviter reads"
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn a_refusal_reads_as_an_invitation_nobody_has_seen(pool: SqlitePool) {
        let (st, time, bob) = two_findable(pool).await;
        listed(&st, "carol").await;
        let refused = sent(&st, "alice", &bob).await.unwrap();
        let unseen = sent(&st, "carol", &bob).await.unwrap();

        declined(&st, "bob", &refused).await.unwrap();

        assert_eq!(
            waiting_for(&st, "bob").await,
            json!([{"id": unseen, "expires_at": T0 + 7 * DAY, "inviter_reference": "ref-carol"}]),
            "declined, it leaves the recipient's list"
        );
        assert!(matches!(
            joined(&st, "bob", &refused).await,
            Err(AppError::InvitationInvalid)
        ));
        for at in [T0, T0 + 7 * DAY - 1, T0 + 7 * DAY, T0 + 20 * DAY] {
            set_clock(&time, at);
            assert_eq!(
                status_of(&st, "alice", &refused).await.unwrap(),
                status_of(&st, "carol", &unseen).await.unwrap(),
                "at {at}, an inviter cannot tell a refusal from an invitation nobody saw"
            );
        }
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn an_invitation_joined_cannot_be_declined(pool: SqlitePool) {
        let (st, _, bob) = two_findable(pool).await;
        let id = sent(&st, "alice", &bob).await.unwrap();
        joined(&st, "bob", &id).await.unwrap();

        assert!(matches!(
            declined(&st, "bob", &id).await,
            Err(AppError::InvitationInvalid)
        ));
        assert_eq!(
            status_of(&st, "alice", &id).await.unwrap()["status"],
            "claimed"
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn who_invited_whom_is_forgotten_thirty_days_after_the_invitation_ended(
        pool: SqlitePool,
    ) {
        let (st, _, bob) = two_findable(pool).await;
        listed(&st, "carol").await;
        let claimed = sent(&st, "alice", &bob).await.unwrap();
        let _ran_out = sent(&st, "carol", &bob).await.unwrap();
        joined(&st, "bob", &claimed).await.unwrap();
        let kept = || async {
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM delivered_invitations")
                .fetch_one(&st.pool)
                .await
                .unwrap()
        };
        let purge = |at| crate::cleanup::purge_delivered_invitations(&st.pool, at, 30);

        assert_eq!(purge(T0 + 30 * DAY - 1).await.unwrap(), 0);
        assert_eq!(
            purge(T0 + 30 * DAY).await.unwrap(),
            1,
            "the one joined at T0"
        );
        assert_eq!(kept().await, 1);
        assert_eq!(
            purge(T0 + 37 * DAY).await.unwrap(),
            1,
            "the one that ran out at T0 + 7 days"
        );
        assert_eq!(kept().await, 0);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn a_refusal_is_forgotten_at_the_deadline(pool: SqlitePool) {
        let (st, time, bob) = two_findable(pool).await;
        let id = sent(&st, "alice", &bob).await.unwrap();
        declined(&st, "bob", &id).await.unwrap();
        let refusals = || async {
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM delivered_invitations WHERE declined = 1",
            )
            .fetch_one(&st.pool)
            .await
            .unwrap()
        };

        crate::cleanup::purge_delivered_invitations(&st.pool, T0 + 7 * DAY - 1, 30)
            .await
            .unwrap();
        assert_eq!(refusals().await, 1, "still of use before the deadline");
        crate::cleanup::purge_delivered_invitations(&st.pool, T0 + 7 * DAY, 30)
            .await
            .unwrap();
        assert_eq!(refusals().await, 0);
        set_clock(&time, T0 + 7 * DAY);
        assert!(
            matches!(
                joined(&st, "bob", &id).await,
                Err(AppError::InvitationExpired)
            ),
            "and the invitation, run out, is answered as one that ran out"
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn a_joined_invitation_stays_listed_until_the_device_says_it_entered(pool: SqlitePool) {
        let (st, time, bob) = two_findable(pool).await;
        let id = sent(&st, "alice", &bob).await.unwrap();
        joined(&st, "bob", &id).await.unwrap();

        set_clock(&time, T0 + 20 * DAY);
        assert_eq!(
            waiting_for(&st, "bob").await,
            json!([{"id": id, "expires_at": T0 + 7 * DAY, "inviter_user_id": "@alice:h"}]),
            "past the deadline, the inviter's device may still let it in"
        );

        said_entered(&st, "bob", &id).await.unwrap();
        said_entered(&st, "bob", &id)
            .await
            .expect("saying it twice is saying it once");
        assert_eq!(waiting_for(&st, "bob").await, json!([]));
        assert_eq!(
            status_of(&st, "alice", &id).await.unwrap()["status"],
            "claimed",
            "the inviter reads nothing new"
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn only_the_recipient_says_it_entered_and_only_once_joined(pool: SqlitePool) {
        let (st, _, bob) = two_findable(pool).await;
        let id = sent(&st, "alice", &bob).await.unwrap();

        assert!(
            matches!(
                said_entered(&st, "bob", &id).await,
                Err(AppError::InvitationInvalid)
            ),
            "not joined yet"
        );
        joined(&st, "bob", &id).await.unwrap();
        for who in ["alice", "carol"] {
            assert!(matches!(
                said_entered(&st, who, &id).await,
                Err(AppError::InvitationInvalid)
            ));
        }
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn the_service_has_nowhere_to_keep_the_conversation(pool: SqlitePool) {
        let columns: Vec<String> =
            sqlx::query_scalar("SELECT name FROM pragma_table_info('delivered_invitations')")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert_eq!(
            columns,
            [
                "id",
                "inviter_user_id",
                "recipient_user_id",
                "sent_at",
                "expires_at",
                "claimed_at",
                "declined",
                "entered",
                "sealed_name"
            ]
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn the_sealed_name_is_passed_on_as_it_was_sent_and_only_to_the_recipient(
        pool: SqlitePool,
    ) {
        let (st, _, bob) = two_findable(pool).await;
        let sealed = envelope(7);

        let id = sent_with(&st, "alice", &bob, Some(&sealed)).await.unwrap();

        assert_eq!(
            waiting_for(&st, "bob").await,
            json!([{
                "id": id,
                "expires_at": T0 + 7 * DAY,
                "sealed_name": sealed,
                "inviter_reference": reference_of(&st.pool, "alice").await.unwrap(),
            }]),
        );
        // ALL THE SERVICE HOLDS OF THE NAME IS THE ENVELOPE, byte for byte: it
        // never receives anything else, and nothing opens it here.
        assert_eq!(
            sealed_kept(&st, &id).await,
            Some(vec![7; SEALED_NAME_BYTES])
        );
        let told = status_of(&st, "alice", &id).await.unwrap();
        assert!(told.get("sealed_name").is_none(), "{told}");
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn a_sealed_name_of_any_other_size_is_refused_and_nothing_leaves(pool: SqlitePool) {
        let (st, _, bob) = two_findable(pool).await;

        for wrong in [
            BASE64.encode(&[7; SEALED_NAME_BYTES - 1]),
            BASE64.encode(&[7; SEALED_NAME_BYTES + 1]),
            "not base64 at all".to_string(),
        ] {
            assert!(matches!(
                sent_with(&st, "alice", &bob, Some(&wrong)).await,
                Err(AppError::MalformedEnvelope)
            ));
        }
        assert_eq!(waiting_for(&st, "bob").await, json!([]));
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn the_sealed_name_is_erased_by_an_answer_at_the_deadline_and_with_the_invitation(
        pool: SqlitePool,
    ) {
        let (st, time, bob) = two_findable(pool).await;
        listed(&st, "carol").await;
        listed(&st, "dave").await;
        let joined_one = sent_with(&st, "alice", &bob, Some(&envelope(1)))
            .await
            .unwrap();
        let declined_one = sent_with(&st, "carol", &bob, Some(&envelope(2)))
            .await
            .unwrap();
        let unanswered = sent_with(&st, "dave", &bob, Some(&envelope(3)))
            .await
            .unwrap();

        joined(&st, "bob", &joined_one).await.unwrap();
        declined(&st, "bob", &declined_one).await.unwrap();

        assert_eq!(sealed_kept(&st, &joined_one).await, None);
        assert_eq!(sealed_kept(&st, &declined_one).await, None);
        // Sent in the same second, so listed in no order that matters here.
        let listed = waiting_for(&st, "bob").await;
        let entry = |id: &str| {
            listed
                .as_array()
                .unwrap()
                .iter()
                .find(|one| one["id"] == id)
                .cloned()
        };
        assert_eq!(listed.as_array().unwrap().len(), 2);
        assert_eq!(
            entry(&joined_one),
            Some(
                json!({"id": joined_one, "expires_at": T0 + 7 * DAY, "inviter_user_id": "@alice:h"})
            ),
            "joined, it names the inviter and no longer carries the name"
        );
        assert_eq!(
            entry(&unanswered),
            Some(json!({
                "id": unanswered,
                "expires_at": T0 + 7 * DAY,
                "sealed_name": envelope(3),
                "inviter_reference": "ref-dave",
            })),
        );
        crate::cleanup::purge_delivered_invitations(&st.pool, T0 + 7 * DAY - 1, 30)
            .await
            .unwrap();
        assert_eq!(
            sealed_kept(&st, &unanswered).await,
            Some(vec![3; SEALED_NAME_BYTES]),
            "still of use before the deadline"
        );
        set_clock(&time, T0 + 7 * DAY);
        crate::cleanup::purge_delivered_invitations(&st.pool, T0 + 7 * DAY, 30)
            .await
            .unwrap();
        assert_eq!(sealed_kept(&st, &unanswered).await, None);
        let rows = || async {
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM delivered_invitations WHERE id = ?")
                .bind(&unanswered)
                .fetch_one(&st.pool)
                .await
                .unwrap()
        };
        assert_eq!(rows().await, 1, "who invited whom is kept thirty days");
        crate::cleanup::purge_delivered_invitations(&st.pool, T0 + 37 * DAY, 30)
            .await
            .unwrap();
        assert_eq!(rows().await, 0, "and goes with everything it held");
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn a_second_invitation_to_the_same_account_waits_for_the_first(pool: SqlitePool) {
        let (st, time, bob) = two_findable(pool).await;
        sent(&st, "alice", &bob).await.unwrap();

        set_clock(&time, T0 + 7 * DAY - 1);
        assert!(matches!(
            sent(&st, "alice", &bob).await,
            Err(AppError::InvitationPending)
        ));
        // Somebody else may invite Bob meanwhile.
        listed(&st, "carol").await;
        sent(&st, "carol", &bob).await.unwrap();
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn fourteen_days_after_one_ran_out_before_the_same_account_again(pool: SqlitePool) {
        let (st, time, bob) = two_findable(pool).await;
        sent(&st, "alice", &bob).await.unwrap();
        let again = T0 + 7 * DAY + 14 * DAY;

        for at in [T0 + 7 * DAY, again - 1] {
            set_clock(&time, at);
            assert!(
                matches!(
                    sent(&st, "alice", &bob).await,
                    Err(AppError::InvitedRecently { retry_at }) if retry_at == again
                ),
                "at {at}"
            );
        }
        set_clock(&time, again);
        assert!(sent(&st, "alice", &bob).await.is_ok());
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn an_invitation_joined_holds_nothing_back(pool: SqlitePool) {
        let (st, _, bob) = two_findable(pool).await;
        let id = sent(&st, "alice", &bob).await.unwrap();

        joined(&st, "bob", &id).await.unwrap();

        assert!(sent(&st, "alice", &bob).await.is_ok());
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn ten_a_day_and_the_eleventh_says_when_the_next_day_starts(pool: SqlitePool) {
        let (st, time, _) = two_findable(pool).await;
        // Midway through a day, UTC.
        let day_start = T0 - T0.rem_euclid(DAY);
        set_clock(&time, day_start + DAY / 2);
        let mut references = Vec::new();
        for n in 0..=PER_DAY {
            references.push(listed(&st, &format!("r{n}")).await);
        }

        for reference in &references[..PER_DAY as usize] {
            sent(&st, "alice", reference).await.unwrap();
        }
        let eleventh = &references[PER_DAY as usize];
        assert!(matches!(
            sent(&st, "alice", eleventh).await,
            Err(AppError::DeliveryQuotaReached { retry_at }) if retry_at == day_start + DAY
        ));
        // Bob's allowance is his own.
        sent(&st, "bob", eleventh).await.unwrap();

        set_clock(&time, day_start + DAY);
        let twelfth = listed(&st, "r-next").await;
        assert!(sent(&st, "alice", &twelfth).await.is_ok());
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn a_block_is_silent_and_the_blocked_account_s_invitations_are_never_delivered(
        pool: SqlitePool,
    ) {
        let (st, time, bob) = two_findable(pool).await;
        let first = sent(&st, "alice", &bob).await.unwrap();

        blocked(&st, "bob", &first).await.unwrap();

        assert_eq!(waiting_for(&st, "bob").await, json!([]));
        // TO THE INVITER, A BLOCK READS AS AN INVITATION NOBODY SAW: pending
        // until its deadline, then expired.
        assert_eq!(
            status_of(&st, "alice", &first).await.unwrap()["status"],
            "pending"
        );
        set_clock(&time, T0 + 7 * DAY);
        assert_eq!(
            status_of(&st, "alice", &first).await.unwrap()["status"],
            "expired"
        );

        // Taken as any other, limits included, and never delivered.
        set_clock(&time, T0 + 21 * DAY);
        let later = sent_with(&st, "alice", &bob, Some(&envelope(5)))
            .await
            .unwrap();
        assert!(matches!(
            sent(&st, "alice", &bob).await,
            Err(AppError::InvitationPending)
        ));
        assert_eq!(waiting_for(&st, "bob").await, json!([]));
        assert!(matches!(
            joined(&st, "bob", &later).await,
            Err(AppError::InvitationInvalid)
        ));
        assert_eq!(
            sealed_kept(&st, &later).await,
            None,
            "its name is not even kept"
        );
        assert_eq!(
            status_of(&st, "alice", &later).await.unwrap()["status"],
            "pending"
        );
        set_clock(&time, T0 + 28 * DAY);
        assert_eq!(
            status_of(&st, "alice", &later).await.unwrap()["status"],
            "expired"
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn a_block_holds_back_nobody_else_and_blocking_twice_is_once(pool: SqlitePool) {
        let (st, _, bob) = two_findable(pool).await;
        listed(&st, "carol").await;
        let from_alice = sent(&st, "alice", &bob).await.unwrap();
        let from_carol = sent(&st, "carol", &bob).await.unwrap();

        blocked(&st, "bob", &from_alice).await.unwrap();
        // A second call after an answer that got lost is not a failure.
        blocked(&st, "bob", &from_alice).await.unwrap();

        let listed_now = waiting_for(&st, "bob").await;
        assert_eq!(listed_now.as_array().unwrap().len(), 1);
        assert_eq!(listed_now[0]["id"], from_carol);
        let blocks: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM delivered_blocks")
            .fetch_one(&st.pool)
            .await
            .unwrap();
        assert_eq!(blocks, 1);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn an_invitation_joined_cannot_block(pool: SqlitePool) {
        let (st, _, bob) = two_findable(pool).await;
        let id = sent(&st, "alice", &bob).await.unwrap();
        joined(&st, "bob", &id).await.unwrap();

        assert!(matches!(
            blocked(&st, "bob", &id).await,
            Err(AppError::InvitationInvalid)
        ));
        assert!(matches!(
            blocked(&st, "alice", &id).await,
            Err(AppError::InvitationInvalid)
        ));
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn invitations_sent_together_cannot_get_past_the_limits(pool: SqlitePool) {
        let (st, _, bob) = two_findable(pool).await;

        let (a, b, c) = tokio::join!(
            sent(&st, "alice", &bob),
            sent(&st, "alice", &bob),
            sent(&st, "alice", &bob),
        );
        assert_eq!(
            [a, b, c].into_iter().filter(Result::is_ok).count(),
            1,
            "one pending at a time, however they are sent"
        );

        let mut references = Vec::new();
        for n in 0..12 {
            references.push(listed(&st, &format!("r{n}")).await);
        }
        listed(&st, "carol").await;
        let mut together = tokio::task::JoinSet::new();
        for reference in references {
            let st = st.clone();
            together.spawn(async move { sent(&st, "carol", &reference).await });
        }
        let (mut went, mut held_back) = (0, 0);
        while let Some(result) = together.join_next().await {
            match result.unwrap() {
                Ok(_) => went += 1,
                Err(AppError::DeliveryQuotaReached { .. }) => held_back += 1,
                Err(other) => panic!("{other:?}"),
            }
        }
        assert_eq!(
            (went, held_back),
            (PER_DAY, 2),
            "ten a day, however they are sent"
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn links_are_not_counted_in_the_ten_a_day(pool: SqlitePool) {
        let (st, _, bob) = two_findable(pool).await;
        for n in 0..PER_DAY {
            sqlx::query(
                "INSERT INTO invitations \
                 (id, inviter_user_id, token_sha256, created_at, expires_at, max_uses, \
                  used_count, status) \
                 VALUES (?, '@alice:h', ?, ?, ?, 1, 0, 'pending')",
            )
            .bind(format!("link-{n}"))
            .bind(crate::crypto::token_hash(&format!("link-{n}")))
            .bind(T0)
            .bind(T0 + DAY)
            .execute(&st.pool)
            .await
            .unwrap();
        }

        assert!(sent(&st, "alice", &bob).await.is_ok());
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn a_withheld_invitation_reads_and_counts_as_any_other(pool: SqlitePool) {
        let (st, time, bob) = two_findable(pool).await;
        listed(&st, "carol").await;
        let dave = listed(&st, "dave").await;
        blocking(&st, "bob", "alice").await;

        // THE SAME ANSWERS, to the letter, for an invitation withheld and one
        // simply unanswered.
        let withheld = send(
            State(st.clone()),
            bearer("alice"),
            Body(SendRequest {
                reference: bob.clone(),
                sealed_name: None,
            }),
        )
        .await
        .unwrap()
        .0;
        let unanswered = send(
            State(st.clone()),
            bearer("carol"),
            Body(SendRequest {
                reference: dave.clone(),
                sealed_name: None,
            }),
        )
        .await
        .unwrap()
        .0;
        assert_eq!(withheld.expires_at, unanswered.expires_at);
        let shape = |i: &DeliveredInvitation| {
            let mut v = serde_json::to_value(i).unwrap();
            v["id"] = json!("…");
            v
        };
        assert_eq!(shape(&withheld), shape(&unanswered));
        for at in [T0, T0 + 7 * DAY, T0 + 20 * DAY] {
            set_clock(&time, at);
            assert_eq!(
                status_of(&st, "alice", &withheld.id).await.unwrap(),
                status_of(&st, "carol", &unanswered.id).await.unwrap(),
                "at {at}"
            );
        }
        // And the same limits: fourteen days after its deadline...
        for (who, reference) in [("alice", &bob), ("carol", &dave)] {
            assert!(
                matches!(
                    sent(&st, who, reference).await,
                    Err(AppError::InvitedRecently { retry_at }) if retry_at == T0 + 21 * DAY
                ),
                "{who}"
            );
        }
        // ...and in the ten a day.
        set_clock(&time, T0 + 21 * DAY);
        let mut references = Vec::new();
        for n in 0..PER_DAY - 1 {
            references.push(listed(&st, &format!("r{n}")).await);
        }
        sent(&st, "alice", &bob).await.unwrap();
        for reference in &references {
            sent(&st, "alice", reference).await.unwrap();
        }
        let one_more = listed(&st, "r-more").await;
        assert!(matches!(
            sent(&st, "alice", &one_more).await,
            Err(AppError::DeliveryQuotaReached { .. })
        ));
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn a_block_is_recorded_however_the_invitation_stands_but_joined(pool: SqlitePool) {
        let (st, time, bob) = two_findable(pool).await;
        listed(&st, "carol").await;
        listed(&st, "dave").await;
        let ran_out = sent(&st, "alice", &bob).await.unwrap();
        let declined_elsewhere = sent(&st, "carol", &bob).await.unwrap();
        let joined_one = sent(&st, "dave", &bob).await.unwrap();
        declined(&st, "bob", &declined_elsewhere).await.unwrap();
        joined(&st, "bob", &joined_one).await.unwrap();

        set_clock(&time, T0 + 7 * DAY);
        blocked(&st, "bob", &ran_out).await.unwrap();
        blocked(&st, "bob", &declined_elsewhere).await.unwrap();
        assert!(matches!(
            blocked(&st, "bob", &joined_one).await,
            Err(AppError::InvitationInvalid)
        ));

        let blocks: Vec<String> = sqlx::query_scalar(
            "SELECT blocked_user_id FROM delivered_blocks ORDER BY blocked_user_id",
        )
        .fetch_all(&st.pool)
        .await
        .unwrap();
        assert_eq!(blocks, ["@alice:h", "@carol:h"]);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn a_block_withdraws_even_an_invitation_joined_and_not_entered(pool: SqlitePool) {
        let (st, _, bob) = two_findable(pool).await;
        let first = sent(&st, "alice", &bob).await.unwrap();
        joined(&st, "bob", &first).await.unwrap();
        // One joined holds nothing back, so another may follow at once.
        let second = sent(&st, "alice", &bob).await.unwrap();

        blocked(&st, "bob", &second).await.unwrap();

        assert_eq!(waiting_for(&st, "bob").await, json!([]));
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn the_recipient_learns_its_inviter_s_reference_while_the_invitation_waits(
        pool: SqlitePool,
    ) {
        let (st, _, bob) = two_findable(pool).await;
        let alice = reference_of(&st.pool, "alice").await.unwrap();
        let id = sent(&st, "alice", &bob).await.unwrap();

        assert_eq!(waiting_for(&st, "bob").await[0]["inviter_reference"], alice);

        // Joined, the account is named, and the reference has nothing more to
        // say.
        joined(&st, "bob", &id).await.unwrap();
        let listed_now = waiting_for(&st, "bob").await;
        assert_eq!(listed_now[0]["inviter_user_id"], "@alice:h");
        assert!(
            listed_now[0].get("inviter_reference").is_none(),
            "{listed_now}"
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn an_inviter_findable_no_more_is_listed_without_a_reference(pool: SqlitePool) {
        let (st, time, bob) = two_findable(pool).await;
        listed(&st, "carol").await;
        sent(&st, "alice", &bob).await.unwrap();
        sent(&st, "carol", &bob).await.unwrap();

        crate::handlers::discovery::withdraw_number(State(st.clone()), bearer("alice"))
            .await
            .unwrap();
        // Carol's proof runs out on its 28th day; the invitations, on their
        // seventh, so the clock only moves within the week here.
        set_clock(&time, T0 + 6 * DAY);
        sqlx::query("UPDATE findable_numbers SET expires_at = ? WHERE user_id = '@carol:h'")
            .bind(T0 + 6 * DAY)
            .execute(&st.pool)
            .await
            .unwrap();

        let listed_now = waiting_for(&st, "bob").await;
        assert_eq!(listed_now.as_array().unwrap().len(), 2);
        for entry in listed_now.as_array().unwrap() {
            assert!(entry.get("inviter_reference").is_none(), "{entry}");
        }
    }
}
