use std::sync::Arc;

use axum::{extract::State, http::HeaderMap, Json};
use serde::{Deserialize, Serialize};
use sqlx::Row;

use crate::{auth, crypto, error::AppError, extract::Body, matrix, util::now, AppState};

pub const MAX_USES: u32 = 10;

/// Upper bound of the TTL, aligned with edge retention (§6, 30 days).
///
/// Without a bound, `now() + ttl_seconds` overflows: panic in debug, an
/// absurd `expires_at` in release. And an effectively infinite TTL permanently
/// removes the reserved accounts from cleanup — they are only deactivated when
/// their invitation expires or is revoked.
pub const MAX_TTL_SECONDS: i64 = 30 * 86_400;

/// Header carrying the idempotency key, MANDATORY on `POST /invitations`.
///
/// **A header, not a body field**, for three reasons drawn from the code and
/// the incident:
///
/// 1. The duplicate measured on 6 August came from an **automatic HTTP-stack
///    retry**, not a deliberate re-call from the client. What replays a
///    request at that level — a reqwest/OkHttp interceptor, nginx's
///    `proxy_next_upstream` — manipulates headers; that is the layer that
///    sets the key, and it has no business knowing the body's schema or
///    re-encoding it.
/// 2. The key is a transport metadata, not business data: adding it to
///    `CreateRequest` would have mixed it with `max_uses`/`ttl_seconds`, on
///    which the MEANING of the invitation depends. `create` already receives
///    the `HeaderMap` for authentication — no signature to change.
/// 3. It is the conventional shape (`Idempotency-Key`), hence the one retry
///    layers know how to set without specific code.
///
/// Compared in lowercase: `HeaderMap` normalises header names, so the case
/// used by the caller is irrelevant.
pub const IDEMPOTENCY_HEADER: &str = "idempotency-key";

/// Bounds of the key. The minimum is not decorative: the key is carried by
/// the caller and stands as a promise of uniqueness; a value like `1` or `x`
/// would collide with their own next request and hand them the previous
/// invitation back — a silent, inverted duplicate.
pub const IDEMPOTENCY_KEY_MIN: usize = 8;
pub const IDEMPOTENCY_KEY_MAX: usize = 200;

/// Longest room id this service will put in a URL path.
///
/// A Matrix identifier may not exceed 255 bytes (specification, "Common
/// identifier format"). Nothing here needs a longer one, and an unbounded
/// string from a request body would end up in a URL, in the logs of whatever
/// sits in front, and in this process's memory.
pub const MAX_ROOM_ID_LENGTH: usize = 255;

#[derive(Deserialize)]
pub struct CreateRequest {
    pub max_uses: u32,
    pub ttl_seconds: i64,
    /// **THE ROOM THE INVITATION IS FOR, AND IT IS REQUIRED.**
    ///
    /// Without it, this service cannot read a power level, so it cannot tell
    /// an account that can honour the link it hands out from one that cannot
    /// — which is the whole of the porteur's decision of 14 August 2026.
    ///
    /// **REQUIRED RATHER THAN OPTIONAL, AND THE MEASUREMENT IS WHAT MAKES
    /// THAT SAFE.** Nothing is published: the complete set of callers of
    /// `POST /invitations` lives in this repository — `core::issuance::emit`,
    /// `deploy/exploitation`'s `issue_invitation`, `deploy/bench_nominal_
    /// path.py` and this service's own tests — and no artefact of this product
    /// has ever left it through a store or a registry. There is therefore no
    /// old client in the wild whose requests an optional field would have to
    /// tolerate. And an optional field is not a lesser version of this rule,
    /// it is the ABSENCE of it: an invitation that names no room is one whose
    /// emitter's right cannot be checked, so it would have to be either
    /// refused — which is the required field, said awkwardly — or let through,
    /// which is the dead link this task exists to stop.
    ///
    /// The two builds installed by hand on devices (the Pixel, the iOS
    /// simulator) DO predate this field and will get a 400 until they are
    /// rebuilt. That is a rebuild, not a migration, and it is named in this
    /// task's report.
    pub room_id: String,
}

#[derive(Serialize)]
pub struct CreateResponse {
    pub invitation_id: String,
    pub token: String,
    // NOTE: `reserved_user_ids` is gone. Creating an invitation creates ZERO
    // Matrix accounts — accounts are created at claim time, one per claim, and
    // only then (lot 0, task 0.2; PRD §8.2 makes destructive revocation
    // possible only if no account exists before the invitee enters).
}

pub fn validate(r: &CreateRequest) -> Result<(), AppError> {
    if r.max_uses == 0 || r.max_uses > MAX_USES {
        return Err(AppError::InvalidRequest(format!(
            "max_uses must be between 1 and {MAX_USES}"
        )));
    }
    if r.ttl_seconds <= 0 || r.ttl_seconds > MAX_TTL_SECONDS {
        return Err(AppError::InvalidRequest(format!(
            "ttl_seconds must be between 1 and {MAX_TTL_SECONDS}"
        )));
    }
    validate_room_id(&r.room_id)?;
    Ok(())
}

/// Refuses a `room_id` that is not one, BEFORE it reaches a URL.
///
/// **THIS IS THE FIRST ROOM IDENTIFIER THIS SERVICE EVER TAKES FROM A REQUEST
/// BODY.** Every other one it puts in a Matrix path — `claim`'s, `revoke`'s —
/// came from its own database or from a `sync` it performed itself.
/// `matrix::MatrixClient` interpolates rooms into paths raw, which is correct
/// for a trusted value and an injection for an untrusted one: `!x/../../v3/
/// account/whoami` would leave the room endpoint entirely and address another
/// one, carrying the caller's own bearer.
///
/// The rule is deliberately about SHAPE and not about existence — whether the
/// room exists, and whether the caller is in it, is the homeserver's answer to
/// read, not this function's to guess.
///
/// **NO COLON IS REQUIRED**, and that is not laxity: room version 12 ids carry
/// no server part at all. The live run of 14 August 2026 created
/// `!oP6DDVpIVmvM91n6Mhebq_Gb07F3JMK3UJTcb9oHfe0`, so a rule demanding a colon
/// would refuse every room this lot gives birth to.
pub fn validate_room_id(room_id: &str) -> Result<(), AppError> {
    let refuse = |why: &str| {
        Err(AppError::InvalidRequest(format!(
            "room_id {why}: it must be a Matrix room identifier, starting with '!' and \
             holding no character that could leave a URL path segment"
        )))
    };
    if room_id.len() < 2 || room_id.len() > MAX_ROOM_ID_LENGTH {
        return refuse("has an invalid length");
    }
    if !room_id.starts_with('!') {
        return refuse("does not start with '!'");
    }
    // ASCII graphic excludes spaces, control characters and everything outside
    // ASCII in one stroke; the five named characters are the ones that would
    // change WHICH endpoint the read addresses, or hide something from it.
    if !room_id
        .bytes()
        .all(|b| b.is_ascii_graphic() && !matches!(b, b'/' | b'?' | b'#' | b'%' | b'\\'))
    {
        return refuse("carries a character it may not");
    }
    Ok(())
}

pub fn validate_idempotency_key(key: &str) -> Result<(), AppError> {
    let invalid = |what: &str| {
        Err(AppError::InvalidRequest(format!(
            "header {IDEMPOTENCY_HEADER} {what}: {IDEMPOTENCY_KEY_MIN} to \
             {IDEMPOTENCY_KEY_MAX} visible ASCII characters, no spaces"
        )))
    };
    if key.len() < IDEMPOTENCY_KEY_MIN || key.len() > IDEMPOTENCY_KEY_MAX {
        return invalid("of invalid length");
    }
    if !key.bytes().all(|b| b.is_ascii_graphic()) {
        return invalid("malformed");
    }
    Ok(())
}

/// Requires the idempotency key, and refuses it rather than doing without.
///
/// **Mandatory, not optional.** An optional key does not fix the observed
/// defect: the measured duplicate came from a retry the caller did not know
/// it was emitting, and a caller unaware of the key gets exactly the old
/// behaviour back. The price of the requirement is a loud 400 on the very
/// first call, before a single account exists; the price of silence is a
/// pool of definitive Matrix accounts. Accounts cannot be un-created, 400s
/// can.
pub fn extract_idempotency_key(headers: &HeaderMap) -> Result<String, AppError> {
    let raw = headers
        .get(IDEMPOTENCY_HEADER)
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| {
            AppError::InvalidRequest(format!(
                "header {IDEMPOTENCY_HEADER} is required: it makes retries safe; without it, \
                 every retry would create a new pool of definitive accounts"
            ))
        })?;
    validate_idempotency_key(raw)?;
    Ok(raw.to_string())
}

