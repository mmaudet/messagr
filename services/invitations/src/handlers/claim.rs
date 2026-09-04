use std::sync::Arc;

use axum::{extract::State, http::HeaderMap, Json};
use serde::{Deserialize, Serialize};
use sqlx::Row;

use crate::{
    auth, crypto,
    error::AppError,
    extract::Body,
    handlers::revoke::deactivate_with_either,
    matrix::{InviteIssue, PendingInviteRoom},
    util::{localpart, now},
    AppState,
};

#[derive(Deserialize)]
pub struct ClaimRequest {
    pub token: String,
    #[serde(default)]
    pub existing_user_id: Option<String>,
}

#[derive(Serialize)]
pub struct ClaimResponse {
    pub user_id: String,
    pub access_token: String,
    pub password: String,
    /// The device that `access_token` belongs to.
    ///
    /// A token alone does not restore a Matrix session: the SDK requires the
    /// triple (`user_id`, `device_id`, `access_token`). Without this field,
    /// the client being handed the account has no choice but to log back in by
    /// password — which creates a SECOND device and makes the token it has
    /// just been given useless. Yet it is precisely the immediately usable
    /// session that avoids the login page reported as a journey defect (§5.4).
    ///
    /// Empty on the "existing user" path, like the other two secrets: the
    /// caller already has its own session there.
    pub device_id: String,
}

/// Decides whether an invitation found in the database is still claimable —
/// and, when it no longer is, SAYS WHICH of the causes applies.
///
/// # THE CUT IS ASYMMETRIC, AND THAT IS THE DESIGN POINT
///
/// Three situations definitively refuse a claim; the service distinguishes
/// only TWO of them, and never the third:
///
/// - **unknown token** — never even reaches this point: `claim` returns
///   `InvitationInvalid` when the query brings back no row, and that is
///   DELIBERATE. Distinguishing it would make the service an ORACLE: whoever
///   presents a value would learn whether it ever existed. A help message has
///   no business becoming a probing instrument, and "harmonising the three" is
///   not the simplification it looks like.
///
/// - **expired** and **revoked** — distinguished, and safely so. To REACH
///   either of these two answers one must present a token THAT EXISTS, and a
///   token cannot be guessed: `crypto::generate_token` draws 160 bits at
///   random. Reading them therefore presupposes that one already holds the
///   token, i.e. that one is the legitimate recipient of the invitation or the
///   bearer of the QR code. We reveal nothing to anyone who did not already
///   know.
///
/// This reasoning is written here because it is not readable in the code:
/// nothing, in three neighbouring `Err`s, says why two are precise and the
/// third mute. It is pinned by
/// `an_unknown_token_stays_indistinguishable_from_an_unknown_status`.
///
/// # REVOCATION WINS OVER EXPIRY
///
/// An invitation can be both: `revoke` sets `status='revoked'` without looking
/// at the clock, so an invitation whose date has already passed can then be
/// revoked. The answer is then "revoked". An expiry can be re-requested; a
/// revocation is a decision of the inviter: sending someone back to ask again
/// when the inviter has just deliberately withdrawn their invitation would be
/// FALSE WITH CONFIDENCE — worse than vague, which was the defect before.
///
/// # ANY OTHER STATUS FALLS BACK TO THE MUTE RESPONSE
///
/// A status this code does not know (a database written by a future version,
/// manual intervention) must not be guessed: `InvitationInvalid` remains the
/// default, as before this fix, and says nothing amiss.
///
/// The ORDER of the checks also matters with respect to `UsesExhausted`: a
/// revoked invitation whose uses were all already consumed is reported as
/// revoked, the most explanatory cause prevailing over the most mechanical
/// one.
pub fn invitation_usable(
    status: &str,
    expires_at: i64,
    used: u32,
    max: u32,
    now: i64,
) -> Result<(), AppError> {
    match status {
        // Revocation first: it prevails even if the date has passed.
        "revoked" => return Err(AppError::InvitationRevoked),
        // `cleanup::expire_invitations` has already run…
        "expired" => return Err(AppError::InvitationExpired),
        // … or not yet: the sweep is periodic, the clock is not.
        // This case is the more frequent of the two in practice.
        "pending" if expires_at <= now => return Err(AppError::InvitationExpired),
        "pending" => {}
        _ => return Err(AppError::InvitationInvalid),
    }
    if used >= max {
        return Err(AppError::UsesExhausted);
    }
    Ok(())
}

/// Order imposed by Matrix, verified on the prototype on 5 August 2026: one
/// cannot invite into a room one is only invited to join, so the reserved
/// account must JOIN before it can INVITE the target. It only leaves
/// afterwards — the invite it emitted survives its departure (also verified)
/// — and is only deactivated last of all.
///
/// Never called outside tests: it exists only so that
/// `the_reserved_account_call_chain_is_ordered` asserts this order to the
/// letter rather than against a copy. Pre-existing and accepted `dead_code`
/// warning (CI, `.github/workflows/ci.yml`) — accepted here precisely, not
/// elsewhere.
#[allow(dead_code)]
pub fn existing_user_call_chain() -> Vec<&'static str> {
    vec!["join", "invite", "leave", "deactivate"]
}

/// Rejects a malformed target BEFORE any irreversible step — and before even
/// the slightest network call. Without this validation, a fanciful
/// `existing_user_id` causes a 400 from the homeserver AFTER the join has
/// succeeded, and leaves the reserved account halfway through the call chain.
fn validate_target(target: &str) -> Result<(), AppError> {
    let well_formed = target.starts_with('@')
        && target[1..].contains(':')
        && !target[1..].starts_with(':')
        && !target.ends_with(':');
    if !well_formed {
        return Err(AppError::InvalidRequest(
            "existing_user_id must be a Matrix identifier of the form @local:server".into(),
        ));
    }
    Ok(())
}

/// The candidate's write guard, defined here so that the test exercises it to
/// the letter rather than a copy.
///
/// `AND status = 'reserved'` is indispensable: a `claimed` row has
/// `password_next_enc = NULL` (the claim erases it), so without this predicate
/// a concurrent caller's write LANDS on it and deposits there a sealed secret
/// that no sweep picks up — `repair_half_deactivated` only looks at
/// `deactivated` rows.
const PERSIST_CANDIDATE: &str = "UPDATE reserved_accounts SET password_next_enc = ? \
     WHERE user_id = ? AND password_next_enc IS NULL AND status = 'reserved'";

/// Finds the room of the pending invitation, or decides the account's fate.
///
/// # TWO CALLERS, TWO USES, ONE DECISION
///
/// - **The place hand-over** ("existing user" path) uses it to FIND the room
///   the reserved account must join in order to invite the target there. The
///   returned `String` is indispensable to it.
///
/// - **The hand-out** ("newcomer" path) uses it to REQUIRE that there be a
///   room, and discards the value: this path neither joins nor invites anyone,
///   it is the account itself that is handed out. That is where the hand-out
///   invariant lives — see its call site, which says why.
///
/// The two share the same arbitration because there is only one to make, and a
/// second copy of the reasoning below would drift from this one.
///
/// The absence of a room has TWO causes, which call for opposite decisions,
/// and it is `PendingInviteRoom` that separates them (see `matrix.rs`):
///
/// - `Left` — the account has LEFT a room without the call chain running to
///   its term, typically a claim interrupted between `leave_room` and
///   `deactivate`. This row is definitively unusable, and leaving it in
///   `status='reserved'` would have it re-selected by EVERY following claim
///   (`... AND status='reserved' LIMIT 1`): a single failed exchange would
///   condemn all the remaining uses of a 10-seat invitation. It is therefore
///   removed from the pool, and the caller retries — the next draw will pick a
///   healthy account.
///
/// - `NeverInvited` — no one has invited this account yet. This is a HEALTHY
///   state, and even the normal state of a freshly created account: the
///   account is created AT CLAIM TIME (lot 0, task 0.2), and the Matrix invite
///   is emitted by the inviter's client, with its own rights (§7). The account
///   stays `reserved`, intact, adopted by the next claim as soon as that
///   invite has been emitted. Removing it from the pool would destroy an
///   account that nothing condemns, and the retry contract of
///   `ReservedAccountUnusable` would destroy one more on each attempt.
///
///   The caller receives `NoPendingRoom` (409, §10.5): it is a WAIT, not
///   a giving-up — §7 makes it the normal state as long as the inviter has
///   not emitted.
///   Certainly not `InvitationInvalid` (404): the service's invitation, for
///   its part, is perfectly valid, only the Matrix room is still missing, and
///   a client receiving a 404 structurally has no reason to retry. And
///   certainly not `ReservedAccountUnusable` either, whose contract (§10.5,
///   `MESSAGR_RETRY`) suggests that a DIFFERENT draw would fix the problem —
///   here it is the SAME account, intact, that will become usable as soon as
///   the inviter has emitted their invite.
async fn pending_room(
    st: &AppState,
    user_id: &str,
    token: &str,
    invitation_id: &str,
) -> Result<String, AppError> {
    match st.mx.pending_invite_room(token).await {
        Err(_) => Err(AppError::HomeserverUnavailable),
        Ok(PendingInviteRoom::Found(room)) => Ok(room),
        Ok(PendingInviteRoom::Left) => {
            remove_from_pool(st, user_id, invitation_id).await?;
            Err(AppError::ReservedAccountUnusable)
        }
        Ok(PendingInviteRoom::NeverInvited) => Err(AppError::NoPendingRoom),
    }
}

/// Takes a row out of the reserved-account pool and neutralises it.
///
/// Reproduces word for word the pattern of `handlers::revoke`: atomic take of
/// the row BEFORE any irreversible action, secrets read back through the
/// `RETURNING` (and not from the caller's snapshot, which a concurrent claim
/// may have made stale), unconditional erasure afterwards.
async fn remove_from_pool(
    st: &AppState,
    user_id: &str,
    invitation_id: &str,
) -> Result<(), AppError> {
    let taken = sqlx::query(
        "UPDATE reserved_accounts SET status='deactivated' \
         WHERE user_id = ? AND status = 'reserved' \
         RETURNING password_enc, password_next_enc, access_token_enc",
    )
    .bind(user_id)
    .fetch_optional(&st.pool)
    .await
    .map_err(anyhow::Error::from)?;
    let Some(fresh) = taken else { return Ok(()) }; // taken elsewhere

    // Logging only, as requested for this task: neither a counter nor a
    // notification. A silent removal here can empty a pool without a trace if
    // an inviter withdraws their Matrix invites in bulk (see the `Left` case
    // in `pending_room` below) — identifiers only, never a secret.
    tracing::warn!(user_id = %user_id, invitation_id = %invitation_id,
        "reserved account removed from the pool: room left before the call \
         chain ran to its term (invite withdrawn by the inviter, or an \
         earlier claim interrupted)");

    let localpart = localpart(user_id);
    // `.ok()` and not `?`: an undecryptable secret is no longer of any use,
    // and giving up here would leave the row `deactivated` while still
    // carrying its secrets. `repair_half_deactivated` would catch it up, but
    // the erasure below must remain the termination guarantee of this very
    // path.
    let pw = crypto::open(
        &st.cfg.encryption_key,
        fresh.get::<Vec<u8>, _>("password_enc").as_slice(),
    )
    .ok();
    let candidate = fresh
        .get::<Option<Vec<u8>>, _>("password_next_enc")
        .and_then(|b| crypto::open(&st.cfg.encryption_key, &b).ok());
    let tk = crypto::open(
        &st.cfg.encryption_key,
        fresh.get::<Vec<u8>, _>("access_token_enc").as_slice(),
    )
    .ok();
    if let (Some(pw), Some(tk)) = (pw, tk) {
        let _ = deactivate_with_either(st, &tk, &localpart, candidate, &pw).await;
    }
    sqlx::query(
        "UPDATE reserved_accounts SET password_enc=X'', \
                 password_next_enc=NULL, access_token_enc=X'' WHERE user_id=?",
    )
    .bind(user_id)
    .execute(&st.pool)
    .await
    .map_err(anyhow::Error::from)?;
    Ok(())
}

/// Records the traceability edge. Written in the consumption transaction for
/// a newcomer, but BEFORE the Matrix call chain for an existing user — see
/// the corresponding call site.
async fn record_edge<'e, E>(
    ex: E,
    inviter: &str,
    invited: &str,
    invitation_id: &str,
    retention_days: i64,
) -> Result<i64, AppError>
where
    E: sqlx::Executor<'e, Database = sqlx::Sqlite>,
{
    let r = sqlx::query(
        "INSERT INTO invitation_edges (inviter_user_id, invited_user_id, invitation_id, \
         redeemed_at, purge_after) VALUES (?,?,?,?,?) RETURNING id",
    )
    .bind(inviter)
    .bind(invited)
    .bind(invitation_id)
    .bind(now())
    .bind(now() + retention_days * 86_400)
    .fetch_one(ex)
    .await
    .map_err(anyhow::Error::from)?;
    Ok(r.get("id"))
}

/// Decrypts the three secrets of a freshly taken row: password, possible
/// candidate, access token.
///
/// The candidate is the only one whose absence is normal, and the only one
/// whose decryption failure is tolerated: a row without a candidate is the
/// common state, and an unreadable candidate does not make the row unusable —
/// the old password remains to be tried. The other two are indispensable.
fn open_secrets(
    key: &[u8; 32],
    row: &sqlx::sqlite::SqliteRow,
) -> Result<(String, Option<String>, String), AppError> {
    let password = crypto::open(key, row.get::<Vec<u8>, _>("password_enc").as_slice())?;
    let candidate = row
        .get::<Option<Vec<u8>>, _>("password_next_enc")
        .and_then(|b| crypto::open(key, &b).ok());
    let token = crypto::open(key, row.get::<Vec<u8>, _>("access_token_enc").as_slice())?;
    Ok((password, candidate, token))
}

/// Removes the edge written just before, when the exchange ultimately did NOT
/// take place.
///
/// The edge precedes the hand-out — that is the normative order of §7. Its
/// price was one edge per failed attempt: three invite rejections left three
/// edges behind them with a usage counter at zero, i.e. a traceability that
/// asserts exchanges which never took place.
///
/// The deletion targets the EXACT identifier of the row we have just inserted
/// — never a criterion, which would carry away another caller's edge — and
/// only happens on the path where it is established that no one was invited.
/// The "over-record rather than under-record" rule is preserved: if the
/// deletion fails, the edge stays, and one falls back to the former
/// behaviour.
async fn remove_edge(st: &AppState, id: i64) {
    if let Err(e) = sqlx::query("DELETE FROM invitation_edges WHERE id = ?")
        .bind(id)
        .execute(&st.pool)
        .await
    {
        tracing::warn!(
            "edge {id} left in the database, yet the exchange did not take place: {e:#}"
        );
    }
}

/// The reserved account cedes its place to an already existing Messagr user:
/// it joins the pending room, invites the real target there, withdraws from
/// it, then neutralises itself. No rotation is needed here — this account
/// will never be handed to anyone, it erases itself.
///
/// Neutralisation goes through `deactivate_with_either` and NOT through
/// `mx.deactivate`: an earlier claim interrupted AFTER its rotation succeeded
/// (transaction guard refused, rollback) returns the row to
/// `status='reserved'` while the account's live password is the CANDIDATE —
/// persisted outside the transaction, hence surviving the rollback. Trying
/// only `password_enc` would fail precisely on those accounts, and a
/// localpart is never freed by the homeserver.
///
/// The secrets received here come from the ATOMIC TAKE of the row, never from
/// the caller's snapshot: that is what makes this power of destruction safe.
/// See the take, just before the call.
/// What the hand-over left behind it, when it did not fail.
///
/// The boundary is the MATRIX INVITE, the only irreversible act of the call
/// chain: before it no one has been placed anywhere, after it a human being
/// is in a real room. A failure BEFORE is an `Err` — the row returns to the
/// pool. A failure AFTER is not one: the target received what it was meant to
/// receive, the use is consumed, and it is this enumeration that says what
/// remains to be done with the row.
#[derive(PartialEq, Eq)]
enum HandOver {
    /// Complete chain: the reserved account is neutralised, the row can be
    /// emptied of its secrets.
    Completed,
    /// The target is in the room, but the reserved account has not finished
    /// erasing itself — `leave` or the deactivation failed.
    ///
    /// Its secrets must REMAIN in the database: they are the only means to
    /// neutralise it, and `repair_half_deactivated` expects them there.
    /// Erasing them would leave a living account that no one can kill any
    /// more.
    InterruptedAfterInvite,
}

