use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};

#[derive(Debug, thiserror::Error)]
// THREE VARIANTS HERE BELONG TO A HALF THIS SERVICE NO LONGER SERVES.
//
// `InvalidUsageToken`, `ClaimNotFound` and `DiscoveryQuotaReached` are
// raised only by the private-discovery handlers, which were deliberately
// left behind when this service was internalised: nothing in the current
// slice exercises them, and internalising an unexercised cryptographic
// component is how a dependency breaks silently.
//
// They are kept rather than deleted, and the choice is deliberate. Issue #38
// brings discovery back the moment a slice needs it, and these variants
// carry documentation -- what each refusal does and does not disclose --
// that is worth more preserved than rewritten from memory. `dead_code` is
// allowed with that reason attached, so the warning does not have to be
// re-explained by whoever meets it next.
//
// What would mislead is silence: a reader finding no construction site for
// `DiscoveryQuotaReached` and no explanation would reasonably conclude the
// enum had rotted.
#[allow(dead_code)]
pub enum AppError {
    /// THE SILENT RESPONSE — and its imprecision is the function, not a
    /// leftover.
    ///
    /// It serves everywhere the service wants to say NOTHING about what it is
    /// presented with: a token no invitation carries (`claim`), an invitation
    /// belonging to another inviter (`revoke`, "do not reveal the existence"),
    /// an invitation status this code does not know. Its message lists the
    /// causes without choosing any of them, and that is precisely what keeps
    /// it from being an oracle.
    ///
    /// NEVER narrow it to "unknown token", even now that expiration and
    /// revocation have their own variants: the service would become a probing
    /// instrument, where anyone presenting a value learns whether it ever
    /// existed. The full reasoning — and why it does NOT apply to the two
    /// variants below — is written at the top of
    /// `handlers::claim::invitation_usable`.
    #[error("invitation not found, expired or revoked")]
    InvitationInvalid,
    /// The validity date has passed. Two paths lead here, one single meaning:
    /// `status='expired'`, set by `cleanup::expire_invitations`, and
    /// `status='pending'` with `expires_at` already past — the invitation that
    /// expired since the sweep last ran. The second case is anything but
    /// theoretical: the sweep runs periodically, the clock never stops.
    ///
    /// TERMINAL FOR THIS TOKEN, but not for the relationship: nobody took
    /// anything back, too much time has simply elapsed. The course of action
    /// is to ask for a new one — and that is what separates it from
    /// `InvitationRevoked`, with which it had shared an indistinct response
    /// until now.
    #[error(
        "this invitation has expired: its validity period has run out. This token will never \
         become valid again, but no one has withdrawn it — ask the person who invited you for \
         a new one"
    )]
    InvitationExpired,
    /// The inviter took their invitation back (`handlers::revoke`), which
    /// deactivated the pool's reserved accounts: there is nothing left to hand
    /// out.
    ///
    /// FINAL, and that is the whole difference with `InvitationExpired`: this
    /// is not an elapsed deadline, it is a DECISION, made by a person, beyond
    /// the protocol's reach. No retry will change anything, and a client must
    /// above all not invite the user to "ask again" as if the clock were at
    /// fault.
    ///
    /// A pool whose CREATION failed midway also carries `status='revoked'`
    /// (see `handlers::create`, which uses it so the cleanup picks up the
    /// accounts already created). That token was never handed back to the
    /// caller — the creation exited in error before answering — so no claim
    /// can reach it, and that case does not make this message false: the
    /// invitation was indeed withdrawn, on the service side.
    #[error(
        "this invitation has been revoked by the person who issued it: this is not an elapsed \
         deadline but a decision, and no retry will change anything. Only that person can issue \
         a new one"
    )]
    InvitationRevoked,
    #[error("all uses of this invitation have been consumed")]
    UsesExhausted,
    #[error("unauthenticated caller")]
    Unauthenticated,
    #[error("homeserver unavailable")]
    HomeserverUnavailable,
    #[error("invalid request: {0}")]
    InvalidRequest(String),
    /// A usage token presented to `POST /discovery/evaluate` (task 5) or
    /// to any of `PUT`/`GET`/`DELETE /discovery/:index_key`
    /// (`handlers::discovery`, task 6) could not be redeemed. THREE
    /// causes collapse into this ONE variant, on purpose:
    /// `verify_usage_token` (`handlers::discovery_tokens`,
    /// task 4) failed (malformed, or one this service never issued); the
    /// token's own signed timestamp is outside its redemption window
    /// (`discovery_tokens::within_usage_window` -- moved here from
    /// `discovery_evaluate`, task 6's own second review, once a second
    /// file needed it too); or its tag is already present in
    /// `discovery_usage_spent` (migration `006_rachat_jeton.sql`) -- a
    /// genuine token, already redeemed once, at `/discovery/evaluate` OR
    /// at `PUT /discovery/:index_key`, the two spenders sharing that one
    /// table and that one tag. Telling a caller which of the three
    /// applies would hand an attacker probing a stolen token exactly the
    /// calibration this service's whole job is to refuse identically.
    ///
    /// CORRECTED, review round 4: the paragraph that used to stand
    /// here said an already-spent token "fails the FIRST cause's
    /// HMAC/shape check... exactly like any other malformed one... so
    /// the collapse holds for all four routes alike". FALSE, and it
    /// contradicted this file's OWN paragraph immediately above it,
    /// unchanged and correct: `GET`/`DELETE` verify WITHOUT spending
    /// (`handlers::discovery`'s own module header, "WHY PUT SPENDS AND
    /// GET/DELETE DO NOT"). Spending a token
    /// (`discovery_tokens::spend_usage_token`) inserts a row into
    /// `discovery_usage_spent`; it never touches the token's own HMAC or
    /// shape at all. `verify_usage_token_within_window`, which
    /// `GET`/`DELETE` call, never queries that table -- so an
    /// ALREADY-SPENT token is ACCEPTED by `GET`/`DELETE`, exactly like a
    /// fresh one, indistinguishable from it. Only `PUT`
    /// (`verify_and_spend_usage_token`) and `/discovery/evaluate`
    /// (`evaluate_route`'s own separate call) ever query
    /// `discovery_usage_spent`, so only those two routes can ever hit
    /// the third cause, and an already-spent token IS refused by both.
    /// The one variant still covers all four routes, but not because
    /// the three causes apply identically to each -- they do not, and
    /// `GET`/`DELETE` structurally cannot hit the third one -- it is
    /// that no route, for whichever of the three CAN apply to it, ever
    /// discloses which one did.
    #[error(
        "the usage token could not be redeemed: it was not issued by this service, is no \
         longer within its redemption window, or has already been used. No evaluation is \
         performed, and nothing about the presented point is revealed either way"
    )]
    InvalidUsageToken,
    /// `DELETE /discovery/:index_key` (`handlers::discovery::withdraw_route`,
    /// task 6) matched no row for the presented `claim_secret`: the secret
    /// is simply wrong, or the claim it names has already been withdrawn.
    ///
    /// NEVER FOLDED INTO A SILENT SUCCESS. Spec 4.2's own withdrawal
    /// paragraph and the task's own brief both say it plainly: "un secret
    /// faux ne trouve aucune ligne et rend une erreur, jamais un succes
    /// silencieux" -- a wrong secret finds no row and returns an error,
    /// never a silent success. `rows_affected() == 0` is what this maps
    /// from; see `withdraw_route`'s own doc comment for the query.
    ///
    /// Distinct from `InvitationInvalid`: that variant exists to keep this
    /// service from being an oracle over WHO an invitation belongs to. No
    /// equivalent secret is being protected here -- the caller already
    /// holds both `index_key` and `claim_secret` it is asserting authorship
    /// over, and telling it "that pair matches nothing live" reveals
    /// nothing it did not already have the standing to ask the service
    /// directly (a second `GET` on the same index would show the same
    /// claims either way, since `GET` proves nothing about ownership at
    /// all -- see spec 4.5).
    #[error("no claim under this index matches the presented secret: nothing was withdrawn")]
    ClaimNotFound,
    /// `POST /discovery/tokens` refused: the resolved account's
    /// `discovery_quota.charged_in_window`, plus this request's own
    /// `count`, would exceed `Config::discovery_quota_ceiling` for the
    /// window it is in. Raised by
    /// `handlers::discovery_tokens::record_charge`, from inside the write
    /// that would have charged, never from a check taken beforehand.
    ///
    /// Added at this lot's whole-branch review (Critical 1): before this
    /// variant existed, nothing in production ever read the account's
    /// running total back, so one authenticated account could mint usage
    /// tokens without limit -- see `discovery_tokens.rs`'s own header,
    /// "THE CUMULATIVE CEILING" section, for the fuller account.
    ///
    /// WHOLE AND EXPLICIT REFUSAL, the same contract `CeilingReached`
    /// already keeps for the invitation side of this service: never a
    /// partial mint, never a 2xx response for fewer tokens than `count`
    /// asked for. The refusal happens inside `record_charge`'s own bounded
    /// write, which is why nothing is charged: the statement that would
    /// have charged is the statement that refused. Minting runs before it
    /// but persists nothing, so a refused request leaves no trace at all.
    ///
    /// ADDRESSED TO THE CLIENT, NOT THE OPERATOR. An earlier version of
    /// this message ended "Raise MAX_DISCOVERY_QUOTA_PER_ACCOUNT if this
    /// account is legitimate", which is an instruction only someone with
    /// shell access on this service can act on, delivered to a phone.
    /// `retry_after_secs` is what the caller can actually use.
    #[error(
        "discovery quota reached: this account has been charged {charged} usage tokens in \
         the current window and may not exceed {ceiling}; this request asks for {requested} \
         more. The current window has {retry_after_secs} seconds left"
    )]
    DiscoveryQuotaReached {
        charged: i64,
        ceiling: i64,
        requested: usize,
        retry_after_secs: i64,
    },
    // TOMBSTONE, NOT A DOC COMMENT -- CORRECTED, whole-branch review of lot
    // 14: this paragraph used to be `///`, which made it rustdoc for
    // `ReservedAccountUnusable` immediately below, an invitation variant
    // this paragraph has nothing to do with. `//` here, permanently: the
    // paragraph is historical context for a REMOVED variant, not
    // documentation of the next one.
    //
    // `PUT /discovery/:index_key` (`handlers::discovery::deposit_route`)
    // USED TO be able to collide on `discovery_claims`'s own
    // `(index_key, claim_id)` primary key against a claim that was
    // STILL LIVE, and this variant is what a caller saw. REMOVED,
    // second review of lot 14's task 7, not merely renamed: a collision
    // on `claim_id = SHA-256(claim_secret)` (spec 4.2) can only ever be
    // produced by the party that already holds the matching
    // `claim_secret` -- nobody else can find a SHA-256 preimage of a
    // value already on disk -- so a collision is always the original
    // depositor renewing their own claim, never a genuine conflict with
    // anyone else's. `handlers::discovery::insert_claim` (its own doc
    // comment carries the fuller account) now renews on ANY collision,
    // live or expired, and this variant has no remaining case to name.
    // The variant this whole comment used to defend -- refusing a
    // legitimate renewal so a depositor would not "believe a second
    // write took effect when it did not" -- turned out to have the
    // wrong villain: nothing here was ever forging a collision; the
    // gate was refusing the one caller who could ever produce one.
    /// The reserved account drawn from the pool was unusable and has just been
    /// removed from it: retrying will draw a healthy one. Same client contract
    /// as `HomeserverUnavailable` (§10.5) — the token stays valid, no use has
    /// been consumed, the caller retries.
    #[error("reserved account unusable, retry")]
    ReservedAccountUnusable,
    /// The service invitation is valid; the reserved account associated with
    /// it simply does NOT YET have a pending Matrix room — the normal state of
    /// a freshly created account (§7): the account is created at claim time
    /// (lot 0, task 0.2), the Matrix invitation is issued by the inviter's
    /// client, with its own rights. This is a WAIT, not a give-up: never
    /// confuse it with `InvitationInvalid` (which is terminal), nor with
    /// `ReservedAccountUnusable` (whose contract suggests that ANOTHER account
    /// would fix the problem — here it is the SAME account, intact, that will
    /// become usable).
    #[error("invitation valid, but no pending room for this reserved account: retry shortly")]
    NoPendingRoom,
    /// The homeserver REFUSED the Matrix invitation, and the target has no
    /// place in the room. By far the most frequent cause: the room requires a
    /// power level the reserved account does not have, so no account from this
    /// pool will ever be able to invite there.
    ///
    /// This case is BOUNDED AND REPAIRABLE — the reserved account is intact,
    /// it stays in the pool, and everything succeeds as soon as the room's
    /// rights are corrected — but it would be SILENT without this message. The
    /// service does not log its requests (known limitation), and an operator
    /// who sees an invitation return 503 in a loop under the errcode of an
    /// upstream outage concludes the service is broken, when the repair is on
    /// their side and fits in one setting. Hence an `errcode` distinct from
    /// `MESSAGR_UPSTREAM` and a message that says what to do: one line here
    /// saves a day of investigation in the wrong direction.
    #[error("the reserved account could not invite this person into the room: the homeserver refused, although it is responding normally. Most likely cause: the room does not allow its ordinary members to invite — check the power levels (m.room.power_levels, \"invite\" key) of the room concerned. The reserved account is intact and the invitation remains usable: it will succeed as soon as this is fixed, without having to issue a new one")]
    // ⚠ NOTHING RAISES THIS ANY MORE, SINCE 25 AUGUST 2026, and the variant is
    // kept rather than deleted so that this sentence exists where a reader
    // looks for it.
    //
    // It was raised when the reserved account's Matrix invite was refused 403,
    // and its whole premise was that an operator could fix the room's rights.
    // That premise was false: a room created by this product sets
    // `m.room.power_levels`'s "invite" to 50 and admits members at 0,
    // deliberately, so the refusal is the DESIGNED state and there is no right
    // to repair. `handlers::claim::hand_over_place` now names the target to
    // the inviter's client -- which created the room, holds 100, and already
    // invites every newcomer -- and answers the 409 wait contract instead.
    //
    // The `errcode` stays reserved: a client that still matches on
    // `MESSAGR_INVITE_REFUSED` gets nothing, which is correct, and removing
    // the name would let a future variant reuse it for something else.
    MatrixInviteRefused,
    /// The caller already holds as many reserved accounts as its ceiling
    /// allows. WHOLE and explicit REFUSAL: never a pool trimmed to the
    /// available requested size, never a 2xx response that would deliver fewer
    /// accounts than `max_uses`. The caller must be able to take its answer as
    /// exact or as a refusal, with no third state.
    #[error(
        "ceiling reached: a caller may not hold more than {ceiling} reserved accounts at a \
         time, and this request asks for {requested} more. Revoke an ongoing invitation, wait \
         for it to expire, or raise MAX_RESERVED_ACCOUNTS_PER_INVITER"
    )]
    CeilingReached { ceiling: i64, requested: u32 },
    /// This idempotency key is already taken, but the pool it designates is
    /// not complete yet — concurrent creation in flight, or an earlier attempt
    /// interrupted.
    ///
    /// Neither a success nor a creation: returning the PARTIAL pool would be a
    /// truncated pool, and creating a new one would be exactly the duplicate
    /// being fixed. The caller retries with the SAME key — the replay will
    /// succeed as soon as the pool is complete, and will stay a refusal if the
    /// initial attempt is dead, in which case only a fresh key starts a new
    /// pool. The message says both, failing which a client retrying in a loop
    /// would never get out of it.
    #[error(
        "a creation is already in progress for this idempotency key, or the previous one did \
         not complete: retry with the SAME key; if the refusal persists, the initial attempt \
         failed and a fresh key must be provided"
    )]
    CreationInFlight,
    /// **THE ISSUANCE GATE'S REFUSAL** (porteur's decision, 14 August 2026):
    /// the account asking for an invitation holds, in the room that invitation
    /// names, less than the level that room requires to invite.
    ///
    /// Refusing now is the whole point. The alternative was measured: the
    /// account gets a perfectly VALID link it is incapable of honouring, the
    /// invitee claims it, no Matrix invitation ever comes, and the claim ends
    /// after 300 seconds of waiting under `409 MESSAGR_NOT_YET_INVITED` —
    /// `AppError::NoPendingRoom`, already paid for in demonstration. A refusal
    /// the emitter can read beats a link that dies in someone else's hands.
    ///
    /// BOTH LEVELS TRAVEL. `required` is the room's own — never a constant:
    /// rooms born before this lot carry no `invite` key, hence 0, and every
    /// member may still invite in them. Without the two numbers, an operator
    /// cannot tell a room that raised its floor from an account that was never
    /// promoted.
    #[error(
        "this account may not invite into that room: inviting there requires power level \
         {required} and this account holds {held}. Nothing is wrong with the request — the \
         account has not been promoted in that room, and only someone who already holds the \
         level can promote it. No invitation was created"
    )]
    NotPromotedToInvite { required: i64, held: i64 },
    /// The homeserver answered, and its answer is that this account may not see
    /// that room's state — an unknown room, or one it is not in.
    ///
    /// 403 and not 404: the silent 404 belongs to invitations, where saying
    /// nothing is the function (`InvitationInvalid`). Here there is no oracle
    /// to protect — the caller holds a Matrix token and can put the very same
    /// question to the homeserver itself — and a silent answer would leave a
    /// caller that mistyped its own room with nothing to go on.
    #[error(
        "the room named by room_id cannot be read with this account's token: either it does \
         not exist, or this account is not in it. No invitation was created"
    )]
    RoomNotVisible,
    /// The room's state came back and this service could not conclude from it.
    ///
    /// **A REFUSAL, NEVER A PASS.** The campaign measured on 14 August 2026
    /// what the opposite costs: `revoke_invitation` turned a 404 into a
    /// success and left thirty-two live accounts the database believed dead. A
    /// service that cannot read a power must say so and stop.
    ///
    /// The reason is a `&'static str` and not a `String` BY TYPE: everything
    /// that can reach this variant is written in this repository, so no text
    /// from the homeserver can travel in it — the discipline `INTERNAL_MESSAGE`
    /// enforces for `Internal`, here made impossible to break.
    #[error(
        "the invite rights of that room could not be established ({0}), so this service \
         refuses rather than issue a link it cannot tell you is honourable. The room is \
         intact and no invitation was created: retry, and if it persists, report this text"
    )]
    InviteRightUnreadable(&'static str),
    #[error(transparent)]
    Internal(#[from] anyhow::Error),
}

/// Generic message returned to the caller for any internal error.
///
/// `Internal` is `#[error(transparent)]`: its `Display` is that of the wrapped
/// error — SQLite error text, file path, message from a third-party component.
/// `POST /invitations/claim` NOT being authenticated, returning that text as-is
/// hands it to any anonymous caller. The detail goes into the logs, never into
/// the response body.
const INTERNAL_MESSAGE: &str = "internal error";

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (code, errcode) = match &self {
            AppError::InvitationInvalid => (StatusCode::NOT_FOUND, "M_NOT_FOUND"),
            // 410 like `UsesExhausted`, and for the same reason: the invitation
            // EXISTED, it reached its end. Two 410s under two distinct
            // `errcode`s is the usual pattern of this file (three 503s already
            // coexist here) — the status says the class, the `errcode` says the
            // case.
            //
            // Above all NOT 404: it would fall back into the silent response
            // and undo this whole fix. Not 403 either, which is reserved below
            // for what stems from a DECISION.
            AppError::InvitationExpired => (StatusCode::GONE, "MESSAGR_INVITATION_EXPIRED"),
            // 403 and not 410, because the course of action is not the same and
            // the status must already carry it, even before the `errcode` is
            // read.
            //
            // The vocabulary is set within this very file: "a 403 would say
            // 'never', and a well-behaved client would stop" — the reason
            // `CeilingReached` refrains from it, the condition not being
            // permanent there. Here it is exactly what we mean. Expiration can
            // be re-requested; revocation is a decision made by a person, final
            // from the service's point of view, and the token bearer has
            // nothing to retry.
            AppError::InvitationRevoked => (StatusCode::FORBIDDEN, "MESSAGR_INVITATION_REVOKED"),
            AppError::UsesExhausted => (StatusCode::GONE, "MESSAGR_USES_EXHAUSTED"),
            AppError::Unauthenticated => (StatusCode::UNAUTHORIZED, "M_UNAUTHORIZED"),
            // 503 and not 500: the caller must RETRY, not give up (§10.5).
            AppError::HomeserverUnavailable => {
                (StatusCode::SERVICE_UNAVAILABLE, "MESSAGR_UPSTREAM")
            }
            AppError::InvalidRequest(_) => (StatusCode::BAD_REQUEST, "M_INVALID_PARAM"),
            // 400 like its neighbour immediately above, and for the same
            // reason: the caller's OWN next move is identical either way
            // (get a real usage token from `POST /discovery/tokens` and
            // retry) and distinguishing the status would say nothing a
            // client could act on differently. The errcode still stays
            // distinct, so a caller inspecting the body -- rather than
            // just the status -- can tell the two credentials apart.
            AppError::InvalidUsageToken => (StatusCode::BAD_REQUEST, "MESSAGR_INVALID_USAGE_TOKEN"),
            // 404, the same class `InvitationInvalid` uses for "nothing
            // matches" -- see the variant's own doc comment for why no
            // oracle concern applies here the way it does there, so this
            // stays a distinct errcode rather than reusing M_NOT_FOUND.
            AppError::ClaimNotFound => (StatusCode::NOT_FOUND, "MESSAGR_CLAIM_NOT_FOUND"),
            // 429, the same status and reasoning `CeilingReached` already
            // uses below for the invitation side, and by that variant's own
            // standard: this is a volume ceiling, not a decision about the
            // caller's rights, and it lifts BY ITSELF when the account's
            // thirty-day window rolls over -- no operator, no setting, no
            // intervention. A 403 would say "never", which is not what this
            // means.
            //
            // IT DID MEAN "NEVER" BRIEFLY. While the ceiling was a lifetime
            // total, this comment justified the 429 by saying the condition
            // lifted "as soon as MAX_DISCOVERY_QUOTA_PER_ACCOUNT is raised",
            // which is an operator editing a file and restarting a service:
            // exactly the permanent-until-someone-intervenes case the
            // paragraph below reserves 403 for. The window is what made the
            // 429 true, not the wording. Its own `errcode`, distinct from
            // `MESSAGR_INVITER_QUOTA`:
            // the two ceilings guard unrelated resources (reserved
            // accounts vs. discovery usage tokens), and a client must be
            // able to tell which one it hit from the body alone.
            AppError::DiscoveryQuotaReached { .. } => {
                (StatusCode::TOO_MANY_REQUESTS, "MESSAGR_DISCOVERY_QUOTA")
            }
            AppError::ReservedAccountUnusable => (StatusCode::SERVICE_UNAVAILABLE, "MESSAGR_RETRY"),
            // 409 and not 404/503: the invitation itself is in no way invalid
            // (so not InvitationInvalid) and this is not an account to throw
            // away (so not ReservedAccountUnusable) — the current state of the
            // associated Matrix room is simply in conflict with the requested
            // claim, and resolves by itself as soon as the inviter has issued
            // their invitation (§7, §10.5).
            AppError::NoPendingRoom => (StatusCode::CONFLICT, "MESSAGR_NOT_YET_INVITED"),
            // 503 like `HomeserverUnavailable` — the caller should indeed
            // retry, and it will succeed — but UNDER ANOTHER `errcode`: the
            // repair is not to wait for the stack to come back, it is to go
            // change a right in the room. Reusing `MESSAGR_UPSTREAM` would send
            // the operator chasing an outage that does not exist.
            AppError::MatrixInviteRefused => {
                (StatusCode::SERVICE_UNAVAILABLE, "MESSAGR_INVITE_REFUSED")
            }
            // 429 and not 403: the condition is not permanent and does not
            // depend on the caller's rights — it lifts by itself as soon as an
            // ongoing invitation is claimed, expired or revoked. A 403 would
            // say "never", and a well-behaved client would stop.
            AppError::CeilingReached { .. } => {
                (StatusCode::TOO_MANY_REQUESTS, "MESSAGR_INVITER_QUOTA")
            }
            // 409: conflict on the idempotency key, distinct from the ceiling
            // (429, which is about volume) and from `HomeserverUnavailable`
            // (503, which is about the upstream).
            AppError::CreationInFlight => (StatusCode::CONFLICT, "MESSAGR_CREATION_IN_FLIGHT"),
            // 403, and the reasoning is this file's own, applied in the
            // direction it was written for: "a 403 would say 'never', and a
            // well-behaved client would stop" is why `CeilingReached` refrains
            // from it — its condition lifts by itself. This one does not. It
            // lifts by a PROMOTION, which is another person's gesture, and a
            // client that keeps retrying would only emit requests nobody can
            // answer. Not 429 (nothing to wait for), not 503 (the stack is
            // fine), not 404 (the request is intelligible and named).
            AppError::NotPromotedToInvite { .. } => (StatusCode::FORBIDDEN, "MESSAGR_NOT_PROMOTED"),
            AppError::RoomNotVisible => (StatusCode::FORBIDDEN, "MESSAGR_ROOM_NOT_VISIBLE"),
            // 503 like its two neighbours — the caller should retry — but
            // under its OWN errcode: the repair is neither "wait for the stack"
            // (`MESSAGR_UPSTREAM`) nor "change a right in the room"
            // (`MESSAGR_INVITE_REFUSED`). It is "this state could not be read",
            // and the message carries which part of it.
            AppError::InviteRightUnreadable(_) => {
                (StatusCode::SERVICE_UNAVAILABLE, "MESSAGR_ROOM_UNREADABLE")
            }
            AppError::Internal(_) => (StatusCode::INTERNAL_SERVER_ERROR, "M_UNKNOWN"),
        };
        let message = match &self {
            AppError::Internal(e) => {
                tracing::error!("internal error: {e:#}");
                INTERNAL_MESSAGE.to_string()
            }
            // The other variants carry a text written for the caller.
            other => other.to_string(),
        };
        (
            code,
            Json(serde_json::json!({"errcode": errcode, "error": message})),
        )
            .into_response()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The returned body must never repeat the wrapped error's text. On the
    /// pre-fix code, `self.to_string()` on an `Internal` went through
    /// `#[error(transparent)]` and returned that text word for word to an
    /// anonymous caller.
    #[tokio::test]
    async fn an_internal_error_does_not_leak_the_technical_detail() {
        let detail = "no such table: reserved_accounts (/var/lib/messagr/invitations.db)";
        let r = AppError::Internal(anyhow::anyhow!("{detail}")).into_response();
        assert_eq!(r.status(), StatusCode::INTERNAL_SERVER_ERROR);

        let raw = axum::body::to_bytes(r.into_body(), usize::MAX)
            .await
            .unwrap();
        // The property, tested on the WHOLE body and not on a single field:
        // nothing of the wrapped text comes out of it, wherever it may have
        // slipped in.
        let rendered = String::from_utf8_lossy(&raw);
        assert!(
            !rendered.contains("no such table") && !rendered.contains("/var/lib"),
            "the technical detail must never reach the caller: {rendered}"
        );

        let body: serde_json::Value = serde_json::from_slice(&raw).unwrap();
        assert_eq!(body["errcode"], "M_UNKNOWN");
        assert_eq!(body["error"], INTERNAL_MESSAGE);
    }

    /// Control: the variants written FOR the caller keep their message,
    /// without which the fix above could have flattened everything.
    #[tokio::test]
    async fn business_errors_keep_their_message() {
        let r =
            AppError::InvalidRequest("max_uses must be between 1 and 10".into()).into_response();
        assert_eq!(r.status(), StatusCode::BAD_REQUEST);
        let body = axum::body::to_bytes(r.into_body(), usize::MAX)
            .await
            .unwrap();
        let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(
            body["error"],
            "invalid request: max_uses must be between 1 and 10"
        );
    }

    /// **Expired and revoked share NOTHING any more** — neither status, nor
    /// `errcode`, nor message — and neither of them falls back to the silent
    /// response.
    ///
    /// This is the fix itself: both used to arrive under 404 `M_NOT_FOUND`
    /// with a text that listed the causes without choosing any, and the client
    /// could therefore assert neither one nor the other.
    ///
    /// The status already carries the course of action, even before the
    /// `errcode`: 410 for what has run out and can be re-requested, 403 for
    /// what has been decided and cannot be retried.
    #[tokio::test]
    async fn expired_and_revoked_share_neither_status_nor_errcode_nor_message() {
        let (status_e, body_e) = render(AppError::InvitationExpired).await;
        let (status_r, body_r) = render(AppError::InvitationRevoked).await;

        assert_eq!(status_e, StatusCode::GONE);
        assert_eq!(body_e["errcode"], "MESSAGR_INVITATION_EXPIRED");
        assert_eq!(status_r, StatusCode::FORBIDDEN);
        assert_eq!(body_r["errcode"], "MESSAGR_INVITATION_REVOKED");

        // The heart of the fix: nothing confuses them, and nothing brings them
        // back to the previous silent response.
        assert_ne!(status_e, status_r);
        assert_ne!(body_e["errcode"], body_r["errcode"]);
        assert_ne!(body_e["error"], body_r["error"]);
        for (name, status, body) in [
            ("expired", status_e, &body_e),
            ("revoked", status_r, &body_r),
        ] {
            assert_ne!(status, StatusCode::NOT_FOUND, "{name}");
            assert_ne!(body["errcode"], "M_NOT_FOUND", "{name}");
            // Nor with the same-status neighbour: `UsesExhausted` is also a
            // 410, and it is a third screen, not the same one.
            assert_ne!(body["errcode"], "MESSAGR_USES_EXHAUSTED", "{name}");
        }

        // And each message must say WHAT TO DO, without which a proper
        // `errcode` laid over a vague text would be useless. Expiration sends
        // the user to ask again; revocation says it is a decision, and
        // carefully refrains from inviting a retry.
        let expired = body_e["error"].as_str().unwrap();
        assert!(
            expired.contains("expired") && expired.contains("for a new one"),
            "expiration must name its cause and its recovery path: {expired}"
        );
        let revoked = body_r["error"].as_str().unwrap();
        assert!(
            revoked.contains("revoked") && revoked.contains("decision"),
            "revocation must call itself a decision, not a deadline: {revoked}"
        );
        assert!(
            !revoked.contains("retr") || revoked.contains("no retry"),
            "a revocation must never invite a retry: {revoked}"
        );
    }

    /// **The silent response must STAY silent.**
    ///
    /// Now that expiration and revocation have their own code,
    /// `InvitationInvalid` only serves the cases about which the service wants
    /// to say nothing — unknown token first and foremost. The temptation to
    /// narrow its message ("invitation not found", which would have become
    /// exact) is exactly what would make it an oracle: the text must keep
    /// listing the three causes without choosing any of them.
    ///
    /// Status, `errcode` and message are therefore frozen WORD FOR WORD, as
    /// they are in service — and not "approximately": the Android module
    /// depends on them to the letter.
    #[tokio::test]
    async fn the_silent_response_stays_unchanged_and_chooses_no_cause() {
        let (status, body) = render(AppError::InvitationInvalid).await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(body["errcode"], "M_NOT_FOUND");
        assert_eq!(body["error"], "invitation not found, expired or revoked");

        // The property, rather than mere equality: the three causes are
        // mentioned, so none is asserted.
        let message = body["error"].as_str().unwrap();
        for cause in ["not found", "expired", "revoked"] {
            assert!(
                message.contains(cause),
                "the silent response must keep listing its causes; \
                 \"{cause}\" is missing, and the message becomes an assertion: {message}"
            );
        }
    }

    /// **THE ISSUANCE REFUSAL MUST NAME THE TWO NUMBERS AND TELL THE PERSON
    /// WHAT WOULD LIFT IT.**
    ///
    /// This refusal is the whole point of the gate: a link emitted by an
    /// account that cannot honour it is claimed by someone who then waits 300
    /// seconds and fails, under `409 MESSAGR_NOT_YET_INVITED`. The service
    /// answers before the link exists instead — but a refusal that says only
    /// "not allowed" would leave the person and the operator with the same
    /// nothing, so both levels travel in the message.
    ///
    /// 403 and not 429: the condition does not lift by waiting, it lifts by a
    /// PROMOTION, which is somebody else's gesture. The vocabulary is this
    /// file's own — "a 403 would say 'never', and a well-behaved client would
    /// stop" is why `CeilingReached` refrains from it, and it is exactly what
    /// is meant here.
    #[tokio::test]
    async fn the_issuance_refusal_names_both_levels_and_what_would_lift_it() {
        let (status, body) = render(AppError::NotPromotedToInvite {
            required: 50,
            held: 0,
        })
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        assert_eq!(body["errcode"], "MESSAGR_NOT_PROMOTED");
        for neighbour in [
            "MESSAGR_INVITER_QUOTA",
            "MESSAGR_UPSTREAM",
            "M_NOT_FOUND",
            "MESSAGR_INVITATION_REVOKED",
        ] {
            assert_ne!(body["errcode"], neighbour);
        }
        let message = body["error"].as_str().unwrap();
        assert!(
            message.contains("50") && message.contains('0'),
            "both levels must travel, otherwise nobody can tell a 50-room from a \
             0-room: {message}"
        );
        assert!(
            message.contains("promot"),
            "the message must name the gesture that lifts it: {message}"
        );
    }

    /// The two refusals that are NOT about the emitter's level must not be
    /// mistaken for it, nor for each other: one says the room cannot be seen
    /// with this token (nothing to retry, name another room or get in first),
    /// the other says this service could not conclude (the room is intact, the
    /// answer was not).
    ///
    /// **NEITHER MAY EVER BE A SUCCESS**, which is the property the campaign
    /// paid for: `revoke_invitation` turning a 404 into an `Ok` left
    /// thirty-two live accounts the database believed dead.
    #[tokio::test]
    async fn a_room_that_cannot_be_read_refuses_and_says_which_kind_of_silence_it_was() {
        let (invisible, invisible_body) = render(AppError::RoomNotVisible).await;
        let (unreadable, unreadable_body) = render(AppError::InviteRightUnreadable(
            "the room's state carries no m.room.create event",
        ))
        .await;

        assert!(!invisible.is_success() && !unreadable.is_success());
        assert_eq!(invisible, StatusCode::FORBIDDEN);
        assert_eq!(invisible_body["errcode"], "MESSAGR_ROOM_NOT_VISIBLE");
        assert_eq!(unreadable, StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(unreadable_body["errcode"], "MESSAGR_ROOM_UNREADABLE");

        assert_ne!(invisible_body["errcode"], unreadable_body["errcode"]);
        for body in [&invisible_body, &unreadable_body] {
            // Not the emitter's level, which is a different repair entirely.
            assert_ne!(body["errcode"], "MESSAGR_NOT_PROMOTED");
            // Not the upstream outage either: sending an operator to chase one
            // that does not exist is the mistake `MatrixInviteRefused` exists
            // to avoid.
            assert_ne!(body["errcode"], "MESSAGR_UPSTREAM");
        }

        assert!(
            invisible_body["error"]
                .as_str()
                .unwrap()
                .contains("room_id"),
            "the message must name the field the caller got wrong: {invisible_body}"
        );
        // The reason travels verbatim: it is written in this repository, never
        // by the homeserver, so it carries nothing of the upstream's text.
        assert!(
            unreadable_body["error"]
                .as_str()
                .unwrap()
                .contains("no m.room.create event"),
            "the reason must say what could not be read: {unreadable_body}"
        );
        assert!(
            unreadable_body["error"]
                .as_str()
                .unwrap()
                .contains("no invitation"),
            "and it must say that nothing was created: {unreadable_body}"
        );
    }

    /// Renders an error and extracts (status, JSON body) from it.
    async fn render(e: AppError) -> (StatusCode, serde_json::Value) {
        let r = e.into_response();
        let status = r.status();
        let raw = axum::body::to_bytes(r.into_body(), usize::MAX)
            .await
            .unwrap();
        (status, serde_json::from_slice(&raw).unwrap())
    }

    /// `NoPendingRoom` must return a WAIT status distinct from its two
    /// neighbouring cases, never their `errcode`: neither 404 `M_NOT_FOUND`
    /// (`InvitationInvalid`, terminal — would wrongly tell the caller to give
    /// up), nor 503 `MESSAGR_RETRY` (`ReservedAccountUnusable`, which suggests
    /// that ANOTHER account would fix the problem).
    #[tokio::test]
    async fn no_pending_room_returns_409_and_not_the_neighbouring_errcodes() {
        let r = AppError::NoPendingRoom.into_response();
        assert_eq!(r.status(), StatusCode::CONFLICT);
        let body = axum::body::to_bytes(r.into_body(), usize::MAX)
            .await
            .unwrap();
        let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(body["errcode"], "MESSAGR_NOT_YET_INVITED");
        assert_ne!(body["errcode"], "M_NOT_FOUND");
        assert_ne!(body["errcode"], "MESSAGR_RETRY");
        assert_eq!(
            body["error"],
            "invitation valid, but no pending room for this reserved account: retry shortly"
        );
    }

    /// A refusal by the room must not read like a failure of the stack.
    ///
    /// Both return 503 and ask for a retry, but the repair is not the same:
    /// one is waited out, the other is corrected. Since the service does not
    /// log its requests, this response body is often the ONLY thing an
    /// operator will see; under the errcode of an upstream outage, they would
    /// chase an outage that does not exist while the invitation loops.
    ///
    /// The message must therefore point at what to look at, and say that the
    /// invitation is not lost — without which one would revoke it for nothing.
    #[tokio::test]
    async fn a_room_refusal_is_not_confused_with_an_upstream_outage() {
        let r = AppError::MatrixInviteRefused.into_response();
        assert_eq!(r.status(), StatusCode::SERVICE_UNAVAILABLE);
        let body = axum::body::to_bytes(r.into_body(), usize::MAX)
            .await
            .unwrap();
        let body: serde_json::Value = serde_json::from_slice(&body).unwrap();

        assert_eq!(body["errcode"], "MESSAGR_INVITE_REFUSED");
        // The check that matters: distinct from the two neighbouring 503s,
        // whose course of action is entirely different.
        assert_ne!(body["errcode"], "MESSAGR_UPSTREAM");
        assert_ne!(body["errcode"], "MESSAGR_RETRY");

        // And diagnosable: the message must name the setting to check and
        // reassure about the invitation's fate. A distinct `errcode` laid over
        // a vague message would be useless.
        let message = body["error"].as_str().unwrap();
        for expected in ["power_levels", "invite", "room", "intact"] {
            assert!(
                message.contains(expected),
                "the message must say what to look at and what becomes of the invitation; \
                 \"{expected}\" is missing: {message}"
            );
        }
    }

    /// The ceiling refusal must be EXPLICIT, never a degradation.
    ///
    /// Three properties, and not a frozen response body:
    /// - the status is not a success — a 2xx would suggest a served pool,
    ///   possibly truncated, which the contract forbids;
    /// - it carries its own `errcode`, distinct from its neighbours, so that a
    ///   client can handle it without reading the French text;
    /// - the message names the setting to change, without which the operator
    ///   has no way to know what to do.
    #[tokio::test]
    async fn the_ceiling_refuses_explicitly_and_says_what_to_do() {
        let r = AppError::CeilingReached {
            ceiling: 20,
            requested: 10,
        }
        .into_response();
        assert!(
            !r.status().is_success(),
            "a reached ceiling must never look like a success"
        );
        assert_eq!(r.status(), StatusCode::TOO_MANY_REQUESTS);

        let body = axum::body::to_bytes(r.into_body(), usize::MAX)
            .await
            .unwrap();
        let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(body["errcode"], "MESSAGR_INVITER_QUOTA");
        for neighbour in ["M_UNKNOWN", "M_INVALID_PARAM", "MESSAGR_UPSTREAM"] {
            assert_ne!(body["errcode"], neighbour);
        }

        let message = body["error"].as_str().unwrap();
        assert!(
            message.contains("20") && message.contains("10"),
            "the message must state the ceiling and what was requested: {message}"
        );
        assert!(
            message.contains("MAX_RESERVED_ACCOUNTS_PER_INVITER"),
            "the message must name the setting to raise: {message}"
        );
    }

    /// `DiscoveryQuotaReached`'s own version of the property directly
    /// above: explicit, never a degradation, and distinct from
    /// `CeilingReached` in every dimension -- same status class (429,
    /// a volume question, not a rights decision), but its own `errcode`,
    /// since the two ceilings guard unrelated resources and a client must
    /// be able to tell them apart from the body alone.
    ///
    /// AND THE 429 HAS TO BE EARNED. It is honest here only because the
    /// window rolls over on its own; while the ceiling was a lifetime
    /// total it was not, and this test's "says what to do" pinned an
    /// instruction only an operator could carry out.
    #[tokio::test]
    async fn the_discovery_quota_ceiling_refuses_explicitly_and_says_what_to_do() {
        let r = AppError::DiscoveryQuotaReached {
            charged: 49_990,
            ceiling: 50_000,
            requested: 20,
            retry_after_secs: 3_600,
        }
        .into_response();
        assert!(
            !r.status().is_success(),
            "a reached discovery quota ceiling must never look like a success"
        );
        assert_eq!(r.status(), StatusCode::TOO_MANY_REQUESTS);

        let body = axum::body::to_bytes(r.into_body(), usize::MAX)
            .await
            .unwrap();
        let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(body["errcode"], "MESSAGR_DISCOVERY_QUOTA");
        for neighbour in [
            "M_UNKNOWN",
            "M_INVALID_PARAM",
            "MESSAGR_UPSTREAM",
            "MESSAGR_INVITER_QUOTA",
        ] {
            assert_ne!(body["errcode"], neighbour);
        }

        let message = body["error"].as_str().unwrap();
        assert!(
            message.contains("49990") && message.contains("50000") && message.contains("20"),
            "the message must state what was charged, the ceiling, and what was \
             requested: {message}"
        );
        assert!(
            message.contains("3600"),
            "the message must say when the window resets, which is the only \
             thing the caller can act on: {message}"
        );
        // THE INVERSE, AND IT IS THE POINT OF THIS TEST'S NAME. This
        // message used to end "Raise MAX_DISCOVERY_QUOTA_PER_ACCOUNT if
        // this account is legitimate" -- an instruction requiring shell
        // access on this service, delivered to a phone. "What to do" has
        // to be something the recipient can do.
        assert!(
            !message.contains("MAX_DISCOVERY_QUOTA_PER_ACCOUNT"),
            "the message must not instruct a phone to edit the service's \
             configuration: {message}"
        );
    }

    /// `CreationInFlight` is a THIRD case, to be confused neither with the
    /// ceiling (429, a question of volume) nor with the unavailable upstream
    /// (503): the key is taken, the pool is not complete yet. The client must
    /// neither give up nor start over with a fresh key — the message says so.
    #[tokio::test]
    async fn a_creation_in_flight_is_a_conflict_distinct_from_its_neighbours() {
        let r = AppError::CreationInFlight.into_response();
        assert_eq!(r.status(), StatusCode::CONFLICT);
        let body = axum::body::to_bytes(r.into_body(), usize::MAX)
            .await
            .unwrap();
        let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(body["errcode"], "MESSAGR_CREATION_IN_FLIGHT");
        assert_ne!(body["errcode"], "MESSAGR_INVITER_QUOTA");
        assert_ne!(body["errcode"], "MESSAGR_UPSTREAM");
        let message = body["error"].as_str().unwrap();
        assert!(
            message.contains("SAME key") && message.contains("fresh key"),
            "the message must state both outcomes, otherwise a client loops: {message}"
        );
    }
}