/// THE idempotency decision AND the ceiling, in a SINGLE SQL statement.
///
/// It is atomic by construction — SQLite admits only one writer at a time,
/// and the charge subquery is evaluated under that same lock —, so it holds
/// between two tasks as between two processes, which no applicative lock
/// could do.
///
/// **Laying down the pool IS inserting the invitation.** There is no
/// "read then decide then write" left to close up: the unique index
/// `(inviter_user_id, idempotency_key)` arbitrates, and the only possible
/// outcome for a second caller carrying the same key is a uniqueness
/// violation, hence the replay path.
///
/// **What a caller's charge is** — what the ceiling bounds — has TWO terms:
///
/// - the places still promised by their live invitations
///   (`max_uses - used_count` on `status = 'pending'`). These are counted from
///   the INSERT, before ANY account exists: under the claim-time creation
///   model no account ever exists at this point, and this term is what stops
///   two close-together creations from each passing a ceiling their sum
///   exceeds. It bounds PROMISES, not accounts;
/// - the accounts already created at claim time that survive a dead
///   invitation (revoked or expired) and await cleanup: rows in `reserved`
///   (created, never handed out) or `claiming` (trace written before
///   `register_dormant`, account possibly real). Without this term, a caller
///   whose claims keep failing after the registration would see their charge
///   return to zero at every failure while sowing definitive localparts, which
///   the homeserver never frees.
///
/// **`claiming` COUNTS, just like `reserved`, and that is a decision.** A trace
/// row written ahead of the irreversible call (see
/// `handlers::claim::create_account_for_claim`) may designate a very real
/// Matrix account — that is the whole point of writing it first. Not counting
/// it would reopen exactly the overrun path this second term closes.
///
/// `claimed` rows are deliberately OUT of both terms: a claimed account is a
/// person, not a promise. Revocation neutralises it synchronously (see
/// `handlers::revoke`), so it never lingers "awaiting cleanup" on a revoked
/// invitation; on an expired one it is a live account that cleanup must not
/// touch (PRD §8.2 — see `cleanup::deactivate_orphans`).
///
/// The price, accepted and transient: a trace row whose account never existed
/// is over-counted until the cleanup pass that terminates it. Erring on that
/// side costs a refusal; erring on the other costs accounts nothing takes
/// back.
///
/// `MAX(..., 0)` is a form guard: `used_count` cannot exceed `max_uses`
/// (`claim`'s guard), but a negative charge would open the ceiling, and it
/// is not the ceiling's place to trust anyone.
///
/// **THE `EXISTS` CLAUSE: the ceiling must never mask idempotency.**
///
/// Without it, the ceiling was the ONLY `WHERE` of this `INSERT … SELECT`.
/// False, it yields NO row — so the unique index is never consulted, so the
/// replay path becomes UNREACHABLE. Observed in production: a caller who had
/// just reached their ceiling and whose HTTP stack was re-emitting — the
/// EXACT scenario this fix targeted — got 429 instead of their invitation.
/// It created no duplicate, the ceiling stopped it; but it LOST ITS TOKEN,
/// which `token_sha256` does not give back and which only the replay can read
/// back. The already-created pool stayed charged against it until expiry,
/// unusable.
///
/// With it, the invariant holds: as soon as the key is already laid down FOR
/// THIS CALLER, the candidate row is produced whatever the ceiling's state,
/// the unique index refuses it, and the replay follows. A replay creates
/// nothing — so it has no business being under a CREATION limit.
///
/// It cannot open the ceiling in passing: a true `EXISTS` means exactly that
/// a row with the same `(inviter_user_id, idempotency_key)` exists, hence
/// that the insertion will end in a uniqueness violation. The only path it
/// opens is the replay, never a creation.
///
/// It stays in the SAME statement, under the same write lock: this is still
/// not a "read then decide then write". And the final arbiter remains the
/// index, never this read — a concurrent row that appeared after the
/// `EXISTS` was evaluated is refused by it the same way, including between
/// two processes.
///
/// **THE ISSUANCE GATE RIDES IN THIS STATEMENT, ON THE CEILING'S SIDE OF THE
/// `OR`, AND FOR THE CEILING'S REASON.** The porteur's decision of 14 August
/// 2026 is a rule about what may be CREATED: an account that cannot invite in
/// the room it names must not be handed a link it cannot honour. A REPLAY
/// creates nothing — it reads back an invitation that already exists — so the
/// gate has no more business arbitrating it than the ceiling has, and the
/// consequence of getting that wrong is the one already measured in
/// production: the caller loses a token `token_sha256` cannot give back, on an
/// invitation that stays charged against its ceiling.
///
/// Placing the gate before this statement instead would have done exactly
/// that to every caller demoted, or every room tightened, between an issuance
/// and its retry. Here, `EXISTS` produces the candidate row whatever the gate
/// says, the unique index refuses it, and the replay follows — while a
/// CREATION under a false gate yields no row at all.
///
/// The bind is a plain boolean rather than the levels themselves: SQLite has
/// no business knowing what a power level is, and the numbers are needed in
/// the refusal's text, which is not the database's to write.
const PLACE_THE_POOL: &str = "\
    INSERT INTO invitations \
        (id, inviter_user_id, token_sha256, created_at, expires_at, \
         max_uses, used_count, status, idempotency_key) \
    SELECT ?, ?, ?, ?, ?, ?, 0, 'pending', ? \
     WHERE EXISTS (SELECT 1 FROM invitations \
                    WHERE inviter_user_id = ? AND idempotency_key = ?) \
        OR (? AND ? \
         + (SELECT COALESCE(SUM(MAX(max_uses - used_count, 0)), 0) FROM invitations \
             WHERE inviter_user_id = ? AND status = 'pending') \
         + (SELECT COUNT(*) FROM reserved_accounts ra \
              JOIN invitations i ON i.id = ra.invitation_id \
             WHERE i.inviter_user_id = ? AND ra.status IN ('reserved', 'claiming') \
               AND i.status <> 'pending') \
        <= ?)";

fn is_unique_conflict(e: &sqlx::Error) -> bool {
    e.as_database_error()
        .is_some_and(|d| d.is_unique_violation())
}

pub async fn create(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
    Body(req): Body<CreateRequest>,
) -> Result<Json<CreateResponse>, AppError> {
    validate(&req)?;
    let key = extract_idempotency_key(&headers)?;

    // `whoami`: the ONLY call to the homeserver that precedes the decision,
    // and it creates nothing — it is an identity read. It must come first,
    // because the idempotency key is carried by the caller and only has
    // meaning relative to a principal: a key not attached to an identity
    // would let one caller replay another's invitation, and so obtain its
    // token.
    //
    // The constraint that matters — a Matrix account cannot be un-created —
    // bears on `register_dormant`, and the decision is taken before the
    // first of them, without exception.
    //
    // The bearer is BORROWED as well as resolved: the gate below reads the
    // room as the person asking, this service holding no room-reading right of
    // its own. It reaches no column of the database (§5).
    let (inviter, bearer) = auth::authenticate_and_borrow(&st.mx, &headers).await?;

    // ------------------------------------------------------------------------
    // THE ISSUANCE GATE — porteur's decision, 14 August 2026: the service
    // refuses to emit an invitation to an account that cannot honour it.
    //
    // A SECOND READ, and it creates nothing either. Both calls this handler
    // makes to the homeserver are GETs; the irreversible act
    // (`register_dormant`) lives at claim time and is reached from here by no
    // path at all.
    //
    // The verdict is computed HERE and consumed by the statement below, rather
    // than short-circuiting: a refusal must not be allowed to stand between a
    // caller and the replay of an invitation it already owns. See
    // `PLACE_THE_POOL`.
    // ------------------------------------------------------------------------
    let rights = st
        .mx
        .invite_rights_in_room(&bearer, &req.room_id, &inviter)
        .await;
    let may_emit = matches!(&rights, Ok(r) if r.permits_invitation());

    let token = crypto::generate_token();
    let id = uuid::Uuid::new_v4().to_string();
    let (created, expires) = (now(), now() + req.ttl_seconds);

    // NO account is created here, by design (lot 0, task 0.2). The only
    // homeserver call in this handler is `whoami` above — a read. The
    // irreversible act (`register_dormant`) moved to claim time, where the
    // trace-before-act rule is enforced by
    // `handlers::claim::create_account_for_claim`. What remains irreversible
    // HERE is the promise itself: the ceiling counts promised places from
    // this INSERT, so the decision below is still taken before anything an
    // HTTP retry could duplicate.
    //
    // ------------------------------------------------------------------------
    // THE DECISION. Taken HERE, before the invitation row exists — an HTTP
    // retry of this request must find either no row (free key, ceiling
    // permitting) or the arbitration of the unique index, never a second
    // batch of anything.
    // ------------------------------------------------------------------------
    let placed = sqlx::query(PLACE_THE_POOL)
        .bind(&id)
        .bind(&inviter)
        .bind(crypto::token_hash(&token))
        .bind(created)
        .bind(expires)
        .bind(req.max_uses)
        .bind(&key)
        .bind(&inviter) // is the key ALREADY laid down for this caller?
        .bind(&key)
        .bind(may_emit) // may this account invite in the room it names?
        .bind(req.max_uses) // what the request adds to the charge
        .bind(&inviter) // places promised by their live invitations
        .bind(&inviter) // accounts created at claim time surviving their dead invitations
        .bind(st.cfg.max_reserved_accounts_per_inviter)
        .execute(&st.pool)
        .await;
    match placed {
        Ok(r) if r.rows_affected() == 1 => {} // the invitation is ours
        // Zero rows, and since the `EXISTS` clause that says only ONE thing:
        // this really is a CREATION, not a replay, and it was refused. WHOLE
        // REFUSAL: no invitation was laid down, no account exists — none ever
        // exists at this stage.
        //
        // WHICH refusal is not the database's to say: two conditions share
        // that `OR`, and they call for opposite gestures — "get promoted" is
        // somebody else's, "revoke an invitation or raise the setting" is the
        // operator's. The gate is answered FIRST because it is the more
        // specific of the two: an account that may not invite here gains
        // nothing from learning about a ceiling it also happens to have hit.
        Ok(_) if !may_emit => return Err(refuse_issuance(rights)),
        Ok(_) => {
            return Err(AppError::CeilingReached {
                ceiling: st.cfg.max_reserved_accounts_per_inviter,
                requested: req.max_uses,
            })
        }
        Err(e) if is_unique_conflict(&e) => {
            return replay(&st, &inviter, &key).await.map(Json);
        }
        Err(e) => return Err(anyhow::Error::from(e).into()),
    }

    sqlx::query(
        "INSERT INTO inviter_counters (inviter_user_id, issued_count) VALUES (?,1) \
         ON CONFLICT(inviter_user_id) DO UPDATE SET issued_count = issued_count + 1",
    )
    .bind(&inviter)
    .execute(&st.pool)
    .await
    .map_err(anyhow::Error::from)?;

    // COMPLETION MARKER, written last. A non-null `token_enc` means exactly
    // "this response was produced", and it is the replay's only material:
    // `token_sha256` is irreversible, the plaintext token exists nowhere
    // else.
    //
    // Its failure must NOT fail the call. The caller already holds their
    // response — the token is returned to them. Answering with an error
    // would push them to retry, to receive `CreationInFlight` since the row
    // exists, then to start over with a fresh key: a second promise charged
    // to the ceiling, precisely what all of this fixes. We log and return
    // the response; that invitation simply will not be replayable.
    //
    // Sealing the token falls under the SAME rule and is handled alike: a
    // `?` here would fail the call for a reason that takes nothing away from
    // what the caller has already obtained.
    let marker = crypto::seal(&st.cfg.encryption_key, &token);
    let written = match marker {
        Ok(sealed) => sqlx::query("UPDATE invitations SET token_enc = ? WHERE id = ?")
            .bind(sealed)
            .bind(&id)
            .execute(&st.pool)
            .await
            .map(|_| ())
            .map_err(anyhow::Error::from),
        Err(e) => Err(e),
    };
    if let Err(e) = written {
        tracing::error!(
            "invitation {id} created but not replayable (completion marker not written): {e:#}"
        );
    }

    Ok(Json(CreateResponse {
        invitation_id: id,
        token,
    }))
}