// Eight arguments, one over clippy's threshold, and inherited: this function
// arrived with the service when it was internalised. Refactoring it during a
// move would mix two changes -- a relocation whose whole safety argument is
// that the tests pass identically before and after, and a signature change
// that those tests cannot vouch for. Allowed here so the lint holds
// everywhere else; worth revisiting when this handler is next opened for a
// reason of its own.
#[allow(clippy::too_many_arguments)]
async fn hand_over_place(
    st: &AppState,
    token: &str,
    localpart: &str,
    password: &str,
    candidate: Option<String>,
    target: &str,
    room: &str,
    invitation_id: &str,
) -> Result<HandOver, AppError> {
    st.mx
        .join_room(token, room)
        .await
        .map_err(|_| AppError::HomeserverUnavailable)?;
    // `invite` returns `AlreadyThere` when the target is already in the room: this
    // is not a failure, it is the intended result reached in advance, and the
    // call chain must run to its term as if the invite had just been emitted
    // — the reserved account withdraws and neutralises itself, the use is
    // consumed.
    match st.mx.invite(token, room, target).await {
        // THE WAIT IS OVER, so the row that named it must go. Leaving it
        // would keep `status.rs` naming a person who is already a member,
        // and that name outranks the drawn account: the next newcomer would
        // never be named at all, and their claim would wait forever behind
        // an invite that already happened.
        Ok(InviteIssue::Issued) | Ok(InviteIssue::AlreadyThere) => {
            sqlx::query(
                "DELETE FROM pending_existing_invites WHERE invitation_id = ? AND user_id = ?",
            )
            .bind(invitation_id)
            .bind(target)
            .execute(&st.pool)
            .await
            .map_err(anyhow::Error::from)?;
        }
        // The homeserver answers, and it refuses. The row goes back to the
        // pool and the caller loops until someone fixes the room's rights —
        // this is reversible, and it is the right trade-off facing the only
        // alternative, which would be to destroy one reserved account per
        // attempt. But reversible and MUTE is still a lost day: this log and
        // the distinct `errcode` are what tells the operator where to look.
        // Identifiers only, never a secret.
        // ⚠ REFUSED IS THE NORMAL CASE HERE, NOT AN INCIDENT, AND TREATING IT
        // AS ONE MADE THIS PATH IMPOSSIBLE FOR TWO DAYS.
        //
        // A room created by this product sets `m.room.power_levels`'s "invite"
        // to 50 (`core::promotion::PROMOTED_POWER_LEVEL`) and admits members
        // at 0, deliberately, because promotion is a separate gesture. The
        // reserved account therefore CANNOT invite, in any room, ever: 403,
        // always. This branch used to log "the invite will succeed as soon as
        // the right is fixed" and return 503, which reads as an operator
        // problem and is not one -- there is no right to fix, the design says
        // members do not invite.
        //
        // THE PRODUCT ALREADY HAS AN ACCOUNT THAT CAN, AND ALREADY USES IT.
        // The inviter's own client created the room, holds level 100, polls
        // this invitation's status and invites whoever it names. That is how
        // every newcomer enters (`status.rs`'s `entrant_user_id`, the 409
        // wait contract). Recording the target here is what lets an existing
        // account be named there too, and the claim's next attempt finds it
        // a member and completes through `AlreadyThere` above.
        Ok(InviteIssue::Refused(status)) => {
            sqlx::query(
                "INSERT INTO pending_existing_invites (invitation_id, user_id, requested_at) \
                 VALUES (?, ?, ?) ON CONFLICT(invitation_id, user_id) DO NOTHING",
            )
            .bind(invitation_id)
            .bind(target)
            .bind(crate::util::now())
            .execute(&st.pool)
            .await
            .map_err(anyhow::Error::from)?;
            tracing::info!(
                localpart = %localpart, room = %room, target = %target, status = %status,
                "the reserved account may not invite into this room, which is the \
                 designed state; the target is now named to the inviter's client, \
                 which holds the right and invites on its next poll"
            );
            return Err(AppError::NoPendingRoom);
        }
        Err(_) => return Err(AppError::HomeserverUnavailable),
    }

    // ---- BOUNDARY: the target IS in the room. ----
    //
    // The exchange has taken place, from the point of view of the only person
    // it concerns. What follows is no more than the tidying-up of the
    // reserved account, and its failure must neither cancel the exchange nor
    // return an error: otherwise the use is not consumed although a place has
    // indeed been given, the counter underestimates the exchanges performed,
    // and a retry spends a second reserved account for a result already
    // delivered.
    if st.mx.leave_room(token, room).await.is_err() {
        tracing::warn!(
            localpart = %localpart,
            "target invited, but the reserved account could not leave the room: \
             row left to the repair sweep"
        );
        return Ok(HandOver::InterruptedAfterInvite);
    }
    if !deactivate_with_either(st, token, localpart, candidate, password).await {
        tracing::warn!(
            localpart = %localpart,
            "target invited, but the reserved account could not be neutralised: \
             row left to the repair sweep"
        );
        return Ok(HandOver::InterruptedAfterInvite);
    }
    Ok(HandOver::Completed)
}

/// Returns to the pool a row that was taken but ultimately unused.
///
/// The atomic take moves the row DIRECTLY to `deactivated` before the Matrix
/// call chain, to close a race. That is fair as long as the chain succeeds;
/// when it fails before having invited anyone, the row stays taken for
/// nothing, and the reserved account — perfectly healthy — is lost to the
/// invitation. Three attempts were enough to empty a pool of three.
///
/// The `length(password_enc) > 0` guard is what makes the operation safe: it
/// only accepts the row AS the take left it. If `repair_half_deactivated` has
/// run in the meantime, it has deactivated the account on the homeserver and
/// erased the secrets; returning it to the pool would put back a dead
/// account, which the next claim would draw only to fail on it.
async fn return_to_pool(st: &AppState, user_id: &str) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE reserved_accounts SET status='reserved' \
         WHERE user_id = ? AND status = 'deactivated' AND length(password_enc) > 0",
    )
    .bind(user_id)
    .execute(&st.pool)
    .await
    .map_err(anyhow::Error::from)?;
    Ok(())
}

/// What a claim works with: an account this invitation brought into
/// existence, with the secrets needed to hand it out or cede its place.
struct ClaimAccount {
    user_id: String,
    localpart: String,
    /// The password currently known for the account (`password_enc`).
    password: String,
    access_token: String,
    candidate_enc: Option<Vec<u8>>,
}

/// Adopt the account an earlier, interrupted claim left behind — or create
/// one if the invitation has none yet.
///
/// # THE ACCOUNT IS CREATED AT CLAIM TIME, AND ONLY THEN (lot 0, task 0.2)
///
/// `create` registers nothing; the only place a Matrix account comes into
/// existence is here. Two properties make that safe against retries:
///
/// - **Adoption first.** A claim that was interrupted AFTER its account
///   existed leaves a `reserved` (or `claiming`, see below) row behind. The
///   next claim on the same invitation adopts THAT row instead of creating a
///   second account — a retried claim must never create one. Leftovers are
///   therefore not waste: they are the retry's account, already paid for.
/// - **Resume, never restart, a `claiming` trace.** The row was written
///   BEFORE `register_dormant` (see `create_account_for_claim`), so its
///   account may or may not exist. `resume_claim_trace` settles the question
///   with the traced password and completes the row. Without this, a
///   flapping homeserver would turn every retried claim into one more
///   definitive localpart — the unbounded-creation defect, reopened at claim
///   time.
///
/// Concurrency: two simultaneous claims may both find no row and each create
/// an account. That is correct for `max_uses >= 2` (two claimants, two
/// accounts); for `max_uses = 1` the loser's transaction guard
/// (`used_count < max_uses`) refuses the hand-out and its account stays
/// `reserved` — adopted by nobody, neutralised by cleanup at expiry. Bounded
/// by the invitation's own ceiling, never open-ended.
async fn account_for_claim(st: &AppState, invitation_id: &str) -> Result<ClaimAccount, AppError> {
    let row = sqlx::query(
        "SELECT user_id, password_enc, password_next_enc, access_token_enc, status \
         FROM reserved_accounts \
         WHERE invitation_id = ? AND status IN ('reserved','claiming') \
         ORDER BY rowid LIMIT 1",
    )
    .bind(invitation_id)
    .fetch_optional(&st.pool)
    .await
    .map_err(anyhow::Error::from)?;
    let Some(row) = row else {
        return create_account_for_claim(st, invitation_id).await;
    };

    let user_id: String = row.get("user_id");
    let password = crypto::open(
        &st.cfg.encryption_key,
        row.get::<Vec<u8>, _>("password_enc").as_slice(),
    )?;
    let candidate_enc: Option<Vec<u8>> = row.get("password_next_enc");

    if row.get::<String, _>("status") == "claiming" {
        let (user_id, access_token) = resume_claim_trace(st, &user_id, &password).await?;
        return Ok(ClaimAccount {
            localpart: localpart(&user_id),
            user_id,
            password,
            access_token,
            candidate_enc,
        });
    }

    let access_token = crypto::open(
        &st.cfg.encryption_key,
        row.get::<Vec<u8>, _>("access_token_enc").as_slice(),
    )?;
    Ok(ClaimAccount {
        localpart: localpart(&user_id),
        user_id,
        password,
        access_token,
        candidate_enc,
    })
}

/// Settle a `claiming` trace: does its account exist? Then complete the row.
///
/// The trace carries the password but no access token — only the homeserver
/// could issue one, and the interrupted claim never got that far. A `login`
/// with the traced password answers both questions at once: if it succeeds
/// the account exists (the registration had succeeded but its response was
/// lost) and the token is obtained; if it fails the account never existed and
/// the registration is retried UNDER THE SAME NAME AND PASSWORD, so a second
/// attempt cannot create a second account — at worst the homeserver refuses a
/// name it already knows, and the next retry's login completes the row.
async fn resume_claim_trace(
    st: &AppState,
    localpart: &str,
    password: &str,
) -> Result<(String, String), AppError> {
    let (user_id, access_token) = match st.mx.login(localpart, password).await {
        Ok(tk) => {
            let uid = st
                .mx
                .whoami(&tk)
                .await
                .map_err(|_| AppError::HomeserverUnavailable)?;
            (uid, tk)
        }
        Err(_) => {
            let acct = st
                .mx
                .register_dormant(localpart, password)
                .await
                .map_err(|_| AppError::HomeserverUnavailable)?;
            (acct.user_id, acct.access_token)
        }
    };
    // The `status='claiming'` guard is the usual rule of this codebase: never
    // overwrite a row another path may have picked up in the meantime.
    sqlx::query(
        "UPDATE reserved_accounts SET user_id = ?, access_token_enc = ?, status='reserved' \
         WHERE user_id = ? AND status = 'claiming'",
    )
    .bind(&user_id)
    .bind(crypto::seal(&st.cfg.encryption_key, &access_token)?)
    .bind(localpart)
    .execute(&st.pool)
    .await
    .map_err(anyhow::Error::from)?;
    Ok((user_id, access_token))
}

/// Write the trace, THEN register, THEN complete the row.
///
/// # THE ORDER IS THE FIX. DO NOT PUT IT BACK THE "SIMPLE" WAY.
///
/// The rule, in one sentence: **the trace precedes the irreversible act,
/// never the other way round.** It looks like a detour — inserting a row for
/// an account that does not exist yet — and it is exactly what a hurried
/// reader would "simplify" by registering first. Here is what that costs.
///
/// **What the window left BEFORE** (register, then record): an ACCOUNT
/// WITHOUT A ROW. Every sweep starts from `reserved_accounts`; what is not
/// there is unfindable, and a localpart is NEVER freed by the homeserver. A
/// definitive, invisible orphan. The six `messagr-reserved` accounts of the
/// prototype are exactly that.
///
/// **What it leaves NOW**: a ROW WITHOUT AN ACCOUNT — or a row whose account
/// exists, which comes to the same thing for sweeping purposes. Visible,
/// counted by the ceiling, adopted and resumed by the next claim (see
/// `account_for_claim`), gathered by `cleanup::deactivate_orphans` if the
/// invitation dies first. The window is not removed: it falls on the right
/// side.
///
/// The THREE paths through it, and what they now yield:
///
/// 1. process death between registration and completion — `claiming` row,
///    real account: resumed by the next claim, or gathered by cleanup;
/// 2. failure of the completion `UPDATE` (or of a `seal`) — same;
/// 3. **the path that cannot be deduced**: `register_dormant` returns `Err`
///    while the account was in fact created (cut after validation on the
///    Synapse side, expired deadline, amputated 2xx response that
///    `matrix.rs` knowingly refuses). The row is there BEFORE the call, so it
///    survives its failure, and it carries the password needed to honour the
///    account — `resume_claim_trace`'s login-first order exists for precisely
///    this case.
///
/// # Why `status='claiming'` and not `'reserved'`
///
/// Same motive as `purging` in `cleanup.rs`: a transient state that says "an
/// operation is in flight on this row" and keeps it out of the paths that
/// assume a LIVE account — until `resume_claim_trace` has settled whether
/// the account exists, handing the row out would be handing out maybe
/// nothing.
///
/// # The row's key before the homeserver has spoken
///
/// `user_id` carries the BARE LOCALPART until the response comes back: the
/// domain name belongs to the homeserver and we do not know it before it says
/// it. Completion replaces it with the full `@localpart:server`.
/// `util::localpart` reads both forms correctly — which lets cleanup honour a
/// trace row without knowing any of this.
async fn create_account_for_claim(
    st: &AppState,
    invitation_id: &str,
) -> Result<ClaimAccount, AppError> {
    // ---- 1. THE TRACE, before a single network packet. ---------------------
    // Name and password are drawn HERE, caller-side, precisely so they can be
    // written before they are used.
    let localpart = crypto::generate_localpart();
    let password = crypto::generate_password();
    sqlx::query(
        // `access_token_enc` stays EMPTY: only the homeserver can issue it,
        // and it has not been asked yet. It is this emptiness that later tells
        // cleanup it must open a session to honour this row.
        "INSERT INTO reserved_accounts (user_id, invitation_id, password_enc, \
         access_token_enc, status, created_at) VALUES (?,?,?,X'','claiming',?)",
    )
    .bind(&localpart)
    .bind(invitation_id)
    .bind(crypto::seal(&st.cfg.encryption_key, &password)?)
    .bind(now())
    .execute(&st.pool)
    .await
    .map_err(anyhow::Error::from)?;

    // ---- 2. THE IRREVERSIBLE ACT. ------------------------------------------
    // Under the name the database already knows. Whatever happens from here —
    // including an `Err` on an account that was in fact created — the row
    // exists.
    let acct = st
        .mx
        .register_dormant(&localpart, &password)
        .await
        .map_err(|_| AppError::HomeserverUnavailable)?;

    // ---- 3. COMPLETION. ----------------------------------------------------
    sqlx::query(
        "UPDATE reserved_accounts SET user_id = ?, access_token_enc = ?, status='reserved' \
         WHERE user_id = ? AND status = 'claiming'",
    )
    .bind(&acct.user_id)
    .bind(crypto::seal(&st.cfg.encryption_key, &acct.access_token)?)
    .bind(&localpart)
    .execute(&st.pool)
    .await
    .map_err(anyhow::Error::from)?;
    Ok(ClaimAccount {
        user_id: acct.user_id,
        localpart,
        password,
        access_token: acct.access_token,
        candidate_enc: None,
    })
}

