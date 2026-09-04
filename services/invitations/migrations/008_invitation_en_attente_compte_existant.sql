-- An existing account waiting to be invited into a conversation.
--
-- The claim path for an account that already exists has the RESERVED account
-- join the room and invite that account. A room created by this product sets
-- `m.room.power_levels`'s "invite" key to 50 and admits members at 0, so the
-- reserved account cannot invite: the homeserver answers 403, always, in
-- every room. The path could never succeed.
--
-- The product already has an account that CAN invite, and already uses it:
-- the inviter's own client, which created the room and holds level 100. It
-- polls the invitation's status, reads who needs inviting, and invites them.
-- That is how every newcomer enters. This table is what lets an existing
-- account be named there too.
--
-- WHAT A ROW MEANS: this invitation is waiting for the inviter's client to
-- invite `user_id`. The row is written when the reserved account's own
-- attempt is refused, and it is dropped once that account is a member, which
-- the claim discovers on its next attempt.
--
-- ONE ROW PER (invitation, account), because an invitation with several uses
-- can have several existing accounts waiting at once, and because a repeated
-- claim with the same idempotence key must not queue the same person twice.
--
-- NO SECRET HERE. A Matrix identifier is an identifier: the same class of
-- value `reserved_accounts.user_id` already holds, and `status.rs` already
-- hands to the inviter's client for exactly this purpose.
CREATE TABLE pending_existing_invites (
    invitation_id TEXT    NOT NULL,
    user_id       TEXT    NOT NULL,
    requested_at  INTEGER NOT NULL,
    PRIMARY KEY (invitation_id, user_id)
);