/// Turns the room read that did NOT permit into the refusal the caller reads.
///
/// **EVERY BRANCH IS A REFUSAL, WHICH IS THE POINT.** This function is only
/// reached when `may_emit` is false, and it is total: there is no path through
/// it that lets an issuance proceed. The campaign measured on 14 August 2026
/// what the opposite shape costs — `revoke_invitation` mapped a 404 to a
/// success, and thirty-two accounts stayed alive on a homeserver the database
/// believed had none.
///
/// The `Ok` arm is not dead code and must not be collapsed into the others: a
/// state that WAS read, and says 50 against 0, is the ordinary case of this
/// gate, and it is the only one that can name both numbers.
fn refuse_issuance(rights: Result<matrix::InviteRights, matrix::InviteRightsError>) -> AppError {
    match rights {
        Ok(read) => AppError::NotPromotedToInvite {
            required: read.required,
            // `Creator` never reaches here: it permits unconditionally. A
            // level is what the refusal is about, so a level is what it says.
            held: match read.held {
                matrix::HeldPower::Level(level) => level,
                matrix::HeldPower::Creator => read.required,
            },
        },
        Err(matrix::InviteRightsError::NotVisible) => AppError::RoomNotVisible,
        // The stack is unwell, and this service says so under the code that
        // already means it — never under a rights refusal, which would send an
        // operator to change a power level that is not at fault.
        Err(matrix::InviteRightsError::Unreachable) => AppError::HomeserverUnavailable,
        Err(matrix::InviteRightsError::Unreadable(why)) => AppError::InviteRightUnreadable(why),
    }
}