pub async fn claim(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
    Body(req): Body<ClaimRequest>,
) -> Result<Json<ClaimResponse>, AppError> {
    let hash = crypto::token_hash(&req.token);
    let inv = sqlx::query(
        "SELECT id, inviter_user_id, status, expires_at, used_count, max_uses \
         FROM invitations WHERE token_sha256 = ?",
    )
    .bind(&hash)
    .fetch_optional(&st.pool)
    .await
    .map_err(anyhow::Error::from)?
    .ok_or(AppError::InvitationInvalid)?;

    let inv_id: String = inv.get("id");
    let inviter: String = inv.get("inviter_user_id");
    invitation_usable(
        inv.get::<String, _>("status").as_str(),
        inv.get("expires_at"),
        inv.get::<i64, _>("used_count") as u32,
        inv.get::<i64, _>("max_uses") as u32,
        now(),
    )?;

    // NO pre-reserved lot exists anymore (lot 0, task 0.2): the account is
    // adopted from an interrupted claim's leftover, or created now — see
    // `account_for_claim` for why a retried claim can never create a second
    // account.
    let account = account_for_claim(&st, &inv_id).await?;
    let user_id = account.user_id;
    let localpart = account.localpart;
    let old_password = account.password;
    let token = account.access_token;
    let candidate_enc = account.candidate_enc;

    // Dispatch: a failure here, on the Matrix side as on the database side,
    // must consume no use. Existing user -> the reserved account cedes the
    // place (join/invite/leave/deactivate) and returns no secret, the caller
    // already having its own session. Newcomer -> password rotation, since it
    // is the account itself that is handed out.
    // What the hand-over left behind it — `None` for a newcomer, who performs
    // none. Decides further below whether the secrets can be erased.
    let mut hand_over: Option<HandOver> = None;
    let (access_token, password, device_id) = match &req.existing_user_id {
        Some(target) => {
            // The format first: nothing network, nothing irreversible.
            validate_target(target)?;

            // `POST /invitations/claim` is not authenticated — that is the
            // very principle of welcoming a newcomer. But on THIS path the
            // caller designates a third party: without proof that they are
            // indeed that person, anyone could have an arbitrary Matrix
            // identifier invited into a real room (irreversible) and have a
            // lying edge recorded in their name. Format validation says
            // nothing about IDENTITY. It is therefore required here, and only
            // here.
            let caller = auth::authenticate(&st.mx, &headers).await?;
            if caller != *target {
                return Err(AppError::Unauthenticated);
            }

            // Room discovery precedes the edge: it touches nothing
            // irreversible, and its failure may remove the account from the
            // pool — no point having recorded an edge for an exchange that did
            // not take place. It also precedes the take of the row: the
            // `NeverInvited` case must leave the row `reserved`, and the
            // `Left` case has its own take, in `remove_from_pool`.
            let room = pending_room(&st, &user_id, &token, &inv_id).await?;

            // §7, NORMATIVE ORDER: "record the edge → then hand out […]
            // otherwise an account exists without traceability". On this
            // path, the hand-out is the Matrix invite of a human being into a
            // room — irreversible, and it happens in `hand_over_place`. The
            // edge must therefore precede it, and outside the transaction
            // below, whose rollback would erase it precisely in the case at
            // hand.
            //
            // The accepted price: an exchange that fails AFTER this point
            // leaves an edge with no use consumed, and a retry will write a
            // second one. That is the error on the right side — traceability
            // may over-record, never under-record. The counters, for their
            // part, stay exact: `claimed_count` is only incremented inside the
            // transaction.
            let edge = record_edge(
                &st.pool,
                &inviter,
                target,
                &inv_id,
                st.cfg.edge_retention_days,
            )
            .await?;

            // ATOMIC TAKE OF THE ROW, BEFORE THE MATRIX CALL CHAIN — the
            // pattern of `handlers::revoke`, applied to the last irreversible
            // site still acting on a snapshot.
            //
            // Without it, the following interleaving destroys a real user's
            // account, and without the slightest crash: a "newcomer" claim N
            // persists its candidate C, sets C on the homeserver then commits
            // its transaction; its bearer henceforth holds the account, with C
            // and a still-valid access token (`set_password` sends
            // `logout_devices: false`). An "existing user" claim E whose
            // snapshot dates from between the persistence and the commit
            // carries `candidate = Some(C)`: `deactivate_with_either` tries C
            // FIRST and SUCCEEDS. The pool not being ordered
            // (`... AND status='reserved' LIMIT 1`), both indeed draw the same
            // row, and the printed QR of §5.5, up to 10 uses, makes
            // simultaneous scans expected.
            //
            // The take closes that on both sides, because it is the SAME row
            // as the one N's transaction must win: if N has committed, the
            // take returns nothing and E stops here without touching anything
            // on the homeserver; if the take wins, N's guard fails, N hands no
            // secret to anyone, and the account E destroys belongs to nobody.
            //
            // It goes DIRECTLY to the terminal state: this path always ends
            // with the deactivation of the reserved account, the row has no
            // intermediate state to know about.
            //
            // And the `RETURNING` is what makes it complete: the secrets must
            // be read back HERE. A candidate written between the snapshot and
            // this instant would be ignored, and one would fail to deactivate
            // an account that is nevertheless alive, whose password no one
            // would know any more.
            let taken = sqlx::query(
                "UPDATE reserved_accounts SET status='deactivated' \
                 WHERE user_id = ? AND status = 'reserved' \
                 RETURNING password_enc, password_next_enc, access_token_enc",
            )
            .bind(&user_id)
            .fetch_optional(&st.pool)
            .await
            .map_err(anyhow::Error::from)?;
            // A concurrent claim has won the row: same outcome as the other
            // lost races of this handler.
            // EVERY exit after the edge must remove it, not only the invite
            // rejection one. This one — the row won by a concurrent claim — is
            // announced as EXPECTED by the code itself, and yet left behind it
            // an edge facing an unchanged `used_count`.
            let Some(fresh) = taken else {
                remove_edge(&st, edge).await;
                return Err(AppError::UsesExhausted);
            };

            // From here on, the row is `deactivated` while still carrying its
            // secrets. If the rest fails, this is exactly the filter of
            // `repair_half_deactivated` (cleanup.rs): the intended repair
            // path, not a leak. Success, for its part, erases further below.
            //
            // Second path after the edge: a secret that has become
            // undecryptable between the snapshot and the take (key rotation).
            // Rare, but written here, so to be handled like the others.
            let (password, candidate, access_token) =
                match open_secrets(&st.cfg.encryption_key, &fresh) {
                    Ok(three) => three,
                    Err(e) => {
                        remove_edge(&st, edge).await;
                        return Err(e);
                    }
                };

            // The Matrix invite is irreversible and PRECEDES the guards of the
            // transaction below: N concurrent claims bearing the same token
            // would place N people in the room while `used_count` only
            // increases by one. The guards structurally cannot close that.
            // Accepted limit (product trade-off): it requires simultaneous
            // requests bearing the same token, the state stays coherent, and
            // an administrator can remove a surplus member.
            match hand_over_place(
                &st,
                &access_token,
                &localpart,
                &password,
                candidate,
                target,
                &room,
                &inv_id,
            )
            .await
            {
                Ok(c) => hand_over = Some(c),
                // No one was invited: the row was of no use. It goes back to
                // the pool — the retry this 503 calls for can then really
                // succeed — and the edge written just before leaves with it:
                // nothing happened that needs tracing.
                Err(e) => {
                    // `.await?` here would turn a database nuisance into a
                    // 500, i.e. into a GIVING-UP contract, whereas the caller
                    // must retry. The failure is logged, the contract kept.
                    if let Err(sql) = return_to_pool(&st, &user_id).await {
                        tracing::error!(
                            user_id = %user_id,
                            "return to the pool impossible, the reserved account is lost \
                             for this invitation: {sql:#}"
                        );
                    }
                    remove_edge(&st, edge).await;
                    return Err(e);
                }
            }
            // The caller already has its session: neither token, nor password,
            // nor device to return to it.
            (String::new(), String::new(), String::new())
        }
        None => {
            // ---- THE HAND-OUT INVARIANT ------------------------------------
            //
            // A CLAIM THAT SUCCEEDS NEVER HANDS OUT AN ACCOUNT THAT IS IN NO
            // CONVERSATION. Either it hands out an account that is in one, or
            // it fails SAYING SO.
            //
            // THIS IS WHERE THE FAILURE WAS SWALLOWED, and nowhere else: this
            // path never asked the homeserver anything about the room of the
            // account it hands out. The check existed — it still exists, ten
            // lines above — but it belongs to the PLACE HAND-OVER, where it
            // serves to find the room to join. The newcomer's path went past
            // it.
            //
            // Measured on 7 August 2026 across the federation
            // (`docs/e2e-federation.md`, §6): a peer server rejects the Matrix
            // invite towards an account of this service (400
            // `M_INVALID_PARAM`, a specification revision skew between
            // implementations). The rejection lands BETWEEN THE TWO
            // HOMESERVERS; ours knows nothing of it, and the service even
            // less. The claim therefore returned 200, with a perfectly usable
            // account — which belonged to no room. For the invitee it is the
            // worst of both worlds: account created, session open, no error
            // message, and an onboarding that leads nowhere.
            //
            // `MatrixInviteRefused` does NOT cover this path and has no
            // duty to: it describes a rejection that WE received, on an invite
            // that WE emitted, in the place hand-over. Here no one emitted
            // anything on our side. What we observe is exactly, and only,
            // "this account is in no room" — which `NoPendingRoom`
            // already says, as 409 `MESSAGR_NOT_YET_INVITED`.
            //
            // WHY HERE AND NOT AT CREATION. This is not a trade-off between
            // two possible places: at invitation creation there exists NO
            // account (lot 0, task 0.2), so literally nothing to check. The
            // account is created at claim time, a few lines above; the Matrix
            // invite, for its part, is emitted by the inviter's client with
            // its own rights (§7) — and may therefore still be missing at
            // this very instant. The claim is the first instant at which the
            // question has a meaning, and it is also the one at which the
            // promise is made.
            //
            // WHY BEFORE `whoami_device` AND BEFORE THE ROTATION. A rejection
            // must cost as little as possible: the account exists — it has
            // just been created, or adopted — but the row is still `reserved`
            // with its secrets, no candidate is persisted, no password is
            // rotated on the homeserver, `used_count` is intact. THE
            // INVITATION REMAINS INTEGRALLY REUSABLE, and the retry ADOPTS
            // this account instead of creating a second one: one does not
            // replace a silent dead end with a costly dead end.
            //
            // WHY NOT RE-EMIT THE INVITE BEFORE CONCLUDING. The idea is
            // good everywhere it is possible; it is not possible here, and it
            // is better to write it down than to let the next reader find it
            // again. Re-emitting would require knowing INTO WHICH ROOM — yet
            // `NeverInvited` means precisely that no room is known, and a
            // `room_id` must never be written to the database (global
            // constraint, see `matrix::pending_invite_room`) — and would
            // require a member of the room whose rights the service would
            // borrow, which it does not have: "the client emits with its own
            // rights, the homeserver applies the power levels" (§8.2). The
            // reserved account cannot invite itself into a room it is not in.
            // There is therefore nothing to retry, and the 409 already says
            // so: it carries a WAIT contract, not a giving-up one — an
            // invitee who rescans succeeds as soon as the invite arrives.
            //
            // THE PRICE: one more `/sync` round trip per invitee. That is
            // what a promise kept as close as possible to the place where it
            // is made costs.
            //
            // The room is not retained: only its EXISTENCE is required.
            pending_room(&st, &user_id, &token, &inv_id).await?;

            // The device of the dormant token, read back BEFORE any rotation:
            // at this instant nothing has moved yet, so a failure here costs
            // nothing and the caller retries on an intact state. Reading it
            // back AFTER would cost a rotation already set on the homeserver.
            let device = st
                .mx
                .whoami_device(&token)
                .await
                .map_err(|_| AppError::HomeserverUnavailable)?;

            // CRITICAL ORDER: the candidate is PERSISTED BEFORE being set on
            // the homeserver. In the reverse order, a failure between the two
            // leaves the database with the old secret and the server with the
            // new one: the account becomes definitively orphaned.
            //
            // AND THE WRITE IS NON-DESTRUCTIVE. When resuming an interrupted
            // claim, a candidate already set on the server but never confirmed
            // in the database must be REUSED, not overwritten. Overwriting it
            // would lose the only record of the live password and would
            // recreate exactly the orphan this field exists to prevent.
            let new_password = match candidate_enc {
                Some(ref b) if !b.is_empty() => crypto::open(&st.cfg.encryption_key, b)?,
                _ => {
                    let n = crypto::generate_password();
                    let r = sqlx::query(PERSIST_CANDIDATE)
                        .bind(crypto::seal(&st.cfg.encryption_key, &n)?)
                        .bind(&user_id)
                        .execute(&st.pool)
                        .await
                        .map_err(anyhow::Error::from)?;
                    if r.rows_affected() == 0 {
                        // Another caller has persisted a candidate in the
                        // meantime. Continuing with ours — not persisted —
                        // would leave the live password recorded nowhere if we
                        // were interrupted after setting it: that is the orphan
                        // this field exists to prevent, reached through
                        // concurrency. We adopt the candidate actually
                        // persisted.
                        //
                        // Since the guard requires `status='reserved'`, this
                        // zero has a SECOND cause: the row is no longer
                        // reserved at all, another caller having won it. The
                        // read-back is therefore guarded as well, and its
                        // absence is an exhausted use (410) — not an internal
                        // error.
                        let row = sqlx::query(
                            "SELECT password_next_enc FROM reserved_accounts \
                             WHERE user_id = ? AND status = 'reserved'",
                        )
                        .bind(&user_id)
                        .fetch_optional(&st.pool)
                        .await
                        .map_err(anyhow::Error::from)?;
                        let Some(row) = row else {
                            return Err(AppError::UsesExhausted);
                        };
                        let b: Option<Vec<u8>> = row.get("password_next_enc");
                        let b =
                            b.ok_or_else(|| anyhow::anyhow!("concurrent candidate not found"))?;
                        crypto::open(&st.cfg.encryption_key, &b)?
                    } else {
                        n
                    }
                }
            };

            // Two attempts, in this order: with the old password if the
            // rotation never succeeded, then with the candidate itself if it
            // had already succeeded without being confirmed. Both paths
            // converge towards a server that holds the candidate and a
            // database that knows it.
            if st
                .mx
                .set_password(&token, &localpart, &old_password, &new_password)
                .await
                .is_err()
                && st
                    .mx
                    .set_password(&token, &localpart, &new_password, &new_password)
                    .await
                    .is_err()
            {
                return Err(AppError::HomeserverUnavailable);
            }
            (token.clone(), new_password, device)
        }
    };

    // `invited` carries the identity credited in the traceability graph: the
    // real target if it already existed, otherwise the reserved account
    // itself.
    let invited = req
        .existing_user_id
        .clone()
        .unwrap_or_else(|| user_id.clone());
    let newcomer = req.existing_user_id.is_none();
    let mut tx = st.pool.begin().await.map_err(anyhow::Error::from)?;
    // Newcomer only: on this path the hand-out is the HTTP RESPONSE, which
    // follows the commit, so the edge indeed remains the last write before it
    // and the order of §7 is respected without leaving the transaction. On
    // the "existing user" path it has already been written above — writing it
    // again there would make it a systematic duplicate.
    if newcomer {
        record_edge(
            &mut *tx,
            &inviter,
            &invited,
            &inv_id,
            st.cfg.edge_retention_days,
        )
        .await?; // the identifier is only of use on the other path
    }

    // The consumption marks the account row in the same transaction.
    //
    // NEWCOMER — the update is self-guarded. Without the
    // `AND status='reserved'`, two concurrent claims resuming the same
    // interrupted invitation can BOTH succeed — one winning on the initial
    // attempt, the other on the (candidate, candidate) fallback above, since
    // the candidate really is live at that moment. Two callers would then
    // receive the same account, the same password and the same token.
    // `rows_affected() == 0` signals that another caller got there first; the
    // transaction not being committed on this path, the rollback leaves the
    // state intact and no use is consumed.
    //
    // THE CLAIMED ROW KEEPS ITS SECRETS — sealed, and that is the point of
    // lot 0, task 0.2. PRD §8.2 makes revocation DESTRUCTIVE for an
    // entered-but-unpromoted account (and promotion does not exist yet, so
    // every claimed account is unpromoted by construction). `revoke` can only
    // delete the account from the homeserver if the service still holds the
    // means: the ROTATED password — the live one since the rotation above —
    // re-sealed into `password_enc`, and the access token, left where
    // registration put it. Erasing them here, as the reservation model did,
    // would make destructive revocation impossible precisely on the accounts
    // it exists for. The storage surface does not change in kind: these same
    // secrets were already sealed in this row while it was `reserved`.
    //
    // FOR THE DURATION OF THE INVITATION ONLY. Since the product decision of
    // 9 August 2026, expiration is destructive for these secrets:
    // `cleanup::purge_claimed_secrets_of_expired` wipes them once the
    // invitation has expired, and revocation's power lapses with it.
    //
    // EXISTING USER — the row was taken above, BEFORE the Matrix call chain,
    // and taken directly to its terminal state `deactivated`. The same
    // predicate would find nothing there, and it has nothing left to guard:
    // the concurrency guard has already played, earlier and better, since it
    // also protects what is irreversible. All that remains is to erase the
    // secrets — unconditionally, as everywhere else after a neutralisation:
    // the row can no longer become `reserved` again, no one else holds it,
    // and it is this erasure that guarantees it retains nothing.
    if newcomer {
        let r = sqlx::query(
            "UPDATE reserved_accounts SET status='claimed', claimed_at=?, \
             password_enc=?, password_next_enc=NULL \
             WHERE user_id=? AND status='reserved'",
        )
        .bind(now())
        .bind(crypto::seal(&st.cfg.encryption_key, &password)?)
        .bind(&user_id)
        .execute(&mut *tx)
        .await
        .map_err(anyhow::Error::from)?;
        if r.rows_affected() == 0 {
            // Another caller has claimed this account in the meantime.
            return Err(AppError::UsesExhausted);
        }
    } else if hand_over == Some(HandOver::Completed) {
        sqlx::query(
            "UPDATE reserved_accounts SET password_enc=X'', \
             password_next_enc=NULL, access_token_enc=X'' WHERE user_id=?",
        )
        .bind(&user_id)
        .execute(&mut *tx)
        .await
        .map_err(anyhow::Error::from)?;
    }
    // `InterruptedAfterInvite`: erase NOTHING. The target has its place, so
    // the use is consumed below, but the reserved account is still alive on
    // the homeserver and its secrets are the only means to neutralise it.
    // Erasing them here — as the unconditional erasure used to do — would
    // make it immortal: the row would leave the filter of
    // `repair_half_deactivated`, which precisely requires secrets present.
    let r = sqlx::query(
        "UPDATE invitations SET used_count = used_count + 1 \
         WHERE id = ? AND status='pending' AND used_count < max_uses",
    )
    .bind(&inv_id)
    .execute(&mut *tx)
    .await
    .map_err(anyhow::Error::from)?;
    if r.rows_affected() == 0 {
        return Err(AppError::UsesExhausted);
    }
    sqlx::query(
        "UPDATE inviter_counters SET claimed_count = claimed_count + 1 WHERE inviter_user_id = ?",
    )
    .bind(&inviter)
    .execute(&mut *tx)
    .await
    .map_err(anyhow::Error::from)?;
    tx.commit().await.map_err(anyhow::Error::from)?;

    Ok(Json(ClaimResponse {
        user_id: invited,
        access_token,
        password,
        device_id,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_a_healthy_invitation() {
        assert!(invitation_usable("pending", 2000, 0, 1, 1000).is_ok());
    }

    /// The three terminal refusals, and each under ITS name.
    ///
    /// The first two assertions used to settle for `is_err()`: they passed
    /// identically before and after this fix, so they held nothing. They now
    /// require the exact variant — that is the only level at which this test
    /// says something.
    #[test]
    fn refuses_expired_revoked_or_exhausted() {
        assert!(matches!(
            invitation_usable("pending", 500, 0, 1, 1000),
            Err(AppError::InvitationExpired)
        ));
        assert!(matches!(
            invitation_usable("revoked", 2000, 0, 1, 1000),
            Err(AppError::InvitationRevoked)
        ));
        assert!(matches!(
            invitation_usable("pending", 2000, 1, 1, 1000),
            Err(AppError::UsesExhausted)
        ));
    }

    /// Expiry is reported the same way, whether the sweep has run or not.
    ///
    /// `cleanup::expire_invitations` stamps `status='expired'`, but it runs
    /// PERIODICALLY: between two runs, an invitation whose date has just
    /// fallen due is still `pending`. Handling only the first case would
    /// leave the second on the mute response — hence on the former defect —
    /// and precisely for the invitations that have just expired, i.e. by far
    /// the most frequent case in front of an invitee who was one minute late.
    #[test]
    fn expiry_is_reported_whether_the_sweep_ran_or_not() {
        assert!(
            matches!(
                invitation_usable("expired", 500, 0, 1, 1000),
                Err(AppError::InvitationExpired)
            ),
            "sweep done: status='expired'"
        );
        assert!(
            matches!(
                invitation_usable("pending", 999, 0, 1, 1000),
                Err(AppError::InvitationExpired)
            ),
            "sweep not done yet: still 'pending', date fallen due"
        );
        // The boundary: `expires_at <= now` refuses, one second later accepts.
        assert!(matches!(
            invitation_usable("pending", 1000, 0, 1, 1000),
            Err(AppError::InvitationExpired)
        ));
        assert!(invitation_usable("pending", 1001, 0, 1, 1000).is_ok());
    }

    /// Revocation wins over expiry, and over exhaustion.
    ///
    /// `revoke` sets `status='revoked'` without looking at the clock or the
    /// uses: an invitation can therefore be revoked AND due, or revoked AND
    /// exhausted. Answering "expired" to someone whose inviter has just
    /// revoked would send them back to ask a person who has just deliberately
    /// withdrawn their invitation — false with confidence, which is what this
    /// fix exists to avoid.
    #[test]
    fn revocation_wins_over_expiry_and_over_exhaustion() {
        assert!(
            matches!(
                invitation_usable("revoked", 500, 0, 1, 1000),
                Err(AppError::InvitationRevoked)
            ),
            "revoked AND due: it is the decision that counts"
        );
        assert!(
            matches!(
                invitation_usable("revoked", 2000, 1, 1, 1000),
                Err(AppError::InvitationRevoked)
            ),
            "revoked AND exhausted: the explanatory cause prevails over the mechanical one"
        );
    }

    /// A status this code does not know must not be guessed.
    ///
    /// A database written by a future version, manual intervention: the
    /// service falls back to the mute response — exactly what it did before
    /// this fix for any `status != "pending"` — and above all does not say
    /// one of the two new causes at random.
    #[test]
    fn an_unknown_status_falls_back_to_the_mute_response() {
        for unknown in ["", "suspended", "PENDING", "reserving", "archived"] {
            assert!(
                matches!(
                    invitation_usable(unknown, 2000, 0, 1, 1000),
                    Err(AppError::InvitationInvalid)
                ),
                "status \"{unknown}\": neither guessed, nor accepted"
            );
        }
    }

    #[test]
    fn accepts_one_remaining_use_of_several() {
        assert!(invitation_usable("pending", 2000, 3, 10, 1000).is_ok());
    }

    #[test]
    fn the_reserved_account_call_chain_is_ordered() {
        // Verified on the prototype on 5 August 2026: one cannot invite into
        // a room one is only invited to join. The join is mandatory.
        assert_eq!(
            existing_user_call_chain(),
            vec!["join", "invite", "leave", "deactivate"]
        );
    }

    #[test]
    fn validates_well_and_badly_formed_matrix_ids() {
        assert!(validate_target("@someone:elsewhere.example").is_ok());
        assert!(validate_target("@a:b").is_ok());
        assert!(validate_target("bogus").is_err(), "no leading '@'");
        assert!(validate_target("@nodomain").is_err(), "no ':'");
        assert!(validate_target("@:empty").is_err(), "empty localpart");
        assert!(validate_target("@empty:").is_err(), "empty domain");
        // Empty string: `starts_with('@')` must be evaluated FIRST in the
        // `&&` of `well_formed` to short-circuit before `target[1..]`,
        // otherwise the indexing panics on a string of length 0. The order of
        // the clauses is what makes this case safe, and until now no test
        // exercised it.
        assert!(
            validate_target("").is_err(),
            "empty string, without panicking"
        );
    }

    // -----------------------------------------------------------------------
    // Scaffolding: a real migrated SQLite database, and a fake homeserver in
    // process. The fake does NOT simulate Matrix — it returns the bare
    // minimum for the call chain to run to its end, and records what must be
    // proven.
    // -----------------------------------------------------------------------

    use axum::http::StatusCode;
    use serde_json::json;
    use sqlx::SqlitePool;
    use std::sync::Mutex;

    const KEY: [u8; 32] = [0u8; 32];
    const ROOM: &str = "!room:h";
    /// Device that the fake `whoami` attributes to every token.
    const DEVICE: &str = "DEVICE42";

    /// What the fake homeserver returns to `/sync` — the three cases the
    /// code must distinguish, and which a single `None` used to conflate.
    #[derive(Clone, Copy)]
    enum View {
        /// A pending invite on this room.
        Invite(&'static str),
        /// No pending or joined room, but a LEFT room: the signature of a
        /// call chain interrupted between `leave` and `deactivate`.
        Left,
        /// The three lists present and EMPTY, what a fresh account returns:
        /// the inviter's client has not yet emitted the Matrix invite (§7).
        NeverInvited,
    }

    #[derive(Default)]
    struct Journal {
        /// Passwords presented to `/account/deactivate`, in order.
        deactivate: Vec<String>,
        /// Number of edges in the database at the PRECISE instant of the
        /// Matrix invite.
        edges_at_invite: Option<i64>,
        /// `status` of the reserved row at the PRECISE instant the Matrix
        /// call chain begins — its very first call, the `join`.
        status_at_join: Option<String>,
        /// Number of invite attempts received.
        invites: u32,
        /// Number of password rotations requested
        /// (`POST /account/password`).
        ///
        /// This is the instrument that makes the PLACEMENT of the room check
        /// observable: the rotation is the first thing the hand-out sets on
        /// the homeserver. A check placed after it would leave this counter
        /// at 1 on a rejection, and the invitation would no longer be quite
        /// in the state where the rejection found it.
        rotations: u32,
        /// Number of calls to `/v3/register` — i.e. of Matrix accounts
        /// created.
        ///
        /// The central instrument of the "creation at claim time" model: a
        /// retried claim must NEVER make this counter go up a second time.
        registers: u32,
    }

    struct Fake {
        journal: Mutex<Journal>,
        pool: SqlitePool,
        /// Identity that `whoami` returns for any token.
        identity: String,
        /// What `sync` returns. Under a lock so that a test can flip it
        /// between two claims — the real journey sees the room state evolve
        /// while the invitee retries.
        view: Mutex<View>,
        /// The ONLY password that `/account/deactivate` accepts.
        live_password: String,
        /// A CONCURRENT claim simulated on this row, `(user_id, candidate)`.
        /// The fake persists the candidate there during the `sync` — i.e.
        /// AFTER the caller's snapshot and BEFORE its row take — and records
        /// the `status` of that same row at the first call of the Matrix call
        /// chain.
        concurrent: Option<(String, String)>,
        /// How the fake welcomes the invite.
        welcome: Welcome,
        /// The `leave` fails: the target is in the room, but the reserved
        /// account cannot withdraw from it.
        leave_fails: bool,
        /// SQL executed at the moment of the invite, to sabotage the database
        /// while the caller is in flight.
        sql_at_invite: Option<&'static str>,
        /// SQL executed at the moment of the `sync` — i.e. AFTER the caller's
        /// snapshot and BEFORE the edge write and the row take. This is the
        /// window where a concurrent claim wins the row.
        sql_at_sync: Option<&'static str>,
        /// The accounts created by `/v3/register`: `(username, password,
        /// access_token)`. Used by `login` (resuming a `claiming` trace), by
        /// `whoami`, and by `deactivate`, which accepts the password of a
        /// created account on the same footing as `live_password`.
        created_accounts: Mutex<Vec<(String, String, String)>>,
        /// When armed, `/v3/register` creates the account (it is counted and
        /// recorded here) but returns a 2xx response AMPUTATED of its
        /// `access_token` — the third path of the trace written in advance:
        /// a registration that returns an error although the account exists.
        register_amputated: std::sync::atomic::AtomicBool,
    }

    /// What the fake homeserver answers to `POST /rooms/…/invite`, and the
    /// membership it will then serve.
    ///
    /// Both rejections return the SAME status and the SAME body — that is the
    /// point. Measured on 6 August 2026 on the prototype: inviting someone
    /// already a member returns `403 M_FORBIDDEN {"error":"Event is not
    /// authorized."}`, strictly indistinguishable from a rights rejection.
    /// Only the membership separates them.
    #[derive(Clone, Copy, PartialEq, Eq)]
    enum Welcome {
        /// The invite goes through.
        Accepts,
        /// The homeserver answers this status, and then serves this
        /// membership — `None` for "no member event", i.e. a 404.
        ///
        /// The status matters as much as the membership: only a 403 is an
        /// interpretable RIGHTS rejection. A 429 or a 5xx says the homeserver
        /// is unwell, and nothing authorises deducing a power level problem
        /// from it.
        Refuses(u16, Option<&'static str>),
    }

    async fn dispatch(
        State(f): State<Arc<Fake>>,
        req: axum::extract::Request,
    ) -> axum::response::Response {
        use axum::response::IntoResponse;
        let path = req.uri().path().to_string();
        let bearer = req
            .headers()
            .get("authorization")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .unwrap_or_default()
            .to_string();
        let raw = axum::body::to_bytes(req.into_body(), 64 * 1024)
            .await
            .unwrap_or_default();
        let body: serde_json::Value = serde_json::from_slice(&raw).unwrap_or(json!({}));

        if path.ends_with("/account/whoami") {
            // A token issued by `/v3/register` or `/v3/login` returns the
            // account it holds — that is what lets the resume of a `claiming`
            // trace find the full `user_id` again.
            if let Some((u, _, _)) = f
                .created_accounts
                .lock()
                .unwrap()
                .iter()
                .find(|(_, _, t)| *t == bearer)
            {
                return Json(json!({"user_id": format!("@{u}:h"), "device_id": DEVICE}))
                    .into_response();
            }
            // `device_id`: the returned token is only restorable together
            // with the device it belongs to.
            return Json(json!({"user_id": f.identity, "device_id": DEVICE})).into_response();
        }
        if path.ends_with("/v3/register") {
            f.journal.lock().unwrap().registers += 1;
            let u = body["username"].as_str().unwrap_or("?").to_string();
            let password = body["password"].as_str().unwrap_or_default().to_string();
            let tk = format!("token-of-account-{u}");
            // The account is recorded IN ALL CASES, amputated included: it
            // then really does exist, and that is the whole premise of the
            // test of the trace written in advance.
            f.created_accounts
                .lock()
                .unwrap()
                .push((u.clone(), password, tk.clone()));
            if f.register_amputated
                .load(std::sync::atomic::Ordering::SeqCst)
            {
                // THE ACCOUNT EXISTS — and yet the caller is going to receive
                // an error (a 2xx body without `access_token`, which
                // `matrix.rs` knowingly refuses).
                return Json(json!({"user_id": format!("@{u}:h")})).into_response();
            }
            return Json(json!({"user_id": format!("@{u}:h"), "access_token": tk})).into_response();
        }
        if path.ends_with("/v3/login") {
            let u = body["identifier"]["user"]
                .as_str()
                .unwrap_or("?")
                .to_string();
            let known = f
                .created_accounts
                .lock()
                .unwrap()
                .iter()
                .find(|(x, _, _)| *x == u)
                .cloned();
            return match known {
                Some((_, _, tk)) => {
                    Json(json!({"user_id": format!("@{u}:h"), "access_token": tk})).into_response()
                }
                None => (
                    StatusCode::FORBIDDEN,
                    Json(json!({"errcode": "M_FORBIDDEN"})),
                )
                    .into_response(),
            };
        }
        if path.ends_with("/sync") {
            if let Some(sql) = f.sql_at_sync {
                sqlx::query(sql).execute(&f.pool).await.unwrap();
            }
            // The caller is blocked here: this is the exact window between
            // its snapshot and its row take. A concurrent claim deposits its
            // candidate there, with the production SQL itself.
            if let Some((who, what)) = &f.concurrent {
                sqlx::query(PERSIST_CANDIDATE)
                    .bind(crypto::seal(&KEY, what).unwrap())
                    .bind(who)
                    .execute(&f.pool)
                    .await
                    .unwrap();
            }
            return match *f.view.lock().unwrap() {
                View::Invite(s) => Json(json!({"rooms": {"invite": {s: {}}}})),
                View::Left => {
                    Json(json!({"rooms": {"invite": {}, "join": {}, "leave": {ROOM: {}}}}))
                }
                View::NeverInvited => {
                    Json(json!({"rooms": {"invite": {}, "join": {}, "leave": {}}}))
                }
            }
            .into_response();
        }
        if path.contains("/v3/join/") {
            // The first call of the irreversible chain. Read BEFORE
            // answering: the caller is still blocked here.
            if let Some((who, _)) = &f.concurrent {
                let status: String =
                    sqlx::query_scalar("SELECT status FROM reserved_accounts WHERE user_id = ?")
                        .bind(who)
                        .fetch_one(&f.pool)
                        .await
                        .unwrap();
                f.journal.lock().unwrap().status_at_join = Some(status);
            }
            return Json(json!({})).into_response();
        }
        if path.contains("/state/m.room.member/") {
            return match f.welcome {
                Welcome::Refuses(_, Some(m)) => Json(json!({"membership": m})).into_response(),
                // No member event: the legitimate absence.
                _ => (StatusCode::NOT_FOUND, Json(json!({}))).into_response(),
            };
        }
        if path.ends_with("/leave") && f.leave_fails {
            return (StatusCode::FORBIDDEN, Json(json!({}))).into_response();
        }
        if path.ends_with("/account/password") {
            f.journal.lock().unwrap().rotations += 1;
            return Json(json!({})).into_response();
        }
        if path.ends_with("/invite") {
            f.journal.lock().unwrap().invites += 1;
            if let Some(sql) = f.sql_at_invite {
                sqlx::query(sql).execute(&f.pool).await.unwrap();
            }
            if let Welcome::Refuses(status, _) = f.welcome {
                // IDENTICAL body whatever the status: that is what forces the
                // code to decide on the status and on the membership, never
                // on the text — which the prototype does not provide.
                return (
                    StatusCode::from_u16(status).unwrap(),
                    Json(json!({"errcode":"M_FORBIDDEN","error":"Event is not authorized."})),
                )
                    .into_response();
            }
            // The instant that matters for the normative order of §7: a human
            // being is placed in the room HERE.
            let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM invitation_edges")
                .fetch_one(&f.pool)
                .await
                .unwrap();
            f.journal.lock().unwrap().edges_at_invite = Some(n);
            return Json(json!({})).into_response();
        }
        if path.ends_with("/account/deactivate") {
            let presented = body["auth"]["password"]
                .as_str()
                .unwrap_or_default()
                .to_string();
            let who = body["auth"]["identifier"]["user"]
                .as_str()
                .unwrap_or_default()
                .to_string();
            // Accepted: the live password declared at setup, OR that of an
            // account created here by `/v3/register` — that is what lets a
            // hand-over carrying an account born at claim time run to its
            // term.
            let accepted = presented == f.live_password
                || f.created_accounts
                    .lock()
                    .unwrap()
                    .iter()
                    .any(|(u, pw, _)| *u == who && *pw == presented);
            f.journal.lock().unwrap().deactivate.push(presented);
            return if accepted {
                Json(json!({})).into_response()
            } else {
                (StatusCode::UNAUTHORIZED, Json(json!({}))).into_response()
            };
        }
        Json(json!({})).into_response() // leave and the rest: mute success
    }

    async fn launch(f: Arc<Fake>) -> String {
        let app = axum::Router::new().fallback(dispatch).with_state(f);
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        base
    }

    /// Sets up the database, the fake homeserver, and the application state.
    async fn setup(
        pool: SqlitePool,
        identity: &str,
        view: View,
        live: &str,
    ) -> (Arc<AppState>, Arc<Fake>) {
        setup_with(pool, identity, view, live, None).await
    }

    /// Same thing, choosing the welcome reserved for the invite.
    async fn setup_welcome(
        pool: SqlitePool,
        identity: &str,
        view: View,
        live: &str,
        welcome: Welcome,
    ) -> (Arc<AppState>, Arc<Fake>) {
        setup_full(pool, identity, view, live, None, welcome, false, None, None).await
    }

    /// The row is carried off — or corrupted — during the `sync`, i.e. after
    /// the caller's snapshot and before its take.
    async fn setup_theft_at_sync(pool: SqlitePool, sql: &'static str) -> Arc<AppState> {
        setup_full(
            pool,
            "@target:h",
            View::Invite(ROOM),
            "old",
            None,
            Welcome::Accepts,
            false,
            None,
            Some(sql),
        )
        .await
        .0
    }

    /// The invite is rejected, and the database becomes unusable at the same
    /// instant: enough to make the return to the pool fail.
    async fn setup_sabotaged_db(pool: SqlitePool, identity: &str) -> (Arc<AppState>, Arc<Fake>) {
        setup_full(
            pool,
            identity,
            View::Invite(ROOM),
            "old",
            None,
            Welcome::Refuses(403, None),
            false,
            Some("DROP TABLE reserved_accounts"),
            None,
        )
        .await
    }

    /// The invite goes through, but the reserved account cannot leave the
    /// room.
    async fn setup_broken_leave(
        pool: SqlitePool,
        identity: &str,
        live: &str,
    ) -> (Arc<AppState>, Arc<Fake>) {
        setup_full(
            pool,
            identity,
            View::Invite(ROOM),
            live,
            None,
            Welcome::Accepts,
            true,
            None,
            None,
        )
        .await
    }

    /// Same thing, additionally arming the simulated concurrent claim.
    async fn setup_with(
        pool: SqlitePool,
        identity: &str,
        view: View,
        live: &str,
        concurrent: Option<(&str, &str)>,
    ) -> (Arc<AppState>, Arc<Fake>) {
        setup_full(
            pool,
            identity,
            view,
            live,
            concurrent,
            Welcome::Accepts,
            false,
            None,
            None,
        )
        .await
    }

    #[allow(clippy::too_many_arguments)]
    async fn setup_full(
        pool: SqlitePool,
        identity: &str,
        view: View,
        live: &str,
        concurrent: Option<(&str, &str)>,
        welcome: Welcome,
        leave_fails: bool,
        sql_at_invite: Option<&'static str>,
        sql_at_sync: Option<&'static str>,
    ) -> (Arc<AppState>, Arc<Fake>) {
        let fake = Arc::new(Fake {
            journal: Mutex::new(Journal::default()),
            pool: pool.clone(),
            identity: identity.to_string(),
            view: Mutex::new(view),
            live_password: live.to_string(),
            concurrent: concurrent.map(|(a, b)| (a.to_string(), b.to_string())),
            welcome,
            leave_fails,
            sql_at_invite,
            sql_at_sync,
            created_accounts: Mutex::new(Vec::new()),
            register_amputated: std::sync::atomic::AtomicBool::new(false),
        });
        let base = launch(fake.clone()).await;
        let st = Arc::new(AppState {
            pool,
            mx: Arc::new(crate::matrix::MatrixClient::new(
                base.clone(),
                "token".into(),
            )),
            cfg: crate::config::Config {
                database_url: String::new(),
                homeserver_url: base,
                registration_token: "token".into(),
                encryption_key: KEY,
                edge_retention_days: 30,
                bind_addr: String::new(),
                max_reserved_accounts_per_inviter: crate::config::DEFAULT_RESERVED_ACCOUNTS_CEILING,
            },
        });
        (st, fake)
    }

    async fn seed_invitation(pool: &SqlitePool, max_uses: i64) {
        sqlx::query(
            "INSERT INTO invitations (id, inviter_user_id, token_sha256, created_at, \
             expires_at, max_uses, used_count, status) \
             VALUES ('inv1','@alice:h',?,0,4000000000,?,0,'pending')",
        )
        .bind(crypto::token_hash("TOKEN"))
        .bind(max_uses)
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO inviter_counters (inviter_user_id, issued_count) \
                     VALUES ('@alice:h',1)",
        )
        .execute(pool)
        .await
        .unwrap();
    }

    async fn seed_account(
        pool: &SqlitePool,
        user_id: &str,
        password: &str,
        candidate: Option<&str>,
    ) {
        sqlx::query(
            "INSERT INTO reserved_accounts (user_id, invitation_id, password_enc, \
             password_next_enc, access_token_enc, status, created_at) \
             VALUES (?,'inv1',?,?,?,'reserved',0)",
        )
        .bind(user_id)
        .bind(crypto::seal(&KEY, password).unwrap())
        .bind(candidate.map(|c| crypto::seal(&KEY, c).unwrap()))
        .bind(crypto::seal(&KEY, "test-access-token").unwrap())
        .execute(pool)
        .await
        .unwrap();
    }

    async fn perform_claim(
        st: &Arc<AppState>,
        target: Option<&str>,
        bearer: Option<&str>,
    ) -> Result<Json<ClaimResponse>, AppError> {
        let mut headers = HeaderMap::new();
        if let Some(t) = bearer {
            headers.insert("authorization", format!("Bearer {t}").parse().unwrap());
        }
        claim(
            State(st.clone()),
            headers,
            Body(ClaimRequest {
                token: "TOKEN".into(),
                existing_user_id: target.map(str::to_string),
            }),
        )
        .await
    }

    /// How many of the pool's accounts are still really usable: reserved AND
    /// carrying their secrets. It is this quantity, and not `status` alone,
    /// that a retry consumes when it should consume nothing.
    async fn usable_pool(pool: &SqlitePool) -> i64 {
        count(
            pool,
            "SELECT COUNT(*) FROM reserved_accounts WHERE status='reserved' \
             AND length(password_enc) > 0 AND length(access_token_enc) > 0",
        )
        .await
    }

    /// **D1** — an invite rejection must destroy no reserved account, and the
    /// retry its 503 calls for must be able to succeed.
    ///
    /// The defect, measured on the live service before the fix: the atomic
    /// take moves the row to `deactivated` BEFORE the Matrix call chain, and
    /// `hand_over_place` used to treat every homeserver rejection as
    /// `HomeserverUnavailable`. An invite rejection therefore left the row
    /// taken for nothing. Two attempts emptied a pool of two, the invitation
    /// stayed `pending` with `used_count` at zero, and the third returned a
    /// 410 "uses exhausted" although no use had been consumed.
    ///
    /// This is the THIRD occurrence of the same pattern in this file — see
    /// `a_never_invited_account_stays_in_the_pool`, which describes word for
    /// word the same gearwork: a retry contract laid on a path that consumes.
    /// The test therefore counts the pool at each turn, not only at the end.
    /// ⚠ THE TEST FOR THE MECHANISM THAT REPLACED A DEAD END.
    ///
    /// A room created by this product sets `m.room.power_levels`'s "invite"
    /// to 50 and admits members at 0, so the reserved account is refused 403
    /// in EVERY room and this path could never complete. The refusal is now
    /// the designed state: the target is named to the inviter's client, which
    /// created the room, holds 100, and already invites every newcomer this
    /// way.
    ///
    /// Without the row this test asserts, the wait contract would be a
    /// promise to nobody: the claim would retry forever against a client that
    /// was never told whom to invite.
    #[sqlx::test(migrations = "./migrations")]
    async fn a_refused_invite_names_the_target_to_the_inviters_client(pool: SqlitePool) {
        seed_invitation(&pool, 2).await;
        seed_account(&pool, "@reserved-a:h", "old-a", None).await;
        seed_account(&pool, "@reserved-b:h", "old-b", None).await;
        let (st, fake) = setup_welcome(
            pool.clone(),
            "@target:h",
            View::Invite(ROOM),
            "old-a",
            Welcome::Refuses(403, None),
        )
        .await;

        let Err(e) = perform_claim(&st, Some("@target:h"), Some("target-token")).await else {
            panic!("the invite is refused: the claim cannot complete yet")
        };
        assert!(matches!(e, AppError::NoPendingRoom));

        assert_eq!(
            count(
                &pool,
                "SELECT COUNT(*) FROM pending_existing_invites WHERE user_id='@target:h'"
            )
            .await,
            1,
            "the refusal must name the target, or the wait is a promise to nobody"
        );

        // A SECOND ATTEMPT MUST NOT QUEUE THE SAME PERSON TWICE. The client
        // retries on this contract, by design, so the row has to be idempotent
        // or a patient invitee would fill this table on their own.
        let _ = perform_claim(&st, Some("@target:h"), Some("target-token")).await;
        assert_eq!(
            count(&pool, "SELECT COUNT(*) FROM pending_existing_invites").await,
            1,
            "retrying must not queue the same target again"
        );
        assert_eq!(
            fake.journal.lock().unwrap().invites,
            2,
            "both attempts really tried the invite before naming the target"
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn an_invite_rejection_destroys_no_reserved_account(pool: SqlitePool) {
        seed_invitation(&pool, 2).await;
        seed_account(&pool, "@reserved-a:h", "old-a", None).await;
        seed_account(&pool, "@reserved-b:h", "old-b", None).await;
        let (st, fake) = setup_welcome(
            pool.clone(),
            "@target:h",
            View::Invite(ROOM),
            "old-a",
            Welcome::Refuses(403, None),
        )
        .await;

        for attempt in 1..=3 {
            // `let Err(...) else` and not `expect_err`: the latter would
            // require `Debug` on `ClaimResponse`, which carries an access
            // token and a password in clear. No secret gains by becoming
            // printable.
            let Err(e) = perform_claim(&st, Some("@target:h"), Some("target-token")).await else {
                panic!(
                    "attempt {attempt}: the invite is rejected, \
                     the claim cannot succeed"
                )
            };
            // The contract remains that of the retry, but under an errcode
            // that SAYS what to repair: the homeserver answers, it is not
            // missing.
            assert!(
                matches!(e, AppError::NoPendingRoom),
                "attempt {attempt}: the contract must remain that of the retry, \
                 not become an exhaustion, and must designate the rejection \
                 rather than an outage"
            );
            assert_eq!(
                usable_pool(&pool).await,
                2,
                "attempt {attempt}: BOTH accounts must remain usable; \
                 before the fix {} remained after this attempt",
                2 - attempt.min(2)
            );
        }

        assert_eq!(
            count(&pool, "SELECT used_count FROM invitations WHERE id='inv1'").await,
            0,
            "no use consumed: nothing took place"
        );
        // The edge precedes the hand-out (§7) and is removed with the row
        // when the hand-out did not take place. Without this removal, three
        // attempts left three edges — a traceability asserting three
        // exchanges, facing a usage counter at zero.
        assert_eq!(
            count(&pool, "SELECT COUNT(*) FROM invitation_edges").await,
            0,
            "no edge: traceability must assert nothing that did not take place"
        );
        assert_eq!(
            fake.journal.lock().unwrap().invites,
            3,
            "the three attempts must really have attempted to invite, \
             otherwise this test would prove nothing"
        );
        assert_eq!(
            count(
                &pool,
                "SELECT COUNT(*) FROM reserved_accounts WHERE status='deactivated'"
            )
            .await,
            0,
            "no account neutralised: no one was invited"
        );
    }

    /// **D1, second part** — "the target is already a member" is not a
    /// failure, it is the intended result reached in advance.
    ///
    /// The fake rejects the invite with EXACTLY the body the prototype
    /// returns in that case (`403 M_FORBIDDEN`, "Event is not authorized."),
    /// i.e. the same as a rights rejection: nothing in the response
    /// separates them, and it is the membership that decides. The chain must
    /// run to its term as if the invite had just been emitted.
    #[sqlx::test(migrations = "./migrations")]
    async fn an_already_member_target_is_not_a_failure(pool: SqlitePool) {
        seed_invitation(&pool, 1).await;
        seed_account(&pool, "@reserved:h", "old", None).await;
        let (st, fake) = setup_welcome(
            pool.clone(),
            "@target:h",
            View::Invite(ROOM),
            "old",
            Welcome::Refuses(403, Some("join")),
        )
        .await;

        let r = perform_claim(&st, Some("@target:h"), Some("target-token"))
            .await
            .expect("the target is already in the room: this is the sought result");
        assert_eq!(r.user_id, "@target:h");

        assert_eq!(
            count(&pool, "SELECT used_count FROM invitations WHERE id='inv1'").await,
            1,
            "the use is consumed: the target indeed has its place"
        );
        assert_eq!(
            fake.journal.lock().unwrap().deactivate,
            vec!["old".to_string()],
            "the chain runs to its end: the reserved account neutralises itself"
        );
        assert_eq!(
            count(
                &pool,
                "SELECT COUNT(*) FROM reserved_accounts WHERE status='deactivated' \
                 AND length(password_enc)=0 AND length(access_token_enc)=0"
            )
            .await,
            1,
            "the row ends without a secret"
        );
    }

    /// **R4** — BOTH guards of `return_to_pool`, exercised to the letter.
    ///
    /// The previous tests pinned the idea from one side only: removing them
    /// left the suite green. Yet each closes a distinct interleaving with the
    /// repair sweep, and their absence produces not an inconvenience but the
    /// most harmful state this database can carry — a `reserved` row WITHOUT
    /// SECRETS, invisible to every sweep, that `... AND status='reserved'
    /// LIMIT 1` draws FIRST on every call: decryption fails and the whole
    /// invitation returns 500 until its TTL expires, healthy accounts
    /// included.
    ///
    /// The passing case is there for the usual reason: without it, a
    /// `return_to_pool` that did nothing at all any more would pass this
    /// test.
    #[sqlx::test(migrations = "./migrations")]
    async fn return_to_pool_accepts_only_the_row_as_the_take_left_it(pool: SqlitePool) {
        seed_invitation(&pool, 3).await;
        let (st, _f) = setup(pool.clone(), "@x:h", View::NeverInvited, "old").await;

        // (initial state, must go back to the pool?, what the absence of the
        // guard would cost)
        let cases: [(&str, &str, bool, &str); 3] = [
            (
                "@intact:h",
                "UPDATE reserved_accounts SET status='deactivated' WHERE user_id='@intact:h'",
                true,
                "the row taken then unused: it MUST go back to the pool",
            ),
            (
                "@emptied:h",
                "UPDATE reserved_accounts SET status='deactivated', password_enc=X'', \
                 password_next_enc=NULL, access_token_enc=X'' WHERE user_id='@emptied:h'",
                false,
                "the sweep has already killed the account and erased the secrets: \
                 returning it to the pool would put back a row without secrets, \
                 which nothing can decrypt or gather any more",
            ),
            (
                "@inpurge:h",
                "UPDATE reserved_accounts SET status='purging' WHERE user_id='@inpurge:h'",
                false,
                "the sweep holds the row and is about to kill the account: taking \
                 it back from it would return a dead account to the pool",
            ),
        ];

        for (user_id, prepare, must_go_back, why) in cases {
            seed_account(&pool, user_id, "old", None).await;
            sqlx::query(prepare).execute(&pool).await.unwrap();

            return_to_pool(&st, user_id).await.unwrap();

            let status: String =
                sqlx::query_scalar("SELECT status FROM reserved_accounts WHERE user_id = ?")
                    .bind(user_id)
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(
                status == "reserved",
                must_go_back,
                "{user_id}: status \"{status}\" — {why}"
            );
        }
    }

    /// **R4** — the membership that authorises concluding "already there" is
    /// a CLOSED list.
    ///
    /// `join` and `invite` describe the sought result. `leave` and `ban` are
    /// the opposite: the target has no place, and widening the clause would
    /// make a claim that gave nothing to anyone return 200 — consuming the
    /// use and neutralising the reserved account. No membership at all (404)
    /// must remain a failure for the same reason.
    ///
    /// The fake returns the SAME rejection in the four cases: only the
    /// membership changes, so it is indeed it, and nothing else, that this
    /// test exercises.
    #[sqlx::test(migrations = "./migrations")]
    async fn only_join_and_invite_count_as_a_place_already_given(pool: SqlitePool) {
        seed_invitation(&pool, 4).await;
        seed_account(&pool, "@reserved:h", "old", None).await;

        for membership in [Some("leave"), Some("ban"), Some("knock"), None] {
            let (st, _f) = setup_welcome(
                pool.clone(),
                "@target:h",
                View::Invite(ROOM),
                "old",
                Welcome::Refuses(403, membership),
            )
            .await;
            let Err(e) = perform_claim(&st, Some("@target:h"), Some("target-token")).await else {
                panic!(
                    "membership {membership:?}: the target has NO place, \
                     the claim must not succeed"
                )
            };
            assert!(
                matches!(e, AppError::NoPendingRoom),
                "membership {membership:?}: retry contract expected, and rejection \
                 designated as such"
            );
            assert_eq!(
                count(&pool, "SELECT used_count FROM invitations WHERE id='inv1'").await,
                0,
                "membership {membership:?}: no use must be consumed"
            );
            assert_eq!(
                usable_pool(&pool).await,
                1,
                "membership {membership:?}: the account must stay in the pool"
            );
        }
    }

    /// **R4 / D15** — after a SUCCESSFUL invite, the exchange has taken
    /// place: a failure of the tidying-up that follows does not cancel it.
    ///
    /// The boundary is the Matrix invite. Reclassifying `leave` or the
    /// deactivation on the right side of that boundary — i.e. treating them
    /// as a failure that returns the row to the pool — would produce two
    /// faults at once: the target would have its place without any use being
    /// consumed, and the retry would spend a SECOND reserved account for a
    /// result already delivered.
    ///
    /// And the secrets must REMAIN: they are the only means to neutralise a
    /// reserved account still alive, and it is by them that
    /// `repair_half_deactivated` recognises a row to finish. Erasing them
    /// would make it immortal.
    #[sqlx::test(migrations = "./migrations")]
    async fn a_failure_after_the_invite_still_consumes_the_use(pool: SqlitePool) {
        seed_invitation(&pool, 2).await;
        seed_account(&pool, "@reserved:h", "old", None).await;
        let (st, fake) = setup_broken_leave(pool.clone(), "@target:h", "old").await;

        let r = perform_claim(&st, Some("@target:h"), Some("target-token"))
            .await
            .expect("the target is in the room: the exchange has taken place");
        assert_eq!(r.user_id, "@target:h");
        assert_eq!(
            fake.journal.lock().unwrap().invites,
            1,
            "the invite must have been emitted, otherwise this test proves nothing"
        );
        assert_eq!(
            count(&pool, "SELECT used_count FROM invitations WHERE id='inv1'").await,
            1,
            "the use is consumed: a place was given"
        );
        assert_eq!(
            count(&pool, "SELECT COUNT(*) FROM invitation_edges").await,
            1,
            "one edge, and only one: the exchange took place and is not to be removed"
        );
        assert_eq!(
            usable_pool(&pool).await,
            0,
            "the row does NOT go back to the pool: it served"
        );
        assert_eq!(
            count(
                &pool,
                "SELECT COUNT(*) FROM reserved_accounts WHERE user_id='@reserved:h' \
                 AND status='deactivated' AND length(password_enc) > 0"
            )
            .await,
            1,
            "the secrets remain: without them the account still alive would become \
             impossible to neutralise, and the row would leave the repair filter"
        );
    }

    /// A homeserver that is NOT well must not pass for a rights problem.
    ///
    /// `Refused` used to be returned for any non-2xx whose membership was
    /// neither `join` nor `invite` — 429 and 5xx included. A rate limit, a
    /// routine thing on this route when a ten-use QR is scanned in a burst
    /// (§5.5), therefore sent the operator off fixing power levels that are
    /// not at issue, under a message asserting that "the homeserver answers
    /// normally". That is the very mistake `MESSAGR_INVITE_REFUSED` exists to
    /// eliminate, with the polarity inverted.
    ///
    /// The 403 at the end of the table is the control: without it, code that
    /// would return `HomeserverUnavailable` for EVERYTHING would pass this
    /// test.
    #[sqlx::test(migrations = "./migrations")]
    async fn only_a_403_is_a_rights_rejection(pool: SqlitePool) {
        seed_invitation(&pool, 6).await;
        seed_account(&pool, "@reserved:h", "old", None).await;

        for (status, is_rights_rejection) in [
            (429u16, false), // rate limit
            (502, false),    // gateway in difficulty
            (504, false),    // upstream deadline exceeded
            (401, false),    // reserved account's token rejected
            (500, false),
            (403, true), // the only true authorization rejection
        ] {
            let (st, _f) = setup_welcome(
                pool.clone(),
                "@target:h",
                View::Invite(ROOM),
                "old",
                Welcome::Refuses(status, None),
            )
            .await;
            let Err(e) = perform_claim(&st, Some("@target:h"), Some("target-token")).await else {
                panic!("status {status}: the claim cannot succeed")
            };
            assert_eq!(
                matches!(e, AppError::NoPendingRoom),
                is_rights_rejection,
                "status {status}: only a 403 authorises speaking of rights; \
                 everything else says the homeserver is unwell"
            );
            // In both cases the row goes back to the pool: that is the
            // property of D1, and it does not depend on the status.
            assert_eq!(usable_pool(&pool).await, 1, "status {status}");
        }
    }

    /// **R5, second part** — EVERY exit after the edge removes it.
    ///
    /// The removal used to happen only on the invite-rejection branch. Two
    /// other exits are written AFTER the edge: the lost race on the take —
    /// which the code itself announces as expected — and a secret that has
    /// become undecryptable between the snapshot and the take. Both left an
    /// edge facing an unchanged `used_count`, i.e. a traceability asserting
    /// an exchange that did not take place.
    ///
    /// The fake executes the SQL during the `sync`, the only window that is
    /// both after the caller's snapshot and before the edge write.
    #[sqlx::test(migrations = "./migrations")]
    async fn no_edge_survives_an_exit_that_exchanged_nothing(pool: SqlitePool) {
        for (name, sabotage) in [
            (
                "the row is won by a concurrent claim",
                "UPDATE reserved_accounts SET status='claimed' WHERE user_id='@reserved:h'",
            ),
            (
                "a secret becomes undecryptable between the snapshot and the take",
                "UPDATE reserved_accounts SET password_enc=X'DEADBEEF' WHERE user_id='@reserved:h'",
            ),
        ] {
            sqlx::query("DELETE FROM invitation_edges")
                .execute(&pool)
                .await
                .unwrap();
            sqlx::query("DELETE FROM reserved_accounts")
                .execute(&pool)
                .await
                .unwrap();
            sqlx::query("DELETE FROM invitations")
                .execute(&pool)
                .await
                .unwrap();
            sqlx::query("DELETE FROM inviter_counters")
                .execute(&pool)
                .await
                .unwrap();
            seed_invitation(&pool, 1).await;
            seed_account(&pool, "@reserved:h", "old", None).await;
            let st = setup_theft_at_sync(pool.clone(), sabotage).await;

            let Err(_) = perform_claim(&st, Some("@target:h"), Some("target-token")).await else {
                panic!("{name}: the claim cannot succeed")
            };
            assert_eq!(
                count(&pool, "SELECT used_count FROM invitations WHERE id='inv1'").await,
                0,
                "{name}: no use consumed"
            );
            assert_eq!(
                count(&pool, "SELECT COUNT(*) FROM invitation_edges").await,
                0,
                "{name}: the edge must leave with the exchange that did not take place"
            );
        }
    }

    /// **R4** — the boundary has TWO legs, and the second was not pinched.
    ///
    /// The twin of `a_failure_after_the_invite_still_consumes_the_use`, for
    /// the other step after the invite: here the `leave` succeeds and it is
    /// the NEUTRALISATION that fails — the fake only accepts a password the
    /// row does not carry. The same properties must hold, failing which half
    /// the boundary would be free to drift.
    #[sqlx::test(migrations = "./migrations")]
    async fn a_neutralisation_failure_also_consumes_the_use(pool: SqlitePool) {
        seed_invitation(&pool, 2).await;
        seed_account(&pool, "@reserved:h", "old", None).await;
        // The fake accepts ONLY "some-other-password": the deactivation will
        // fail, the `leave` will not.
        let (st, fake) = setup(
            pool.clone(),
            "@target:h",
            View::Invite(ROOM),
            "some-other-password",
        )
        .await;

        let r = perform_claim(&st, Some("@target:h"), Some("target-token"))
            .await
            .expect("the target is in the room: the exchange has taken place");
        assert_eq!(r.user_id, "@target:h");
        assert_eq!(
            fake.journal.lock().unwrap().deactivate,
            vec!["old".to_string()],
            "the neutralisation must have been ATTEMPTED and rejected, \
             otherwise this test proves nothing"
        );
        assert_eq!(
            count(&pool, "SELECT used_count FROM invitations WHERE id='inv1'").await,
            1,
            "the use is consumed: a place was given"
        );
        assert_eq!(
            count(
                &pool,
                "SELECT COUNT(*) FROM reserved_accounts WHERE user_id='@reserved:h' \
                 AND status='deactivated' AND length(password_enc) > 0"
            )
            .await,
            1,
            "the secrets remain: the account is still alive on the homeserver, \
             and they are the only means to neutralise it"
        );
    }

    /// **R3** — a database nuisance must not turn the contract around.
    ///
    /// `return_to_pool(...).await?` used to propagate the SQL error as-is:
    /// `AppError::Internal`, hence 500. Yet 500 is the GIVING-UP contract, and
    /// this path is precisely the one where the caller must RETRY — the
    /// homeserver rejected, nothing took place, a new attempt can succeed.
    /// The return to the pool is a cleanliness effort; its failure is logged,
    /// it does not change what is answered to the caller.
    ///
    /// The database disappears while the caller is in flight, at the exact
    /// moment of the invite.
    #[sqlx::test(migrations = "./migrations")]
    async fn a_return_to_pool_failure_does_not_change_the_contract(pool: SqlitePool) {
        seed_invitation(&pool, 1).await;
        seed_account(&pool, "@reserved:h", "old", None).await;
        let (st, _f) = setup_sabotaged_db(pool.clone(), "@target:h").await;

        let Err(e) = perform_claim(&st, Some("@target:h"), Some("target-token")).await else {
            panic!("the invite is rejected: the claim cannot succeed")
        };
        assert!(
            matches!(e, AppError::NoPendingRoom),
            "the contract must remain \"retry\" (now the 409 wait contract, no longer a 503), never become \"give up\" (500)"
        );
    }

    /// **D4** — the hand-out must return the device identifier of the token.
    ///
    /// An access token alone does not restore a Matrix session: the SDK
    /// requires the triple (`user_id`, `device_id`, `access_token`). Without
    /// this field, the client being handed the account must log back in by
    /// password — hence create a SECOND device — and the returned token is
    /// useless. Verified by mutation: returning `String::new()` here makes
    /// the last assertion fail.
    ///
    /// The setup used to be `View::NeverInvited`, and it passed: that is the
    /// trace of the federation defect fixed in this very place. A hand-out
    /// over an account that NO ONE had invited succeeded, and returned an
    /// account outside any conversation. The setup is now that of the real
    /// journey — the Matrix invite precedes the scan (§7) — and the absence
    /// of a room has its own test, just below.
    #[sqlx::test(migrations = "./migrations")]
    async fn the_handout_returns_the_tokens_device(pool: SqlitePool) {
        seed_invitation(&pool, 1).await;
        seed_account(&pool, "@reserved:h", "old", None).await;
        let (st, _f) = setup(pool.clone(), "@whoever:h", View::Invite(ROOM), "old").await;

        let r = perform_claim(&st, None, None)
            .await
            .expect("a newcomer claims without a header");
        assert_eq!(r.user_id, "@reserved:h");
        // Controls: without them, the following assertion would also pass on
        // a hand-out that returns nothing at all.
        assert!(!r.access_token.is_empty(), "the token must be returned");
        assert!(!r.password.is_empty(), "the password must be returned");
        assert_eq!(
            r.device_id, DEVICE,
            "without the device, the returned token opens no restorable session"
        );
    }

    /// **THE HAND-OUT INVARIANT** — a claim that succeeds never returns an
    /// account that is in no conversation. Either it returns an account that
    /// is in one, or it fails SAYING SO.
    ///
    /// The defect, measured on 7 August 2026 across the federation
    /// (`docs/e2e-federation.md`, §6): a peer server rejects the Matrix
    /// invite towards an account of this service — 400 `M_INVALID_PARAM`, a
    /// specification revision skew between implementations. The rejection
    /// lands BETWEEN THE TWO HOMESERVERS; neither our homeserver nor the
    /// service sees it. The claim returned 200 with `user_id`,
    /// `access_token`, `password` and `device_id` — a perfectly usable
    /// account, **which belonged to no room**. Account created, session
    /// open, no error message, and an onboarding that leads nowhere.
    ///
    /// The setup is what the homeserver returns in that case, and there is
    /// nothing particular about it: the three `sync` lists present and
    /// EMPTY, i.e. exactly what an account no one has invited returns. That
    /// is indeed the point — on our side, an invite dead in federation and
    /// an invite never emitted are the SAME state, and the service has no
    /// business pretending to distinguish them.
    ///
    /// **The four assertions do not say the same thing**, and none is
    /// decorative:
    ///
    /// 1. the rejection happens, and under a code that SAYS what is missing;
    /// 2. it costs zero rotation — so it is placed BEFORE the first act set
    ///    on the homeserver, and not after;
    /// 3. the row is intact, secrets and candidate included — the reserved
    ///    account is irreversible, a rejection must not burn one;
    /// 4. `used_count` is unchanged — **the invitation remains integrally
    ///    reusable**. Without this one, one would have replaced a silent
    ///    dead end with a costly dead end.
    ///
    /// **The control is inseparable from the rest**: without it, a service
    /// that would reject EVERY hand-out would pass the four assertions
    /// above.
    #[sqlx::test(migrations = "./migrations")]
    async fn a_handout_never_returns_an_account_outside_any_conversation(pool: SqlitePool) {
        seed_invitation(&pool, 2).await;
        seed_account(&pool, "@reserved:h", "old", None).await;
        let (st, fake) = setup(pool.clone(), "@whoever:h", View::NeverInvited, "old").await;

        // `let Err(...) else` and not `expect_err`: `ClaimResponse` carries
        // an access token and a password in clear, no secret gains by
        // becoming printable.
        let Err(e) = perform_claim(&st, None, None).await else {
            panic!(
                "no Matrix invite awaits this account: the hand-out cannot \
                 succeed, otherwise it would return an account outside any \
                 conversation"
            )
        };
        assert!(
            matches!(e, AppError::NoPendingRoom),
            "the rejection must SAY what is missing, and under a wait contract \
             (409): the service's invitation is valid, only the Matrix room is \
             still missing"
        );
        assert_eq!(
            fake.journal.lock().unwrap().rotations,
            0,
            "the check must precede the rotation: after it, the rejection would \
             leave the homeserver with a fresh password and a candidate persisted \
             in the database, for a hand-out that did not take place"
        );
        assert_eq!(
            count(
                &pool,
                "SELECT COUNT(*) FROM reserved_accounts WHERE user_id='@reserved:h' \
                 AND status='reserved' AND length(password_enc)>0 \
                 AND length(access_token_enc)>0 AND password_next_enc IS NULL"
            )
            .await,
            1,
            "the row must remain EXACTLY in the state where the rejection found \
             it: a reserved account is not un-created"
        );
        assert_eq!(
            count(&pool, "SELECT used_count FROM invitations WHERE id='inv1'").await,
            0,
            "the invitation must remain integrally reusable — burning the use \
             would replace a silent dead end with a costly dead end"
        );
        assert_eq!(
            count(&pool, "SELECT COUNT(*) FROM invitation_edges").await,
            0,
            "no edge: traceability must assert nothing that did not take place"
        );

        // THE CONTROL. The same call, on the only state that changes — a
        // pending Matrix invite, i.e. the order of the real journey (§7) —
        // must succeed and return the whole restorable triple.
        let (st, fake) = setup(pool.clone(), "@whoever:h", View::Invite(ROOM), "old").await;
        let r = perform_claim(&st, None, None)
            .await
            .expect("a Matrix invite awaits this account: the hand-out must succeed");
        assert_eq!(r.user_id, "@reserved:h");
        assert!(!r.access_token.is_empty(), "the token must be returned");
        assert!(!r.password.is_empty(), "the password must be returned");
        assert_eq!(r.device_id, DEVICE, "the device must be returned");
        assert_eq!(
            fake.journal.lock().unwrap().rotations,
            1,
            "the hand-out must indeed have rotated the password, otherwise the \
             zero above would prove nothing"
        );
        assert_eq!(
            count(&pool, "SELECT used_count FROM invitations WHERE id='inv1'").await,
            1,
            "and the use is consumed when the hand-out really takes place"
        );
    }

    /// The second face of "in no conversation", on the same path: a row left
    /// HALFWAY THROUGH THE CALL CHAIN is handed to no one.
    ///
    /// A non-empty `rooms.leave` is the signature of a reserved account that
    /// has already ceded its place and has not finished erasing itself.
    /// Handing it to an invitee would be worse than handing nothing: they
    /// would receive an account outside any conversation AND promised to
    /// neutralisation by `repair_half_deactivated`.
    ///
    /// The decision is not that of the previous case, and that is deliberate:
    /// this row is condemned, hence REMOVED FROM THE POOL — otherwise the
    /// draw (`... AND status='reserved' LIMIT 1`) would serve it again on
    /// every call and a single failed exchange would condemn all the
    /// remaining uses. The caller receives the retry contract, and the next
    /// draw picks a healthy account.
    ///
    /// What does NOT change from one case to the other: no use is consumed.
    #[sqlx::test(migrations = "./migrations")]
    async fn a_row_left_mid_chain_is_handed_to_no_one(pool: SqlitePool) {
        seed_invitation(&pool, 2).await;
        seed_account(&pool, "@left:h", "old", None).await;
        let (st, fake) = setup(pool.clone(), "@whoever:h", View::Left, "old").await;

        let Err(e) = perform_claim(&st, None, None).await else {
            panic!("this account has already ceded its place: it can be handed to no one")
        };
        assert!(
            matches!(e, AppError::ReservedAccountUnusable),
            "retry contract expected: ANOTHER account of the pool will fix the problem"
        );
        assert_eq!(
            fake.journal.lock().unwrap().rotations,
            0,
            "no rotation on an account one is about to neutralise"
        );
        assert_eq!(
            count(&pool, "SELECT used_count FROM invitations WHERE id='inv1'").await,
            0,
            "a failure consumes no use"
        );
        assert_eq!(
            usable_pool(&pool).await,
            0,
            "the condemned row leaves the pool, instead of blocking it at every draw"
        );
        assert_eq!(
            count(
                &pool,
                "SELECT COUNT(*) FROM reserved_accounts WHERE user_id='@left:h' \
                 AND status='deactivated' AND length(password_enc)=0 \
                 AND password_next_enc IS NULL AND length(access_token_enc)=0"
            )
            .await,
            1,
            "and it ends neutralised, no longer carrying any secret"
        );
    }

    async fn count(pool: &SqlitePool, sql: &str) -> i64 {
        sqlx::query_scalar(sql).fetch_one(pool).await.unwrap()
    }

    // -----------------------------------------------------------------------

    /// Two defects in a single path, because they live in the same call
    /// chain.
    ///
    /// **The candidate must be tried at neutralisation.** The account is
    /// seeded in the exact state an interrupted claim produces after a
    /// successful rotation: the row has come back to `reserved` (rollback),
    /// but the account's LIVE password is the candidate, persisted outside
    /// the transaction. The fake homeserver accepts ONLY that candidate. The
    /// code before the fix presented only `password_enc`: the deactivation
    /// failed, and precisely on the most fragile accounts.
    ///
    /// **The edge precedes the hand-out (§7).** The Matrix invite places a
    /// human being in a real room — irreversible. The fake counts the edges
    /// at that precise instant: before the fix it observed zero, the edge
    /// being written only afterwards, in a transaction that could fail.
    #[sqlx::test(migrations = "./migrations")]
    async fn the_candidate_neutralises_and_the_edge_precedes_the_invite(pool: SqlitePool) {
        seed_invitation(&pool, 1).await;
        seed_account(&pool, "@reserved:h", "old", Some("candidate")).await;
        let (st, fake) = setup(pool.clone(), "@target:h", View::Invite(ROOM), "candidate").await;

        let r = perform_claim(&st, Some("@target:h"), Some("target-token"))
            .await
            .expect("the claim must succeed");
        assert_eq!(r.user_id, "@target:h");
        assert!(r.password.is_empty(), "no secret returned on this path");

        let (tries, edges_at_invite) = {
            let j = fake.journal.lock().unwrap();
            (j.deactivate.clone(), j.edges_at_invite)
        };
        assert_eq!(
            tries,
            vec!["candidate".to_string()],
            "the neutralisation must try the candidate, the only live password"
        );
        assert_eq!(
            edges_at_invite,
            Some(1),
            "the edge must be recorded BEFORE anyone is invited (§7)"
        );

        assert_eq!(
            count(&pool, "SELECT COUNT(*) FROM invitation_edges").await,
            1,
            "a single edge: the one before the chain, not a duplicate"
        );
        assert_eq!(
            count(
                &pool,
                "SELECT COUNT(*) FROM invitation_edges WHERE invited_user_id='@target:h'"
            )
            .await,
            1
        );
        assert_eq!(
            count(&pool, "SELECT used_count FROM invitations WHERE id='inv1'").await,
            1
        );
        // `deactivated` and not `claimed`: on this path the row is taken to
        // its TERMINAL state before the Matrix call chain, because this path
        // always ends with the deactivation of the reserved account — it is
        // handed to no one. That is what the atomic take records, and the
        // erasure of the secrets stays, for its part, in the consumption
        // transaction.
        assert_eq!(
            count(
                &pool,
                "SELECT COUNT(*) FROM reserved_accounts WHERE status='deactivated' \
             AND length(password_enc)=0 AND password_next_enc IS NULL \
             AND length(access_token_enc)=0"
            )
            .await,
            1,
            "the row is at its terminal state and no longer carries any secret"
        );
    }

    /// The caller who designates a third party must prove they ARE that
    /// third party.
    ///
    /// Without a header, the former code went straight towards the Matrix
    /// call chain: the fake homeserver below would run it to its term, an
    /// arbitrary identifier would be invited into a real room, and a lying
    /// edge written. This test therefore does not settle for the error code:
    /// it verifies that NOTHING moved.
    #[sqlx::test(migrations = "./migrations")]
    async fn a_third_party_cannot_be_designated_without_proof_of_identity(pool: SqlitePool) {
        seed_invitation(&pool, 1).await;
        seed_account(&pool, "@reserved:h", "old", None).await;
        // The fake would accept everything: whoami returns "@other:h", the
        // chain would succeed, `old` would neutralise the account.
        let (st, fake) = setup(pool.clone(), "@other:h", View::Invite(ROOM), "old").await;

        let no_header = perform_claim(&st, Some("@target:h"), None).await;
        assert!(
            matches!(no_header, Err(AppError::Unauthenticated)),
            "without an Authorization header, the \"existing user\" path is refused"
        );

        let impersonated = perform_claim(&st, Some("@target:h"), Some("someone-elses-token")).await;
        assert!(
            matches!(impersonated, Err(AppError::Unauthenticated)),
            "a token that is not the target's is refused"
        );

        assert!(
            fake.journal.lock().unwrap().edges_at_invite.is_none(),
            "no one must have been invited into the room"
        );
        assert_eq!(
            count(&pool, "SELECT COUNT(*) FROM invitation_edges").await,
            0
        );
        assert_eq!(
            count(&pool, "SELECT used_count FROM invitations WHERE id='inv1'").await,
            0
        );
        assert_eq!(
            count(
                &pool,
                "SELECT COUNT(*) FROM reserved_accounts WHERE status='reserved'"
            )
            .await,
            1,
            "the reserved account must remain intact"
        );
    }

    /// A truly poisoned account leaves the pool instead of condemning it —
    /// and under the claim-time model, the NEXT claim simply creates a fresh
    /// one.
    ///
    /// `sync` returns no pending room, but a LEFT room: the call chain was
    /// interrupted between `leave` and `deactivate` during an earlier claim.
    /// The two seeded accounts are removed one after the other — proof that
    /// the draw advances.
    ///
    /// New-model ending: there is no "empty pool" anymore. The third claim
    /// finds no row and CREATES an account — exactly once (`registers` moves
    /// from 0 to 1) — and the hand-over goes to its term with it. The view is
    /// flipped to `Invite` for that third claim: the fake's `Left` was the
    /// state of the SEEDED accounts, and a freshly created account has of
    /// course never left any room.
    ///
    /// The non-empty `rooms.leave` is not decorative: it is THE
    /// discriminant. This destruction is legitimate ONLY in that case — the
    /// twin test below exercises the other absence, the one that must
    /// destroy nothing.
    #[sqlx::test(migrations = "./migrations")]
    async fn a_poisoned_account_leaves_the_lot_and_the_next_claim_creates_a_fresh_one(
        pool: SqlitePool,
    ) {
        seed_invitation(&pool, 3).await;
        seed_account(&pool, "@one:h", "old-one", None).await;
        seed_account(&pool, "@two:h", "old-two", None).await;
        let (st, fake) = setup(pool.clone(), "@target:h", View::Left, "old-one").await;

        for attempt in 1..=2 {
            let r = perform_claim(&st, Some("@target:h"), Some("target-token")).await;
            assert!(
                matches!(r, Err(AppError::ReservedAccountUnusable)),
                "attempt {attempt}: the caller must be invited to retry"
            );
        }
        assert_eq!(
            count(
                &pool,
                "SELECT COUNT(*) FROM reserved_accounts WHERE status='deactivated' \
                 AND length(password_enc)=0 AND password_next_enc IS NULL \
                 AND length(access_token_enc)=0"
            )
            .await,
            2,
            "the two poisoned accounts are neutralised, without a secret"
        );
        assert_eq!(
            fake.journal.lock().unwrap().registers,
            0,
            "nothing was created to remove accounts"
        );

        // The pool is empty, but the invitation still has uses: the next
        // claim CREATES the account. The room flips to `Invite` — a fresh
        // account has never left any room.
        *fake.view.lock().unwrap() = View::Invite(ROOM);
        let r = perform_claim(&st, Some("@target:h"), Some("target-token"))
            .await
            .expect("the empty pool is no longer an end: the account is created at claim time");
        assert_eq!(r.user_id, "@target:h");
        assert_eq!(
            fake.journal.lock().unwrap().registers,
            1,
            "a single account created, exactly"
        );
        assert_eq!(
            count(&pool, "SELECT used_count FROM invitations WHERE id='inv1'").await,
            1,
            "and this time a place was given: the use is consumed"
        );
    }

    /// **The account is created at claim time, exactly once — a retried claim
    /// creates NO second account.**
    ///
    /// First attempt: no account exists anywhere, the claim creates one
    /// (`registers` 0 → 1) — and the rejection that follows (no Matrix invite
    /// awaits it yet, 409 wait) leaves the account `reserved`, intact. The
    /// retry ADOPTS that leftover: `registers` stays at 1, the claim
    /// succeeds, and the account handed out is the very one the first attempt
    /// created. This is the claim-time counterpart of the idempotency
    /// invariant in `create.rs`.
    #[sqlx::test(migrations = "./migrations")]
    async fn claim_creates_the_account_once_and_a_retry_reuses_it(pool: SqlitePool) {
        seed_invitation(&pool, 2).await;
        let (st, fake) = setup(pool.clone(), "@whoever:h", View::NeverInvited, "none").await;

        let Err(e) = perform_claim(&st, None, None).await else {
            panic!("no Matrix invite awaits the account yet: wait (409)")
        };
        assert!(matches!(e, AppError::NoPendingRoom));
        assert_eq!(
            fake.journal.lock().unwrap().registers,
            1,
            "the account was created at claim time, once"
        );
        let created = fake.created_accounts.lock().unwrap()[0].0.clone();

        // The Matrix invite arrives in the meantime (the inviter's client
        // emits, §7): the wait ends.
        *fake.view.lock().unwrap() = View::Invite(ROOM);
        let r = perform_claim(&st, None, None)
            .await
            .expect("the hand-out must succeed on the retry");
        assert_eq!(
            fake.journal.lock().unwrap().registers,
            1,
            "A RETRY DOES NOT CREATE a second account: the account left by the \
             interrupted attempt is adopted"
        );
        assert_eq!(
            r.user_id,
            format!("@{created}:h"),
            "it is the SAME account that is handed out, not a new one"
        );
        assert!(!r.access_token.is_empty(), "the token must be returned");
        assert!(!r.password.is_empty(), "the password must be returned");
        assert_eq!(r.device_id, DEVICE, "the device must be returned");
        assert_eq!(
            count(&pool, "SELECT used_count FROM invitations WHERE id='inv1'").await,
            1,
            "the use is consumed when the hand-out really takes place"
        );
    }

    /// **An exhausted invitation creates nothing.**
    ///
    /// `invitation_usable` rejects before any account is adopted or
    /// created, so the rejection costs zero registration — the counter must
    /// not move.
    #[sqlx::test(migrations = "./migrations")]
    async fn an_exhausted_invitation_creates_nothing(pool: SqlitePool) {
        seed_invitation(&pool, 1).await;
        let (st, fake) = setup(pool.clone(), "@whoever:h", View::Invite(ROOM), "none").await;

        let first = perform_claim(&st, None, None)
            .await
            .expect("the first hand-out succeeds");
        assert!(
            !first.user_id.is_empty(),
            "control: the hand-out took place"
        );
        assert_eq!(fake.journal.lock().unwrap().registers, 1);

        let Err(e) = perform_claim(&st, None, None).await else {
            panic!("the invitation is exhausted: the second hand-out cannot succeed")
        };
        assert!(matches!(e, AppError::UsesExhausted));
        assert_eq!(
            fake.journal.lock().unwrap().registers,
            1,
            "a rejection creates nothing"
        );
    }

    /// **THE TRACE SURVIVES THE REGISTRATION'S FAILURE — and its retry
    /// resumes it instead of creating a second account.**
    ///
    /// The fake creates the account (it counts it, and keeps it) but returns
    /// a body the caller can do nothing with. The account exists, a localpart
    /// is never freed by the homeserver, and the caller receives `Err`. What
    /// is tested is therefore not a response but a TRACE: a row exists, it
    /// names the account the homeserver really created, and it carries the
    /// password needed to honour it — exactly what the six `messagr-reserved`
    /// orphans of the prototype did not have.
    ///
    /// The retry then goes THROUGH the trace: `login` with the traced
    /// password completes the row, the hand-out proceeds, and `registers`
    /// stays at 1. Without this resume, every retried claim under a flapping
    /// homeserver would sow one more definitive localpart — the
    /// unbounded-creation defect, reopened at claim time.
    #[sqlx::test(migrations = "./migrations")]
    async fn an_interrupted_claim_leaves_a_trace_and_its_retry_creates_no_second_account(
        pool: SqlitePool,
    ) {
        seed_invitation(&pool, 2).await;
        let (st, fake) = setup(pool.clone(), "@whoever:h", View::Invite(ROOM), "none").await;
        fake.register_amputated
            .store(true, std::sync::atomic::Ordering::SeqCst);

        let r = perform_claim(&st, None, None).await;
        assert!(
            matches!(r, Err(AppError::HomeserverUnavailable)),
            "the caller must receive a frank failure"
        );
        assert_eq!(
            fake.journal.lock().unwrap().registers,
            1,
            "the account, for its part, WAS CREATED — that is the premise of the test"
        );

        // THE PROPERTY: a row exists, it names the account really created,
        // and it carries the password needed to honour it.
        let created = fake.created_accounts.lock().unwrap()[0].clone();
        let (user_id, status, pw, tk): (String, String, Vec<u8>, Vec<u8>) = sqlx::query_as(
            "SELECT user_id, status, password_enc, access_token_enc FROM reserved_accounts",
        )
        .fetch_one(&pool)
        .await
        .expect(
            "a row must survive: without it the account created above is \
             a definitive orphan, which no sweep will ever find again",
        );
        assert_eq!(
            user_id, created.0,
            "the trace must name the account REALLY requested from the \
             homeserver (bare localpart), otherwise it designates nothing"
        );
        assert_eq!(
            status, "claiming",
            "and be distinguishable from a handed-out account: the resume must \
             first establish that the account exists"
        );
        assert_eq!(
            crypto::open(&KEY, &pw).unwrap(),
            created.1,
            "the traced password IS that of the account: it is the only means \
             to honour this row"
        );
        assert!(tk.is_empty(), "no access token could be obtained");

        // The retry RESUMES the trace: login with the traced password,
        // completion, hand-out — and still ONE SINGLE account.
        fake.register_amputated
            .store(false, std::sync::atomic::Ordering::SeqCst);
        let r = perform_claim(&st, None, None)
            .await
            .expect("the resume of the trace must succeed");
        assert_eq!(
            fake.journal.lock().unwrap().registers,
            1,
            "the resume NEVER creates a second account"
        );
        assert_eq!(r.user_id, format!("@{}:h", created.0));
        assert_eq!(
            count(&pool, "SELECT COUNT(*) FROM reserved_accounts").await,
            1,
            "one row, never two"
        );
        assert_eq!(
            count(&pool, "SELECT used_count FROM invitations WHERE id='inv1'").await,
            1
        );
    }

    /// The twin of the previous one, and the defect it fixes: an account
    /// that NO ONE has invited yet must remain intact.
    ///
    /// The account is created at claim time (lot 0, task 0.2); it is the
    /// inviter's client that emits the Matrix invite, with its own rights
    /// (§7). As long as it has not been emitted — or if it fails — the
    /// account appears in none of the three `sync` lists, exactly like an
    /// account left halfway through the call chain. Task 8 conflated them
    /// and DESTROYED this one; worse, its 503 `MESSAGR_RETRY` made the
    /// caller retry, destroying one more on each attempt. Two attempts were
    /// enough to burn two seeded accounts and to make the invitation
    /// exhausted with `used_count` at zero.
    ///
    /// The sync here returns `"leave": {}` — present but EMPTY, what a fresh
    /// account returns: that is the nuance that separates the two cases.
    #[sqlx::test(migrations = "./migrations")]
    async fn a_never_invited_account_stays_in_the_pool(pool: SqlitePool) {
        seed_invitation(&pool, 2).await;
        seed_account(&pool, "@one:h", "old-one", None).await;
        seed_account(&pool, "@two:h", "old-two", None).await;
        // No password is live: any attempted deactivation would be rejected,
        // and would remain recorded in the journal — impossible to miss.
        let (st, fake) = setup(pool.clone(), "@target:h", View::NeverInvited, "none").await;

        for attempt in 1..=2 {
            let r = perform_claim(&st, Some("@target:h"), Some("target-token")).await;
            assert!(
                matches!(r, Err(AppError::NoPendingRoom)),
                "attempt {attempt}: nothing to join for now, but nothing to destroy \
                 either — it is a wait (409), not the giving-up of InvitationInvalid (404)"
            );
        }

        assert!(
            fake.journal.lock().unwrap().deactivate.is_empty(),
            "no deactivation must be attempted on a never-invited account"
        );
        assert_eq!(
            count(
                &pool,
                "SELECT COUNT(*) FROM reserved_accounts WHERE status='reserved' \
             AND length(password_enc)>0 AND length(access_token_enc)>0"
            )
            .await,
            2,
            "both accounts stay reserved, secrets intact, usable as soon as the \
             inviter has emitted their Matrix invite"
        );
        assert_eq!(
            count(&pool, "SELECT COUNT(*) FROM invitation_edges").await,
            0,
            "no edge for an exchange that did not take place"
        );
        assert_eq!(
            count(&pool, "SELECT used_count FROM invitations WHERE id='inv1'").await,
            0,
            "a failure consumes no use"
        );
    }

    /// The fixed defect: `hand_over_place` was the last irreversible site
    /// acting on its caller's snapshot, without ever taking the row.
    ///
    /// The harmful chain of events required no crash. A "newcomer" claim
    /// persists its candidate, sets it on the homeserver and commits: its
    /// bearer henceforth holds the account, with that candidate as password
    /// and a still-valid access token. An "existing user" claim whose
    /// snapshot dated from before that commit carried the same candidate,
    /// and `deactivate_with_either` tried it FIRST: it DESTROYED an account
    /// just handed out to a real user. Both indeed draw the same row — the
    /// pool is not ordered (`... AND status='reserved' LIMIT 1`).
    ///
    /// The race itself cannot be forced here. This test therefore exercises
    /// the property that closes it, as `cleanup.rs` does for its twin:
    ///
    /// 1. **The row is already taken when the Matrix call chain begins.**
    ///    The fake records its `status` at the `join`, the first call of the
    ///    chain. Taken, the row can no longer be won by a competitor's
    ///    transaction, which requires `status='reserved'` — so no competitor
    ///    could have handed this account to anyone. Before the fix one reads
    ///    `reserved` there.
    ///
    /// 2. **The secrets are those of the `RETURNING`, not those of the
    ///    snapshot.** The fake plays a concurrent claim DURING the `sync`:
    ///    it deposits a candidate the caller's snapshot never saw, with the
    ///    production SQL. That candidate is the only live password. Reading
    ///    it from the snapshot means presenting a stale password and leaving
    ///    behind a LIVING account that no one knows how to switch off any
    ///    more — the exact orphan `password_next_enc` exists to prevent.
    ///    Before the fix, the claim fails here.
    #[sqlx::test(migrations = "./migrations")]
    async fn the_row_is_taken_and_secrets_reread_before_the_matrix_call_chain(pool: SqlitePool) {
        seed_invitation(&pool, 1).await;
        seed_account(&pool, "@reserved:h", "old", None).await;
        let (st, fake) = setup_with(
            pool.clone(),
            "@target:h",
            View::Invite(ROOM),
            "concurrent-candidate",
            Some(("@reserved:h", "concurrent-candidate")),
        )
        .await;

        let r = perform_claim(&st, Some("@target:h"), Some("target-token"))
            .await
            .expect("the claim must succeed");
        assert_eq!(r.user_id, "@target:h");

        let (status_at_join, tries) = {
            let j = fake.journal.lock().unwrap();
            (j.status_at_join.clone(), j.deactivate.clone())
        };
        assert_eq!(
            status_at_join.as_deref(),
            Some("deactivated"),
            "the row must be taken BEFORE the first call of the Matrix call chain"
        );
        assert_eq!(
            tries,
            vec!["concurrent-candidate".to_string()],
            "the neutralisation must present the candidate read back by the RETURNING"
        );

        // The counters stay exact, and the row ends without a secret.
        assert_eq!(
            count(&pool, "SELECT used_count FROM invitations WHERE id='inv1'").await,
            1
        );
        assert_eq!(
            count(
                &pool,
                "SELECT claimed_count FROM inviter_counters WHERE inviter_user_id='@alice:h'"
            )
            .await,
            1
        );
        assert_eq!(
            count(&pool, "SELECT COUNT(*) FROM invitation_edges").await,
            1
        );
        assert_eq!(
            count(
                &pool,
                "SELECT COUNT(*) FROM reserved_accounts WHERE status='deactivated' \
             AND length(password_enc)=0 AND password_next_enc IS NULL \
             AND length(access_token_enc)=0"
            )
            .await,
            1,
            "the erasure must still happen on the nominal path"
        );
    }

    /// The candidate's write guard, exercised on the production SQL itself
    /// (`PERSIST_CANDIDATE`) and not on a copy.
    ///
    /// A `claimed` row has `password_next_enc = NULL`: without
    /// `AND status='reserved'`, a concurrent caller's write lands on it and
    /// deposits a sealed secret there that no sweep picks up —
    /// `repair_half_deactivated` only looks at `deactivated` rows.
    #[sqlx::test(migrations = "./migrations")]
    async fn the_candidate_cannot_land_on_an_already_claimed_row(pool: SqlitePool) {
        seed_invitation(&pool, 2).await;
        seed_account(&pool, "@reserved:h", "old", None).await;
        seed_account(&pool, "@claimed:h", "old", None).await;
        sqlx::query(
            "UPDATE reserved_accounts SET status='claimed', claimed_at=1, \
                     password_enc=X'', password_next_enc=NULL, access_token_enc=X'' \
                     WHERE user_id='@claimed:h'",
        )
        .execute(&pool)
        .await
        .unwrap();

        let sealed = crypto::seal(&KEY, "candidate").unwrap();
        let on_claimed = sqlx::query(PERSIST_CANDIDATE)
            .bind(&sealed)
            .bind("@claimed:h")
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(
            on_claimed.rows_affected(),
            0,
            "no candidate must be deposited on an already claimed row"
        );

        // Control: the guard must not block everything either.
        let on_reserved = sqlx::query(PERSIST_CANDIDATE)
            .bind(&sealed)
            .bind("@reserved:h")
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(
            on_reserved.rows_affected(),
            1,
            "a still-reserved row must accept its candidate"
        );

        assert_eq!(
            count(
                &pool,
                "SELECT COUNT(*) FROM reserved_accounts \
             WHERE status='claimed' AND password_next_enc IS NOT NULL"
            )
            .await,
            0,
            "no secret must survive on a row that no sweep covers"
        );
    }

    // -----------------------------------------------------------------------
    // Expired / revoked / unknown — the three terminal rejections, exercised
    // on the real handler and on the real conversion into an HTTP response.
    //
    // The state set up here is INERT: homeserver on a closed port. These
    // three rejections land BEFORE any network call and before any reserved
    // account selection, and nothing in these tests must be able to depend
    // on them — a fix that would move the check after the Matrix call chain
    // would surface `HomeserverUnavailable` and these tests would fall,
    // which is exactly the intended behaviour.
    // -----------------------------------------------------------------------

    fn inert_state(pool: SqlitePool) -> Arc<AppState> {
        // Port 1: nothing listens, and a test must never depend on the
        // network.
        let dead = "http://127.0.0.1:1".to_string();
        Arc::new(AppState {
            pool,
            mx: Arc::new(crate::matrix::MatrixClient::new(
                dead.clone(),
                "token".into(),
            )),
            cfg: crate::config::Config {
                database_url: String::new(),
                homeserver_url: dead,
                registration_token: "token".into(),
                encryption_key: KEY,
                edge_retention_days: 30,
                bind_addr: String::new(),
                max_reserved_accounts_per_inviter: crate::config::DEFAULT_RESERVED_ACCOUNTS_CEILING,
            },
        })
    }

    async fn seed_dated_invitation(
        pool: &SqlitePool,
        id: &str,
        token: &str,
        status: &str,
        expires_at: i64,
    ) {
        sqlx::query(
            "INSERT INTO invitations (id, inviter_user_id, token_sha256, created_at, \
             expires_at, max_uses, used_count, status) VALUES (?,'@alice:h',?,0,?,1,0,?)",
        )
        .bind(id)
        .bind(crypto::token_hash(token))
        .bind(expires_at)
        .bind(status)
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO reserved_accounts (user_id, invitation_id, password_enc, \
             access_token_enc, status, created_at) VALUES (?,?,?,?,'reserved',0)",
        )
        .bind(format!("@account-{id}:h"))
        .bind(id)
        .bind(crypto::seal(&KEY, "pw").unwrap())
        .bind(crypto::seal(&KEY, "test-access-token").unwrap())
        .execute(pool)
        .await
        .unwrap();
    }

    /// Claims any token and returns the HTTP response AS THE INVITEE receives
    /// it — status and `{errcode, error}` body included. Going through
    /// `IntoResponse` is indispensable: that is where the choice of status
    /// and `errcode` is made, and a test that would stop at the `AppError`
    /// variant would never see two variants rendered under the same code.
    async fn response_for(st: &Arc<AppState>, token: &str) -> (StatusCode, serde_json::Value) {
        use axum::response::IntoResponse;
        let outcome = claim(
            State(st.clone()),
            HeaderMap::new(),
            Body(ClaimRequest {
                token: token.into(),
                existing_user_id: None,
            }),
        )
        .await;
        let Err(e) = outcome else {
            panic!("\"{token}\" must never lead to a hand-out")
        };
        let r = e.into_response();
        let status = r.status();
        let raw = axum::body::to_bytes(r.into_body(), usize::MAX)
            .await
            .unwrap();
        (status, serde_json::from_slice(&raw).unwrap())
    }

    /// **THE SECURITY INVARIANT: the unknown token is NOT distinguished.**
    ///
    /// This is the counterpart of the fix, and the only thing that keeps it
    /// from turning the service into an oracle. Expired and revoked are now
    /// reported because they can only be reached by presenting a token THAT
    /// EXISTS (160 bits drawn at random, see `crypto::generate_token`):
    /// reading them presupposes one already holds the token. The unknown
    /// token, for its part, is what anyone can present — distinguishing it
    /// would teach any prober whether a value ever existed.
    ///
    /// The test pins it in the way hardest to circumvent: the response to an
    /// unknown token must be IDENTICAL, status and body included, to that of
    /// a very real invitation whose status is not interpretable. As long as
    /// these two coincide, `M_NOT_FOUND` remains a BUCKET and not an
    /// assertion; the day someone gives the unknown token its own code or
    /// its own message, they stop coinciding and this test falls.
    ///
    /// Verified by mutation: returning a distinct `AppError` on the
    /// `.ok_or(...)` of `claim`, or tightening the message of
    /// `InvitationInvalid`, makes this test fall.
    #[sqlx::test(migrations = "./migrations")]
    async fn an_unknown_token_stays_indistinguishable_from_an_unknown_status(pool: SqlitePool) {
        // A database that already contains the two cases now distinguished:
        // if the service started talking too much, this is where it would
        // have the means to.
        seed_dated_invitation(&pool, "inv-exp", "TOKEN-EXPIRED", "expired", 1).await;
        seed_dated_invitation(&pool, "inv-rev", "TOKEN-REVOKED", "revoked", 4_000_000_000).await;
        // And a very real invitation, with a status the service cannot
        // interpret: it EXISTS, and yet it must reveal nothing.
        seed_dated_invitation(
            &pool,
            "inv-ukn",
            "TOKEN-UNKNOWN-STATUS",
            "suspended",
            4_000_000_000,
        )
        .await;
        let st = inert_state(pool.clone());

        let unknown = response_for(&st, "THIS-TOKEN-NEVER-EXISTED").await;
        let unknown_status = response_for(&st, "TOKEN-UNKNOWN-STATUS").await;

        // 1. The response to the unknown token is exactly the one from
        //    before.
        assert_eq!(unknown.0, StatusCode::NOT_FOUND);
        assert_eq!(unknown.1["errcode"], "M_NOT_FOUND");
        // Message text owned by error.rs (`InvitationInvalid`): asserted in
        // full because the client has nothing else.
        assert_eq!(
            unknown.1["error"],
            "invitation not found, expired or revoked"
        );

        // 2. It differs in NOTHING from that of an invitation that exists.
        assert_eq!(
            unknown, unknown_status,
            "a token that never existed and a very real invitation must \
             receive the SAME response, otherwise the service becomes an \
             existence oracle"
        );

        // 3. Neither of the two new codes must ever leave towards a prober.
        for (name, (status, body)) in [("unknown", &unknown), ("unknown status", &unknown_status)] {
            for banned in ["MESSAGR_INVITATION_EXPIRED", "MESSAGR_INVITATION_REVOKED"] {
                assert_ne!(body["errcode"], banned, "{name}");
            }
            assert_ne!(*status, StatusCode::GONE, "{name}");
            assert_ne!(*status, StatusCode::FORBIDDEN, "{name}");
        }

        // 4. Control: without it, a service that would return 404 TO
        //    EVERYTHING would pass the three previous assertions. The tokens
        //    that exist, for their part, do get their own response.
        assert_eq!(response_for(&st, "TOKEN-EXPIRED").await.0, StatusCode::GONE);
        assert_eq!(
            response_for(&st, "TOKEN-REVOKED").await.0,
            StatusCode::FORBIDDEN
        );
    }

    /// **Expired and revoked each answer for themselves, and without
    /// consuming anything.**
    ///
    /// The fixed defect, exercised end to end: both went through the same
    /// branch and returned 404 `M_NOT_FOUND`. The test reads the whole
    /// response — status, `errcode`, message — because that is all the
    /// client has.
    ///
    /// It also verifies what was already acquired and must not be lost: a
    /// terminal rejection is PRIOR to any reservation. No account of the
    /// pool changes state, no use is consumed, and the replay returns the
    /// same thing — an invitee who rescans their expired QR must not see
    /// the response change under them.
    #[sqlx::test(migrations = "./migrations")]
    async fn an_expired_and_a_revoked_invitation_each_answer_for_themselves(pool: SqlitePool) {
        seed_dated_invitation(&pool, "inv-exp", "TOKEN-EXPIRED", "expired", 1).await;
        seed_dated_invitation(&pool, "inv-rev", "TOKEN-REVOKED", "revoked", 4_000_000_000).await;
        // The case only the full handler exercises: the date has fallen due
        // but the sweep has not run, the row is still 'pending'. It is the
        // most frequent one in front of an invitee who was late.
        seed_dated_invitation(&pool, "inv-due", "TOKEN-DUE", "pending", 1).await;
        let st = inert_state(pool.clone());

        let (status, body) = response_for(&st, "TOKEN-EXPIRED").await;
        assert_eq!(status, StatusCode::GONE);
        assert_eq!(body["errcode"], "MESSAGR_INVITATION_EXPIRED");

        let (status_due, body_due) = response_for(&st, "TOKEN-DUE").await;
        assert_eq!(
            (status_due, &body_due),
            (status, &body),
            "a due invitation the sweep has not stamped yet must answer like \
             an expired invitation, otherwise the most frequent case remains \
             on the mute response"
        );

        let (status_rev, body_rev) = response_for(&st, "TOKEN-REVOKED").await;
        assert_eq!(status_rev, StatusCode::FORBIDDEN);
        assert_eq!(body_rev["errcode"], "MESSAGR_INVITATION_REVOKED");

        // The fixed defect, said in one assertion: nothing conflates them
        // any more.
        assert_ne!(status, status_rev);
        assert_ne!(body["errcode"], body_rev["errcode"]);
        assert_ne!(body["error"], body_rev["error"]);

        // What was already acquired and must not be lost: the rejection
        // precedes ANY reservation. The three pools are intact.
        assert_eq!(
            count(
                &pool,
                "SELECT COUNT(*) FROM reserved_accounts WHERE status='reserved' \
                 AND length(password_enc) > 0 AND length(access_token_enc) > 0"
            )
            .await,
            3,
            "a terminal rejection must touch no reserved account"
        );
        assert_eq!(
            count(&pool, "SELECT COALESCE(SUM(used_count),0) FROM invitations").await,
            0,
            "a terminal rejection consumes no use"
        );

        // And the replay returns the same thing: rescanning an expired QR
        // must not change the response under the invitee's eyes.
        assert_eq!(response_for(&st, "TOKEN-EXPIRED").await, (status, body));
        assert_eq!(
            response_for(&st, "TOKEN-REVOKED").await,
            (status_rev, body_rev)
        );
    }
}