/// Returns the invitation already laid down under this key, identically —
/// without touching the homeserver.
///
/// The replay does NOT filter on the invitation's status. A revoked or
/// expired invitation remains "the same invitation": returning anything else
/// would push the caller to ask for a new one, hence to lay a second promise
/// on the ceiling. Its current validity is discovered through `claim`, not
/// here.
async fn replay(st: &AppState, inviter: &str, key: &str) -> Result<CreateResponse, AppError> {
    let inv = sqlx::query(
        "SELECT id, token_enc FROM invitations \
         WHERE inviter_user_id = ? AND idempotency_key = ?",
    )
    .bind(inviter)
    .bind(key)
    .fetch_optional(&st.pool)
    .await
    .map_err(anyhow::Error::from)?
    // `token_sha256` also carries a uniqueness constraint. A collision there
    // is out of reach (160-bit token), but if the conflict came from
    // somewhere other than the key, it must above all not be passed off as a
    // replay: that would be returning an unrelated invitation.
    .ok_or_else(|| {
        AppError::Internal(anyhow::anyhow!(
            "unique conflict with no matching invitation for this key"
        ))
    })?;

    let id: String = inv.get("id");
    // Missing marker: the response was never produced — a concurrent creation
    // still in flight, or a dead attempt.
    let Some(sealed) = inv.get::<Option<Vec<u8>>, _>("token_enc") else {
        return Err(AppError::CreationInFlight);
    };

    Ok(CreateResponse {
        invitation_id: id,
        token: crypto::open(&st.cfg.encryption_key, &sealed)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A request shaped like the ones a shell sends, with only the field under
    /// test moved.
    fn request(max_uses: u32, ttl_seconds: i64) -> CreateRequest {
        CreateRequest {
            max_uses,
            ttl_seconds,
            room_id: DEMONSTRATION_ROOM.to_string(),
        }
    }

    #[test]
    fn refuses_more_than_ten_uses() {
        assert!(validate(&request(11, 3600)).is_err());
    }

    #[test]
    fn refuses_zero_uses_and_negative_ttl() {
        assert!(validate(&request(0, 3600)).is_err());
        assert!(validate(&request(1, -1)).is_err());
    }

    #[test]
    fn accepts_valid_bounds() {
        assert!(validate(&request(1, 60)).is_ok());
        assert!(validate(&request(10, 604800)).is_ok());
    }

    /// **THE ROOM ID GOES INTO A URL PATH, AND IT COMES FROM THE REQUEST
    /// BODY.** Every other room this service has ever put in a path came from
    /// its own database or from a `sync` it made itself; this one is written by
    /// the caller. Unchecked, `!x/../../account/whoami` would leave the room
    /// endpoint entirely and address another one with the caller's own bearer.
    ///
    /// The shapes accepted are the two that exist: the classic
    /// `!opaque:server` and the version-12 form, which carries no server part
    /// at all — the live run of 14 August 2026 created
    /// `!oP6DDVpIVmvM91n6Mhebq_Gb07F3JMK3UJTcb9oHfe0`, and a rule demanding a
    /// colon would have refused every room this lot gives birth to.
    #[test]
    fn the_room_id_may_not_leave_its_path_segment() {
        for hostile in [
            "!x/../../v3/account/whoami",
            "!x/state",
            "!x?filter=1",
            "!x#fragment",
            "!x%2f..",
            "!x\\y",
            "!room with a space",
            "!room\nwith-a-newline",
            "!salon-accentué:h",
            "",
            "!",
            "room-without-the-sigil:h",
            "@alice:h",
        ] {
            assert!(
                validate_room_id(hostile).is_err(),
                "a room id that is not one must be refused BEFORE it reaches a URL: {hostile:?}"
            );
        }
        assert!(
            validate_room_id(&format!("!{}:h", "r".repeat(300))).is_err(),
            "a room id longer than any Matrix identifier must be refused"
        );

        // Control: the two real shapes pass, without which the rule above
        // would refuse everything and prove nothing.
        assert!(validate_room_id("!rrITrtfgg8HrvpdgSsHUiTgJ7LqqSjGE8q2gsUbZEOI").is_ok());
        assert!(validate_room_id("!abcDEF123:messagr.eu").is_ok());
        assert!(validate_room_id(DEMONSTRATION_ROOM).is_ok());
    }

    /// The room travels with the two bounds, and a request without one is
    /// refused by the extractor before the handler is ever reached — which is
    /// what makes the field REQUIRED rather than merely expected.
    #[test]
    fn a_request_without_a_room_does_not_deserialise() {
        assert!(
            serde_json::from_str::<CreateRequest>(r#"{"max_uses":1,"ttl_seconds":60}"#).is_err(),
            "the field is required: a body without it must not produce a request at all"
        );
        let complete: CreateRequest =
            serde_json::from_str(r#"{"max_uses":1,"ttl_seconds":60,"room_id":"!room:h"}"#)
                .expect("the three fields together must deserialise");
        assert_eq!(complete.room_id, "!room:h");
    }

    /// `now() + ttl_seconds` is an unchecked `i64` addition: without an upper
    /// bound, `i64::MAX` panics in debug and yields an absurd `expires_at` in
    /// release. The exact bound must stay accepted — a rejection at exactly
    /// 30 days would pass this test for a wrong reason.
    #[test]
    fn refuses_a_ttl_beyond_the_bound_and_accepts_the_bound() {
        assert!(validate(&request(1, MAX_TTL_SECONDS)).is_ok());
        assert!(validate(&request(1, MAX_TTL_SECONDS + 1)).is_err());
        assert!(validate(&request(1, i64::MAX)).is_err());

        // The bound makes the addition safe: the overflow becomes unreachable.
        assert!(now().checked_add(MAX_TTL_SECONDS).is_some());
    }

    /// The key alone carries the promise of uniqueness of a pool of
    /// definitive accounts: what cannot keep it must be refused BEFORE any
    /// network call.
    ///
    /// The lengths exercised here are ABSOLUTE, not expressed in terms of the
    /// constants. An assertion written `IDEMPOTENCY_KEY_MIN - 1` only compares
    /// the constant to itself: it survives a `MIN = 1` intact, and so would
    /// never have said anything about the fact that a "1" key must be
    /// refused. The exact bounds are verified AS WELL, for the off-by-one
    /// error.
    #[test]
    fn the_idempotency_key_is_refused_outside_its_bounds_and_its_form() {
        let a = |n: usize| "k".repeat(n);

        // Too short to be a credible uniqueness promise: a one- or
        // two-character key would collide with the same caller's next
        // request, which would be handed the previous invitation back.
        for short_key in ["1", "ab", "abcd", "short"] {
            assert!(
                validate_idempotency_key(short_key).is_err(),
                "too-short key accepted: {short_key:?}"
            );
        }
        // Excessive: it would end up as-is in the database, in the index and
        // in the logs.
        assert!(
            validate_idempotency_key(&a(1000)).is_err(),
            "a thousand-character key must be refused"
        );
        assert!(validate_idempotency_key("").is_err(), "empty key");

        // The EXACT bounds, for the off-by-one error.
        assert!(
            validate_idempotency_key(&a(IDEMPOTENCY_KEY_MIN - 1)).is_err(),
            "one character under the lower bound"
        );
        assert!(
            validate_idempotency_key(&a(IDEMPOTENCY_KEY_MIN)).is_ok(),
            "the EXACT lower bound must be accepted"
        );
        assert!(
            validate_idempotency_key(&a(IDEMPOTENCY_KEY_MAX)).is_ok(),
            "the EXACT upper bound must be accepted"
        );
        assert!(
            validate_idempotency_key(&a(IDEMPOTENCY_KEY_MAX + 1)).is_err(),
            "one character above the upper bound"
        );

        for malformed in [
            "        ",        // spaces only: sufficient length, null content
            "key with space",  // internal space
            "key\twith\ttab",  // control character
            "key\nwith\nlf",   // line feed: injection into the logs
            "kéy-accented-ok", // outside ASCII
        ] {
            assert!(
                validate_idempotency_key(malformed).is_err(),
                "malformed key accepted: {malformed:?}"
            );
        }

        // Control: the forms genuinely expected from a caller pass, without
        // which the validation could refuse everything and the assertions
        // above would prove nothing. A UUID v4 (36 characters) and a
        // 32-character base32 token, like those the service generates.
        assert!(validate_idempotency_key("6f1c9d3e-2b47-4a0e-9c11-8de5a2f30b64").is_ok());
        assert!(validate_idempotency_key("MFRGGZDFMZTWQ2LKNRWW6ZDFMZTWQ2LK").is_ok());
    }

    /// The header is MANDATORY: its absence must produce a refusal, never a
    /// silent fallback to a key generated by the service — which would make
    /// every retry unique, hence duplicate the pool, i.e. the very defect
    /// being fixed.
    #[test]
    fn the_idempotency_header_is_required_and_its_case_is_irrelevant() {
        assert!(
            extract_idempotency_key(&HeaderMap::new()).is_err(),
            "without the header, the request must be refused"
        );

        // `HeaderMap` normalises names: the case used by the caller must not
        // decide the fate of their account pool.
        for name in ["Idempotency-Key", "idempotency-key", "IDEMPOTENCY-KEY"] {
            let mut h = HeaderMap::new();
            h.insert(name, "key-of-test-1".parse().unwrap());
            assert_eq!(
                extract_idempotency_key(&h).unwrap(),
                "key-of-test-1",
                "header not recognised under the case {name}"
            );
        }

        let mut h = HeaderMap::new();
        h.insert(IDEMPOTENCY_HEADER, "short".parse().unwrap());
        assert!(
            extract_idempotency_key(&h).is_err(),
            "a present but invalid key must be refused, not ignored"
        );
    }

    // -----------------------------------------------------------------------
    // Scaffolding: a real migrated SQLite database, and an in-process fake
    // homeserver that COUNTS its account registrations.
    //
    // The counter is the central instrument. Under the claim-time creation
    // model (lot 0, task 0.2), `create` must NEVER reach `/v3/register` — not
    // under load, not on a retry, not under concurrency. The property tested
    // here is never "the response is correct" but "no account was created on
    // the homeserver": a Matrix account cannot be un-created, and only the
    // counter sees it.
    //
    // `whoami` derives identity from the bearer token: `Bearer alice`
    // authenticates as `@alice:h`. That is what lets per-caller scope be
    // tested without mounting two servers.
    // -----------------------------------------------------------------------

    use axum::http::StatusCode;
    use serde_json::{json, Value};
    use sqlx::SqlitePool;
    use std::sync::Mutex;

    const ENCRYPTION_KEY: [u8; 32] = [0u8; 32];

    /// The room id of the DEMONSTRATION room, verbatim from the live read of
    /// 14 August 2026. Used as the default fixture because it is the room the
    /// product actually demonstrates in, and because its rights are the ones
    /// every existing room carries.
    const DEMONSTRATION_ROOM: &str = "!rrITrtfgg8HrvpdgSsHUiTgJ7LqqSjGE8q2gsUbZEOI";

    /// The state of a room BORN BEFORE THIS LOT — the demonstration room, read
    /// off production on 14 August 2026. **It carries no `invite` key at
    /// all**, which the specification reads as 0: every joined member may
    /// invite there, whether or not anyone ever promoted them.
    ///
    /// This is the DEFAULT of the scaffolding on purpose. It is the shape of
    /// every room that exists today, so every test in this module that is not
    /// about the gate keeps exercising exactly what it exercised before the
    /// gate existed.
    fn a_room_born_before_this_lot() -> Value {
        json!([
            {"type": "m.room.create", "state_key": "", "sender": "@maria:h",
             "content": {"room_version": "12"}},
            {"type": "m.room.power_levels", "state_key": "", "sender": "@maria:h",
             "content": {"events": {"m.room.power_levels": 100}, "users": {}}}
        ])
    }

    /// The state of a room born of `InviterSession::create_conversation` since
    /// the porteur's decision B: `invite` at 50, `users` empty because room
    /// version 12 privileges its creator implicitly. Read off production the
    /// same evening, from a room the fixture account had just created.
    fn a_room_born_of_this_lot(creator: &str) -> Value {
        json!([
            {"type": "m.room.create", "state_key": "", "sender": creator,
             "content": {"room_version": "12"}},
            {"type": "m.room.power_levels", "state_key": "", "sender": creator,
             "content": {"events": {"m.room.power_levels": 100}, "invite": 50, "users": {}}}
        ])
    }

    struct FakeHs {
        /// Number of `/v3/register` calls — i.e. of Matrix accounts created.
        registers: Mutex<usize>,
        /// What `GET /v3/rooms/{id}/state` answers, and under which status.
        /// The default is the demonstration room, served 200.
        state: Mutex<(u16, Value)>,
        /// Number of room-state reads, so a test can assert that the gate
        /// really asks the homeserver rather than concluding on its own.
        state_reads: Mutex<usize>,
    }

    impl FakeHs {
        fn registers(&self) -> usize {
            *self.registers.lock().unwrap()
        }
        fn state_reads(&self) -> usize {
            *self.state_reads.lock().unwrap()
        }
        /// Changes what the room's state says from here on — the way an
        /// account gets promoted, or demoted, between two calls.
        fn serve_state(&self, status: u16, state: Value) {
            *self.state.lock().unwrap() = (status, state);
        }
    }

    async fn route(
        State(f): State<Arc<FakeHs>>,
        req: axum::extract::Request,
    ) -> axum::response::Response {
        use axum::response::IntoResponse;
        let path = req.uri().path().to_string();
        let bearer = req
            .headers()
            .get("authorization")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .unwrap_or("unknown")
            .to_string();

        if path.ends_with("/account/whoami") {
            return Json(json!({"user_id": format!("@{bearer}:h")})).into_response();
        }
        if path.ends_with("/state") {
            *f.state_reads.lock().unwrap() += 1;
            let (status, body) = f.state.lock().unwrap().clone();
            return (StatusCode::from_u16(status).unwrap(), Json(body)).into_response();
        }
        if path.ends_with("/v3/register") {
            // Creating an invitation must NEVER lead here anymore. Counted so
            // that every test in this module fails the moment it does.
            *f.registers.lock().unwrap() += 1;
            return Json(json!({"user_id": "@never:h", "access_token": "token"})).into_response();
        }
        (StatusCode::NOT_FOUND, Json(json!({}))).into_response()
    }

    async fn mount(pool: SqlitePool, ceiling: i64) -> (Arc<AppState>, Arc<FakeHs>) {
        let fake = Arc::new(FakeHs {
            registers: Mutex::new(0),
            state: Mutex::new((200, a_room_born_before_this_lot())),
            state_reads: Mutex::new(0),
        });
        let app = axum::Router::new().fallback(route).with_state(fake.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });

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
                encryption_key: ENCRYPTION_KEY,
                edge_retention_days: 30,
                bind_addr: String::new(),
                max_reserved_accounts_per_inviter: ceiling,
            },
        });
        (st, fake)
    }

    /// A complete `POST /invitations`, as axum would call it, naming the
    /// demonstration room — the room every one of these tests worked in
    /// before this gate existed.
    async fn create_one(
        st: &Arc<AppState>,
        caller: &str,
        key: Option<&str>,
        max_uses: u32,
    ) -> Result<CreateResponse, AppError> {
        create_one_in(st, caller, key, max_uses, DEMONSTRATION_ROOM).await
    }

    /// The same, naming a room of the caller's choosing.
    async fn create_one_in(
        st: &Arc<AppState>,
        caller: &str,
        key: Option<&str>,
        max_uses: u32,
        room_id: &str,
    ) -> Result<CreateResponse, AppError> {
        let mut headers = HeaderMap::new();
        headers.insert("authorization", format!("Bearer {caller}").parse().unwrap());
        if let Some(c) = key {
            headers.insert(IDEMPOTENCY_HEADER, c.parse().unwrap());
        }
        create(
            State(st.clone()),
            headers,
            Body(CreateRequest {
                max_uses,
                ttl_seconds: 3600,
                room_id: room_id.to_string(),
            }),
        )
        .await
        .map(|Json(r)| r)
    }

    async fn count(pool: &SqlitePool, sql: &str) -> i64 {
        sqlx::query_scalar(sql).fetch_one(pool).await.unwrap()
    }

    async fn invitations(pool: &SqlitePool) -> i64 {
        count(pool, "SELECT COUNT(*) FROM invitations").await
    }

    async fn accounts_in_db(pool: &SqlitePool) -> i64 {
        count(pool, "SELECT COUNT(*) FROM reserved_accounts").await
    }

    // -----------------------------------------------------------------------

    /// **The central invariant: two calls with the same key never create two
    /// invitations — and no account at all.**
    ///
    /// What is tested is not the second response's body but the number of
    /// accounts created on the homeserver. The fake counts them; after the
    /// replay the count must be RIGOROUSLY UNCHANGED — and, under the
    /// claim-time creation model, rigorously ZERO from the start. This is the
    /// only formulation that catches an implementation that would create
    /// first and notice the duplicate afterwards: such an implementation
    /// would return the same response and leave definitive accounts behind.
    ///
    /// The replay must also return the SAME invitation, token included:
    /// deprived of its token, the caller would ask for another invitation —
    /// the defect, by another path. The completion marker (`token_enc`) is
    /// what makes that possible, so it is asserted here as well.
    #[sqlx::test(migrations = "./migrations")]
    async fn same_key_twice_creates_one_invitation_and_zero_accounts(pool: SqlitePool) {
        let (st, fake) = mount(pool.clone(), 100).await;

        let first = create_one(&st, "alice", Some("key-of-pool-1"), 3)
            .await
            .expect("the first creation must succeed");
        assert_eq!(
            fake.registers(),
            0,
            "creating an invitation creates ZERO accounts"
        );
        assert_eq!(
            accounts_in_db(&pool).await,
            0,
            "and writes no reserved_accounts row"
        );

        let second = create_one(&st, "alice", Some("key-of-pool-1"), 3)
            .await
            .expect("the replay must return the invitation, not an error");

        assert_eq!(fake.registers(), 0, "a replay creates nothing either");
        assert_eq!(second.invitation_id, first.invitation_id);
        assert_eq!(second.token, first.token, "the token must be the SAME");
        assert_eq!(invitations(&pool).await, 1, "a single invitation in base");
        assert_eq!(accounts_in_db(&pool).await, 0);
        assert_eq!(
            count(
                &pool,
                "SELECT COUNT(*) FROM invitations WHERE token_enc IS NOT NULL"
            )
            .await,
            1,
            "the completion marker must be written, otherwise no replay is possible"
        );
    }

    /// **The same invariant under concurrency**: two SIMULTANEOUS creations
    /// with the same key. The arbitration is the database's — the unique
    /// index `(inviter_user_id, idempotency_key)` — so it would hold between
    /// two processes, which no applicative lock can do.
    ///
    /// No assertion on WHO wins: a single invitation exists, no account was
    /// created, and the loser, if it errored at all, learned that its KEY is
    /// taken (`CreationInFlight`) — never a degraded answer.
    #[sqlx::test(migrations = "./migrations")]
    async fn concurrent_same_key_creates_one_invitation_and_zero_accounts(pool: SqlitePool) {
        let (st, fake) = mount(pool.clone(), 100).await;

        let (a, b) = tokio::join!(
            create_one(&st, "alice", Some("key-simultaneous"), 2),
            create_one(&st, "alice", Some("key-simultaneous"), 2)
        );

        assert_eq!(fake.registers(), 0, "no account on the homeserver");
        assert_eq!(invitations(&pool).await, 1);
        assert_eq!(accounts_in_db(&pool).await, 0);

        assert!(
            [&a, &b].iter().any(|r| r.is_ok()),
            "at least one of the two creations must succeed, otherwise nothing is proven"
        );
        for r in [&a, &b].iter().filter_map(|r| r.as_ref().ok()) {
            assert!(!r.token.is_empty(), "a success carries the token");
        }
        for e in [&a, &b].iter().filter_map(|r| r.as_ref().err()) {
            assert!(
                matches!(e, AppError::CreationInFlight),
                "the loser must be refused explicitly, not degraded: {e}"
            );
        }
    }

    /// **The key is carried by the caller: it only has meaning relative to
    /// them.** Two distinct callers choosing the same string must each get
    /// THEIR invitation.
    ///
    /// A globally-scoped key would return Alice's invitation — hence her
    /// TOKEN — to Bob: a disclosure between principals, not idempotency. And
    /// it would deny Bob an invitation he is entitled to.
    #[sqlx::test(migrations = "./migrations")]
    async fn same_key_for_two_callers_shares_nothing(pool: SqlitePool) {
        let (st, fake) = mount(pool.clone(), 100).await;

        let alice = create_one(&st, "alice", Some("key-shared"), 1)
            .await
            .unwrap();
        let bob = create_one(&st, "bob", Some("key-shared"), 1)
            .await
            .expect("Alice's key must not deprive Bob of his invitation");

        assert_ne!(bob.invitation_id, alice.invitation_id);
        assert_ne!(
            bob.token, alice.token,
            "Alice's token must NEVER be returned to Bob"
        );
        assert_eq!(invitations(&pool).await, 2);
        assert_eq!(fake.registers(), 0);

        // And each keeps their idempotency: Bob's replay returns Bob's invitation.
        let bob_replay = create_one(&st, "bob", Some("key-shared"), 1).await.unwrap();
        assert_eq!(bob_replay.token, bob.token);
        assert_eq!(fake.registers(), 0, "a replay creates nothing");
    }

    /// **A missing or unusable key creates nothing at all.**
    ///
    /// This is what makes the requirement real: if the missing header were
    /// tolerated — by falling back to a generated key, or by simply skipping
    /// the check — every HTTP-stack retry would become a new invitation. The
    /// refusal must land before anything is written, and the fake's counter
    /// must stay at zero.
    #[sqlx::test(migrations = "./migrations")]
    async fn missing_or_bad_key_creates_nothing(pool: SqlitePool) {
        let (st, fake) = mount(pool.clone(), 100).await;
        let too_long = "k".repeat(IDEMPOTENCY_KEY_MAX + 1);

        for key in [
            None,
            Some("short"),
            Some("with space here"),
            Some(too_long.as_str()),
        ] {
            let r = create_one(&st, "alice", key, 2).await;
            assert!(
                matches!(r, Err(AppError::InvalidRequest(_))),
                "key {key:?}: explicit refusal expected"
            );
        }
        assert_eq!(fake.registers(), 0, "no account on the homeserver");
        assert_eq!(invitations(&pool).await, 0);
        assert_eq!(accounts_in_db(&pool).await, 0);

        // Control: the scaffolding does create invitations when the key is
        // valid, otherwise the zeroes above prove nothing.
        create_one(&st, "alice", Some("key-valid-1"), 2)
            .await
            .unwrap();
        assert_eq!(invitations(&pool).await, 1);
        assert_eq!(fake.registers(), 0, "and even then, no account");
    }

    /// **The ceiling refuses the invitation ENTIRELY, and creates nothing.**
    ///
    /// Both halves matter equally. A service that would serve "what remains
    /// under the ceiling" would return a truncated promise — a silent
    /// degradation the caller can conclude nothing from. Under the claim-time
    /// model the ceiling bounds PROMISED PLACES (and already-created accounts
    /// of dead invitations), so it is exercised here entirely on promises:
    /// `registers` stays at zero throughout, by construction.
    ///
    /// The boundary is tested EXACTLY: a request that reaches the ceiling
    /// precisely must pass, one that exceeds it by one must be refused. It is
    /// the only place the comparison can be off by one.
    #[sqlx::test(migrations = "./migrations")]
    async fn ceiling_refuses_the_whole_invitation_and_creates_nothing(pool: SqlitePool) {
        let (st, fake) = mount(pool.clone(), 5).await;

        create_one(&st, "alice", Some("key-of-pool-1"), 4)
            .await
            .unwrap();
        // Alice's charge: 4 promised places out of 5 — and not one account.

        let refusal = create_one(&st, "alice", Some("key-of-pool-2"), 2).await;
        assert!(
            matches!(refusal, Err(AppError::CeilingReached { .. })),
            "4 + 2 exceeds 5: refusal expected, got {refusal:?}",
            refusal = refusal.map(|r| r.invitation_id)
        );
        assert_eq!(fake.registers(), 0, "a ceiling refusal creates NOTHING");
        assert_eq!(invitations(&pool).await, 1, "no invitation written");
        assert_eq!(accounts_in_db(&pool).await, 0);

        // The EXACT boundary stays open: 4 + 1 = 5, the ceiling is reached,
        // not exceeded.
        create_one(&st, "alice", Some("key-of-pool-3"), 1)
            .await
            .expect("reaching the ceiling exactly must remain allowed");
        assert_eq!(invitations(&pool).await, 2);

        // And a single place more is now too much.
        assert!(matches!(
            create_one(&st, "alice", Some("key-of-pool-4"), 1).await,
            Err(AppError::CeilingReached { .. })
        ));
        assert_eq!(fake.registers(), 0);
    }

    /// **A REPLAY ALWAYS RETURNS WHAT THE FIRST CALL PRODUCED, REGARDLESS OF
    /// THE CEILING'S STATE.**
    ///
    /// The defect seen in production: the ceiling was the only `WHERE` of an
    /// `INSERT … SELECT`. False, it yields no row — so the unique index is
    /// never consulted, so the replay path is UNREACHABLE. A caller who had
    /// just reached their ceiling and whose HTTP stack re-emitted — the EXACT
    /// scenario the idempotency fix targeted — got 429 instead of their
    /// invitation. It created no duplicate, but the caller LOST THEIR TOKEN:
    /// `token_sha256` is irreversible and `token_enc` is only readable by the
    /// replay.
    ///
    /// The ceiling is here reached EXACTLY by the first creation, so that the
    /// replay — which carries the same `max_uses` — exceeds it widely: the
    /// only configuration where the old code returned `CeilingReached`.
    ///
    /// The CONTROL at the end is inseparable from the assertion at the start:
    /// without it, this test would also pass on a service that had simply
    /// disarmed its ceiling, which is the opposite defect, and worse.
    #[sqlx::test(migrations = "./migrations")]
    async fn replay_returns_the_invitation_even_at_ceiling(pool: SqlitePool) {
        let (st, fake) = mount(pool.clone(), 3).await;

        let first = create_one(&st, "alice", Some("key-of-pool-1"), 3)
            .await
            .unwrap();
        // Alice's ceiling is reached EXACTLY — in promised places, no account.

        let replayed = create_one(&st, "alice", Some("key-of-pool-1"), 3)
            .await
            .expect("a replay creates nothing: no creation limit has to arbitrate it");

        assert_eq!(replayed.invitation_id, first.invitation_id);
        assert_eq!(
            replayed.token, first.token,
            "the token must be the SAME: it exists nowhere else, and a caller \
             deprived of it keeps a charged, unusable promise"
        );
        assert_eq!(fake.registers(), 0, "a replay creates NO account");
        assert_eq!(invitations(&pool).await, 1);

        // CONTROL: the ceiling has not been disarmed. A NEW key from the same
        // caller stays refused, and creates nothing.
        assert!(
            matches!(
                create_one(&st, "alice", Some("key-of-pool-2"), 1).await,
                Err(AppError::CeilingReached { .. })
            ),
            "a new key at ceiling must stay refused: this is not a replay, it is a creation"
        );
        assert_eq!(fake.registers(), 0, "and that refusal creates nothing");
        assert_eq!(invitations(&pool).await, 1);
    }

    /// **The same invariant UNDER CONCURRENCY, tight ceiling.**
    ///
    /// Two SIMULTANEOUS creations with the same key, whose sum exceeds the
    /// ceiling, used to fall onto it: the loser got 429 instead of the
    /// idempotency conflict. Yet the two answers say OPPOSITE things — 429
    /// says "revoke an invitation, wait, or raise the setting", so a
    /// well-behaved client stops; 409 `CreationInFlight` says "retry with the
    /// SAME key". Under 429, the token of the invitation the other task is
    /// creating is lost for good.
    ///
    /// The ceiling is here reached EXACTLY by a single invitation, so the
    /// second task asks for exactly twice what remains.
    #[sqlx::test(migrations = "./migrations")]
    async fn concurrent_same_key_does_not_fall_back_to_ceiling(pool: SqlitePool) {
        let (st, fake) = mount(pool.clone(), 2).await;

        let (a, b) = tokio::join!(
            create_one(&st, "alice", Some("key-simultaneous"), 2),
            create_one(&st, "alice", Some("key-simultaneous"), 2)
        );

        assert_eq!(fake.registers(), 0, "no account on the homeserver");
        assert_eq!(invitations(&pool).await, 1);
        assert!(
            [&a, &b].iter().any(|r| r.is_ok()),
            "at least one of the two must succeed, otherwise nothing is proven"
        );
        for e in [&a, &b].iter().filter_map(|r| r.as_ref().err()) {
            assert!(
                matches!(e, AppError::CreationInFlight),
                "the loser must learn its KEY is taken, not that its ceiling \
                 is reached: the second message would tell it to give up, and \
                 the token of the in-flight invitation would be lost — got: {e}"
            );
        }
    }

    /// **The ceiling is PER CALLER.** A global ceiling would look exactly the
    /// same on single-caller tests, while turning a chatty inviter into a
    /// denial of service for everyone else.
    #[sqlx::test(migrations = "./migrations")]
    async fn ceiling_is_per_caller_not_global(pool: SqlitePool) {
        let (st, fake) = mount(pool.clone(), 2).await;

        create_one(&st, "alice", Some("key-alice-1"), 2)
            .await
            .unwrap();
        assert!(
            matches!(
                create_one(&st, "alice", Some("key-alice-2"), 1).await,
                Err(AppError::CeilingReached { .. })
            ),
            "Alice is at her ceiling"
        );

        create_one(&st, "bob", Some("key-bob-1"), 2)
            .await
            .expect("Alice's ceiling must take nothing from Bob");
        assert_eq!(invitations(&pool).await, 2);
        assert_eq!(fake.registers(), 0);
    }

    /// **Created-but-unclaimed accounts survive their invitation; the ceiling
    /// must follow them.**
    ///
    /// Under the claim-time model, accounts appear when claims happen. A
    /// claim interrupted AFTER the registration leaves a `reserved` row whose
    /// account is real — and a localpart is never freed by the homeserver.
    /// When that invitation then dies (here: revoked), the charge must hold
    /// until the accounts are actually neutralised, otherwise a caller whose
    /// claims fail in a loop would see their charge return to zero at each
    /// failure while sowing definitive localparts: the fixed defect, by
    /// another path.
    ///
    /// The charge is only released once the accounts are really neutralised —
    /// what cleanup does, simulated here by the final update.
    #[sqlx::test(migrations = "./migrations")]
    async fn created_but_unclaimed_accounts_of_a_dead_invitation_still_charge_the_ceiling(
        pool: SqlitePool,
    ) {
        let (st, _fake) = mount(pool.clone(), 3).await;
        let inv = create_one(&st, "alice", Some("key-of-pool-1"), 3)
            .await
            .unwrap();

        // What an interrupted claim leaves behind: rows whose accounts exist
        // on the homeserver (their secrets are irrelevant to the ceiling).
        for i in 0..3 {
            sqlx::query(
                "INSERT INTO reserved_accounts (user_id, invitation_id, password_enc, \
                 access_token_enc, status, created_at) VALUES (?,?,X'00',X'00','reserved',0)",
            )
            .bind(format!("account-{i}"))
            .bind(&inv.invitation_id)
            .execute(&pool)
            .await
            .unwrap();
        }
        sqlx::query("UPDATE invitations SET status='revoked', revoked_at=0 WHERE id=?")
            .bind(&inv.invitation_id)
            .execute(&pool)
            .await
            .unwrap();

        assert!(
            matches!(
                create_one(&st, "alice", Some("key-of-pool-2"), 1).await,
                Err(AppError::CeilingReached { .. })
            ),
            "the three accounts still exist on the homeserver: the charge holds"
        );

        // What cleanup does: the accounts are really neutralised.
        sqlx::query("UPDATE reserved_accounts SET status='deactivated'")
            .execute(&pool)
            .await
            .unwrap();

        create_one(&st, "alice", Some("key-of-pool-3"), 3)
            .await
            .expect("once the accounts are neutralised, the charge is released");
    }

    /// **A trace row written ahead of the registration CHARGES the ceiling.**
    ///
    /// The choice is written in `PLACE_THE_POOL`; this test holds it. Two
    /// `claiming` rows on a dead invitation designate maybe two real accounts
    /// — that is the whole point of writing the trace before
    /// `register_dormant`. Not counting them would return the caller's charge
    /// to zero at every interrupted claim, reopening the overrun path the
    /// ceiling exists to close.
    ///
    /// CONTROL: the charge is released once the rows are terminated by
    /// cleanup — otherwise this test would also pass on a ceiling that never
    /// comes back down, which would doom the caller.
    #[sqlx::test(migrations = "./migrations")]
    async fn claiming_trace_rows_charge_the_ceiling(pool: SqlitePool) {
        let (st, fake) = mount(pool.clone(), 2).await;

        sqlx::query(
            "INSERT INTO invitations (id, inviter_user_id, token_sha256, created_at, \
             expires_at, max_uses, used_count, status) \
             VALUES ('dead','@alice:h',X'01',0,0,2,0,'revoked')",
        )
        .execute(&pool)
        .await
        .unwrap();
        for lp in ["traceone00000", "tracetwo00000"] {
            sqlx::query(
                "INSERT INTO reserved_accounts (user_id, invitation_id, password_enc, \
                 access_token_enc, status, created_at) VALUES (?,'dead',X'00',X'','claiming',0)",
            )
            .bind(lp)
            .execute(&pool)
            .await
            .unwrap();
        }

        assert!(
            matches!(
                create_one(&st, "alice", Some("key-of-pool-1"), 1).await,
                Err(AppError::CeilingReached { .. })
            ),
            "two trace rows designate maybe two real accounts: ignoring them \
             would zero Alice's charge at every interruption"
        );
        assert_eq!(fake.registers(), 0, "and the refusal creates nothing");

        sqlx::query("UPDATE reserved_accounts SET status='deactivated'")
            .execute(&pool)
            .await
            .unwrap();
        create_one(&st, "alice", Some("key-of-pool-2"), 2)
            .await
            .expect("once the traces are terminated, the charge is released");
    }

    /// **MANDATORY REGRESSION TEST — unbounded account creation must stay
    /// dead.**
    ///
    /// The defect happened twice: accounts created without bound, fixed on
    /// 6 August 2026, redeployed on 7 August. The identical replay — twenty
    /// `POST /invitations` through the REAL `create` handler, each promising
    /// the maximum number of places — must create EXACTLY ZERO accounts on
    /// the homeserver. The fake counts every `/v3/register` call; the
    /// before/after counts are printed so the proof is visible in the test
    /// output, not just in an assertion.
    ///
    /// This test stays in the suite permanently.
    #[sqlx::test(migrations = "./migrations")]
    async fn twenty_invitations_create_zero_accounts(pool: SqlitePool) {
        let (st, fake) = mount(pool.clone(), 1000).await;

        let before = fake.registers();
        println!("[regression] /v3/register calls BEFORE the 20 creations: {before}");

        for i in 1..=20u32 {
            create_one(&st, "alice", Some(&format!("key-defect-replay-{i}")), 10)
                .await
                .unwrap_or_else(|e| panic!("creation {i} must succeed: {e}"));
        }

        let after = fake.registers();
        println!("[regression] /v3/register calls AFTER  the 20 creations: {after}");

        assert_eq!(invitations(&pool).await, 20, "the 20 invitations exist");
        assert_eq!(
            after, 0,
            "the unbounded-account-creation defect, replayed identically: \
             creating 20 invitations must create EXACTLY ZERO Matrix accounts"
        );
        assert_eq!(
            accounts_in_db(&pool).await,
            0,
            "and no reserved_accounts row either"
        );
    }

    // -----------------------------------------------------------------------
    // THE ISSUANCE GATE (porteur's decision, 14 August 2026): the service
    // refuses to emit an invitation to an account that cannot honour it.
    // -----------------------------------------------------------------------

    /// **AN ACCOUNT NOBODY PROMOTED GETS NO LINK AT ALL.**
    ///
    /// This is the panic this lot would otherwise arm, by construction and for
    /// every unpromoted account: a room born of `create_conversation` requires
    /// 50 to invite, the account holds 0, so the link it would receive is
    /// perfectly VALID and perfectly dead — the invitee claims it, no Matrix
    /// invitation ever comes, and the claim ends after 300 seconds under
    /// `409 MESSAGR_NOT_YET_INVITED`, the failure already paid for in
    /// demonstration.
    ///
    /// The refusal must land before ANYTHING is written: no invitation row, no
    /// account on the homeserver, and both are asserted rather than assumed.
    #[sqlx::test(migrations = "./migrations")]
    async fn an_account_nobody_promoted_gets_no_link_at_all(pool: SqlitePool) {
        let (st, fake) = mount(pool.clone(), 100).await;
        fake.serve_state(200, a_room_born_of_this_lot("@maria:h"));

        let refusal = create_one_in(&st, "alice", Some("key-of-pool-1"), 1, "!newborn:h").await;
        assert!(
            matches!(
                refusal,
                Err(AppError::NotPromotedToInvite {
                    required: 50,
                    held: 0
                })
            ),
            "an account at 0 in a room that requires 50 must be refused, with both \
             numbers: {refusal:?}",
            refusal = refusal.map(|r| r.invitation_id)
        );
        assert_eq!(invitations(&pool).await, 0, "no invitation was laid down");
        assert_eq!(accounts_in_db(&pool).await, 0);
        assert_eq!(fake.registers(), 0, "and nothing on the homeserver");
        assert_eq!(
            fake.state_reads(),
            1,
            "the verdict must come from the ROOM, so the room must be read"
        );
    }

    /// **THE CREATOR OF THE ROOM SHE JUST MADE MAY EMIT INTO IT**, and this is
    /// the half a naive gate gets wrong.
    ///
    /// Production creates at room version 12, where the creator is privileged
    /// implicitly and MUST NOT appear in `users` — the live read returned
    /// `users: {}` from a freshly created room. A gate reading her level out of
    /// that map would put her at 0 against her own room's 50 and refuse her the
    /// first invitation into it, which is the entire gesture of this lot.
    #[sqlx::test(migrations = "./migrations")]
    async fn the_creator_of_a_newborn_room_may_emit_into_it(pool: SqlitePool) {
        let (st, fake) = mount(pool.clone(), 100).await;
        fake.serve_state(200, a_room_born_of_this_lot("@alice:h"));

        create_one_in(&st, "alice", Some("key-of-pool-1"), 1, "!newborn:h")
            .await
            .expect(
                "the creator of a version-12 room is above every number and absent from \
                 `users`: refusing her would refuse the lot's own gesture",
            );
        assert_eq!(invitations(&pool).await, 1);
        assert_eq!(fake.registers(), 0);
    }

    /// **THE ROOM BORN BEFORE THIS LOT KEEPS ITS INVITER, AND THE
    /// DEMONSTRATION KEEPS WORKING.**
    ///
    /// The demonstration room carries NO `invite` key — measured on production
    /// on 14 August 2026, as do both of the fixture account's other rooms —
    /// and the specification reads that absence as 0. Alice is not its creator
    /// and nobody ever promoted her; she may still emit, because the room says
    /// so. A gate comparing against a hardcoded 50 would pass every test above
    /// and break the only thing that currently works.
    #[sqlx::test(migrations = "./migrations")]
    async fn a_room_born_before_this_lot_still_lets_its_members_emit(pool: SqlitePool) {
        let (st, fake) = mount(pool.clone(), 100).await;
        // The scaffolding's default IS that room; named here so the test says
        // what it depends on rather than inheriting it silently.
        fake.serve_state(200, a_room_born_before_this_lot());

        let issued = create_one(&st, "alice", Some("key-of-pool-1"), 3)
            .await
            .expect(
                "in a room where inviting costs 0, an ordinary member may emit: the \
                 refusal must follow the ROOM, never a constant",
            );
        assert!(!issued.token.is_empty());
        assert_eq!(invitations(&pool).await, 1);
        assert_eq!(fake.registers(), 0);
    }

    /// **WHAT CANNOT BE READ IS REFUSED, LOUDLY, AND CREATES NOTHING.**
    ///
    /// Three silences, three answers, none of them a pass. The campaign
    /// measured on 14 August 2026 what the opposite costs: `revoke_invitation`
    /// turned a 404 into a success and left thirty-two live accounts the
    /// database believed dead.
    #[sqlx::test(migrations = "./migrations")]
    async fn a_room_whose_rights_cannot_be_read_refuses_and_creates_nothing(pool: SqlitePool) {
        let (st, fake) = mount(pool.clone(), 100).await;

        /// One silence: what it is, the status and body the homeserver serves,
        /// and the refusal this service must answer with.
        type Silence = (&'static str, u16, Value, fn(&AppError) -> bool);

        let cases: [Silence; 4] = [
            (
                "a room this account is not in",
                404,
                json!({"errcode": "M_NOT_FOUND"}),
                |e| matches!(e, AppError::RoomNotVisible),
            ),
            (
                "a room whose state this account may not read",
                403,
                json!({"errcode": "M_FORBIDDEN"}),
                |e| matches!(e, AppError::RoomNotVisible),
            ),
            ("a homeserver that is unwell", 502, json!({}), |e| {
                matches!(e, AppError::HomeserverUnavailable)
            }),
            (
                "a 200 that is not a room's state",
                200,
                json!([{"type": "m.room.power_levels", "state_key": "", "content": {}}]),
                |e| matches!(e, AppError::InviteRightUnreadable(_)),
            ),
        ];

        for (index, (what, status, body, expected)) in cases.into_iter().enumerate() {
            fake.serve_state(status, body);
            let refusal = create_one_in(
                &st,
                "alice",
                Some(&format!("key-of-pool-{index}")),
                1,
                "!unreadable:h",
            )
            .await;
            match &refusal {
                Err(e) => assert!(expected(e), "{what}: unexpected refusal {e}"),
                Ok(_) => panic!("{what}: MUST NOT produce an invitation"),
            }
        }
        assert_eq!(
            invitations(&pool).await,
            0,
            "not one of the four silences may leave an invitation behind"
        );
        assert_eq!(accounts_in_db(&pool).await, 0);
        assert_eq!(fake.registers(), 0);

        // CONTROL, inseparable: the scaffolding does create invitations once
        // the room answers, otherwise the zeroes above prove nothing.
        fake.serve_state(200, a_room_born_before_this_lot());
        create_one(&st, "alice", Some("key-of-pool-ok"), 1)
            .await
            .unwrap();
        assert_eq!(invitations(&pool).await, 1);
    }

    /// **A REPLAY STILL RETURNS THE INVITATION AFTER A DEMOTION**, and this is
    /// the same defect the ceiling already paid for, in a new place.
    ///
    /// The token exists nowhere but `token_enc`, readable only by the replay:
    /// `token_sha256` does not give it back. A gate placed so that a refusal
    /// short-circuits the replay would take an ALREADY-EMITTED invitation's
    /// token away from the caller whose HTTP stack merely re-sent the request —
    /// while leaving that invitation charged against its ceiling, unusable and
    /// unrevocable by anyone who does not know its id.
    ///
    /// A replay CREATES NOTHING, so it has no business being under a rule about
    /// what may be created. The gate rides in the same statement as the ceiling
    /// and for the same reason: the `EXISTS` clause produces the candidate row
    /// whatever the gate says, and the unique index arbitrates.
    #[sqlx::test(migrations = "./migrations")]
    async fn a_replay_still_returns_the_invitation_after_a_demotion(pool: SqlitePool) {
        let (st, fake) = mount(pool.clone(), 100).await;

        let first = create_one(&st, "alice", Some("key-of-pool-1"), 2)
            .await
            .expect("emitted while the room permitted it");

        // The room now demands 50 and Alice is not its creator: exactly what a
        // demotion, or a room whose rights were tightened, looks like.
        fake.serve_state(200, a_room_born_of_this_lot("@maria:h"));

        let replayed = create_one(&st, "alice", Some("key-of-pool-1"), 2)
            .await
            .expect("a replay creates nothing, so no creation rule may arbitrate it");
        assert_eq!(replayed.invitation_id, first.invitation_id);
        assert_eq!(
            replayed.token, first.token,
            "the token exists nowhere else: a caller deprived of it keeps a charged, \
             unusable promise"
        );
        assert_eq!(invitations(&pool).await, 1);

        // CONTROL: the gate has NOT been disarmed by any of this. A new key
        // from the same caller, in the same room, stays refused.
        assert!(
            matches!(
                create_one(&st, "alice", Some("key-of-pool-2"), 1).await,
                Err(AppError::NotPromotedToInvite { .. })
            ),
            "a new key is a CREATION, and the gate applies to creations"
        );
        assert_eq!(invitations(&pool).await, 1);
        assert_eq!(fake.registers(), 0);
    }

    /// **THE GATE AND THE CEILING BOTH PRODUCE ZERO ROWS, AND EACH MUST SAY
    /// ITS OWN NAME.**
    ///
    /// They share one SQL statement, so a refusal reads the same to the
    /// database either way. The two repairs are opposite — one is "get
    /// promoted", the other is "revoke an invitation or raise a setting" — and
    /// a service that answered the wrong one would send a person to do
    /// something that cannot help.
    #[sqlx::test(migrations = "./migrations")]
    async fn the_gate_and_the_ceiling_do_not_answer_for_each_other(pool: SqlitePool) {
        let (st, fake) = mount(pool.clone(), 2).await;

        // Room permitting, ceiling reached: the CEILING answers.
        create_one(&st, "alice", Some("key-of-pool-1"), 2)
            .await
            .unwrap();
        assert!(
            matches!(
                create_one(&st, "alice", Some("key-of-pool-2"), 1).await,
                Err(AppError::CeilingReached { .. })
            ),
            "with the room permitting, a full ceiling must name the ceiling"
        );

        // Room refusing, ceiling wide open: the GATE answers.
        let (st, fake2) = mount(pool.clone(), 100).await;
        fake2.serve_state(200, a_room_born_of_this_lot("@maria:h"));
        assert!(
            matches!(
                create_one_in(&st, "bob", Some("key-of-pool-3"), 1, "!newborn:h").await,
                Err(AppError::NotPromotedToInvite { .. })
            ),
            "with the ceiling wide open, a room that refuses must name the room"
        );
        assert_eq!(fake.registers(), 0);
        assert_eq!(fake2.registers(), 0);
    }

    /// **The migration applies to the database ALREADY IN SERVICE.**
    ///
    /// Invitations created before it have no key, and there are several per
    /// inviter on hermes. The unique index must not make them conflict —
    /// otherwise the migration fails at startup and the deployed service does
    /// not come back up. The property hinges on the column accepting NULL and
    /// on SQLite treating two NULLs as distinct; a `NOT NULL DEFAULT ''`
    /// column would break exactly that.
    #[sqlx::test(migrations = "./migrations")]
    async fn the_migration_lets_prior_invitations_coexist(pool: SqlitePool) {
        // The shape from BEFORE the migration: the same inviter, no key.
        for id in ["old-1", "old-2"] {
            sqlx::query(
                "INSERT INTO invitations (id, inviter_user_id, token_sha256, created_at, \
                 expires_at, max_uses, used_count, status) VALUES (?,'@alice:h',?,0,9999,1,0,'pending')",
            )
            .bind(id)
            .bind(crypto::token_hash(id))
            .execute(&pool)
            .await
            .expect("two invitations without a key, same inviter: no conflict expected");
        }
        assert_eq!(invitations(&pool).await, 2);

        // Control: the constraint does bite where expected, otherwise the
        // test above would also pass with no index at all.
        for (id, expected_ok) in [("new-1", true), ("new-2", false)] {
            let r = sqlx::query(
                "INSERT INTO invitations (id, inviter_user_id, token_sha256, created_at, \
                 expires_at, max_uses, used_count, status, idempotency_key) \
                 VALUES (?,'@alice:h',?,0,9999,1,0,'pending','the-same-key')",
            )
            .bind(id)
            .bind(crypto::token_hash(id))
            .execute(&pool)
            .await;
            assert_eq!(
                r.is_ok(),
                expected_ok,
                "insertion {id}: the (inviter, key) pair must be unique"
            );
            if let Err(e) = r {
                assert!(
                    is_unique_conflict(&e),
                    "the conflict must be recognised as such"
                );
            }
        }
    }
}
