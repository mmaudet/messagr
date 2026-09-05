#!/usr/bin/env bash
#
# One registered account on the bench homeserver, plus one claimable
# invitation per end-to-end test file -- accounts obtained through the
# invitation service rather than registered directly.
#
# Neither carries an email address or a phone number. That is the point: the
# product's identity is pseudonymous by decision, not by omission. See
# docs/adr/0002-pseudonymous-identity-partial-twake-alignment.md.
#
# ONE ACCOUNT HAS TO BE BOOTSTRAPPED, AND THAT IS NOT A SHORTCUT.
# Creating an invitation requires the caller's own Matrix bearer and invite
# rights in a room, so the graph cannot start from nothing. The first account
# is registered with the bench's registration token; the others come through
# the invitation flow the product actually uses.
#
# NOTHING IS WRITTEN INTO THIS REPOSITORY. The homeserver address, the
# registration token and the credentials produced all stay in the environment
# or in a file outside the tree. This repository is public.
set -euo pipefail

: "${MESSAGR_BENCH_HOMESERVER:?set it to the bench homeserver base URL}"
: "${MESSAGR_BENCH_TOKEN:?the bench registration token; never write it down here}"
OUT="${MESSAGR_BENCH_OUT:-/tmp/messagr-bench-accounts.json}"

# The production instance is refused by name rather than by convention. A
# bench that ran against it would create accounts on localparts a homeserver
# never releases, on the server meant to carry real conversations.
# THIS REFUSAL IS ABOUT BENCH PROVISIONING, NOT ABOUT PRODUCTION.
#
# A bench provisions and discards accounts by the dozen, and a homeserver
# never releases a localpart. So a bench pointed at production burns names,
# permanently, on the instance meant to carry real conversations. That is
# what this refuses, and it refuses it here rather than by convention.
#
# It is NOT a rule that production must never be touched. Tester builds use
# production, and three named accounts hold its registration token on
# purpose -- see docs/production-entry-point.md, which names all three and
# says why each is allowed to. Somebody who reads this refusal as a general
# prohibition, notices that production obviously IS used, and concludes the
# refusal is stale would be drawing the wrong lesson from the right rule.
# The scope is provisioning, and provisioning only.
case "$MESSAGR_BENCH_HOMESERVER" in
  *messagr.eu*)
    echo "REFUSED: $MESSAGR_BENCH_HOMESERVER is the production instance." >&2
    echo "A bench never PROVISIONS accounts there: it creates and discards" >&2
    echo "them by the dozen, and a homeserver never releases a localpart." >&2
    echo "Use the fork. See docs/production-entry-point.md for what does" >&2
    echo "legitimately run against production, and why." >&2
    exit 1
    ;;
esac

SERVICE="${MESSAGR_BENCH_SERVICE:-$MESSAGR_BENCH_HOMESERVER/_messagr}"

# A fresh localpart per run. Accounts reused between runs accumulate rooms,
# sessions and Megolm keys, so a run would be measuring state its own previous
# runs built.
suffix="$(date +%Y%m%d%H%M%S)-$RANDOM"

register() {
  local localpart="$1"
  local password
  password="$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)"

  # The protocol takes two calls: the first returns the user-interactive
  # authentication session, the second spends it with the registration token.
  local session
  session="$(curl -sS -X POST "$MESSAGR_BENCH_HOMESERVER/_matrix/client/v3/register" \
      -H 'Content-Type: application/json' -d '{}' \
    | python3 -c 'import sys,json; print(json.load(sys.stdin)["session"])')"

  curl -sS -X POST "$MESSAGR_BENCH_HOMESERVER/_matrix/client/v3/register" \
    -H 'Content-Type: application/json' \
    -d "$(python3 -c '
import json, sys
name, pwd, session, token = sys.argv[1:5]
print(json.dumps({
    "username": name,
    "password": pwd,
    "initial_device_display_name": "bench",
    "auth": {"type": "m.login.registration_token", "token": token, "session": session},
}))' "$localpart" "$password" "$session" "$MESSAGR_BENCH_TOKEN")" \
  | python3 -c "
import sys, json
r = json.load(sys.stdin)
if 'user_id' not in r:
    raise SystemExit('registration failed: ' + json.dumps(r))
print(json.dumps({
    'user_id': r['user_id'],
    'device_id': r['device_id'],
    'access_token': r['access_token'],
    'password': '$password',
}))"
}

echo "registering the inviter" >&2
inviter="$(register "bench-inviter-$suffix")"
inviter_token="$(printf '%s' "$inviter" | python3 -c 'import sys,json; print(json.load(sys.stdin)["access_token"])')"

echo "creating a room for the invitation to be for" >&2
room_id="$(curl -sS -X POST "$MESSAGR_BENCH_HOMESERVER/_matrix/client/v3/createRoom" \
  -H "Authorization: Bearer $inviter_token" -H 'Content-Type: application/json' \
  -d '{"preset":"private_chat","name":"bench"}' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["room_id"])')"

# THE BENCH ROOM IS ENCRYPTED, because an unencrypted one is not the thing
# under test. createRoom's presets do not turn encryption on, and a client
# that asks whether the room is encrypted -- which is what a Matrix client
# does before deciding to encrypt -- would be told no and send plaintext.
# Set here rather than by a client, because the account that creates the room
# is the one that has the power level to set its state.
# THE ROOM MUST COST 50 TO INVITE, AND `createRoom` DOES NOT DO THAT.
#
# A conversation this product creates sets `invite` to 50 and admits members
# at 0, which is what makes "an entrant cannot invite, a promoted member can"
# true at all -- the invitation service reads this event rather than taking
# the application's word for it. A plain `createRoom` leaves no `invite` key,
# and the specification's default for a missing one is **0**: every member
# may invite.
#
# Measured, on 5 September 2026, while proving #34 against the fork: the
# bench room came back as `{"users": {}}`. A run against it would have shown
# an entrant unable to invite for no reason at all, and a promoted one able
# for no reason either -- the criterion passing while testing nothing. A
# bench that does not reproduce what the product builds proves things about
# a room nobody ships.
echo "setting the invite cost the product sets" >&2
levels="$(curl -sS "$MESSAGR_BENCH_HOMESERVER/_matrix/client/v3/rooms/$room_id/state/m.room.power_levels" \
  -H "Authorization: Bearer $inviter_token")"
curl -fsS -o /dev/null -X PUT \
  "$MESSAGR_BENCH_HOMESERVER/_matrix/client/v3/rooms/$room_id/state/m.room.power_levels" \
  -H "Authorization: Bearer $inviter_token" -H 'Content-Type: application/json' \
  -d "$(printf '%s' "$levels" | python3 -c '
import json, sys
levels = json.load(sys.stdin)
levels["invite"] = 50
levels["users_default"] = 0
print(json.dumps(levels))')"

echo "marking the room encrypted" >&2
# -f so a refusal is an error here. Without it curl exits 0 on a 403 and the
# missed state event surfaces two CI jobs later, as a counterparty reporting
# that the room is not encrypted.
curl -fsS -o /dev/null -X PUT \
  "$MESSAGR_BENCH_HOMESERVER/_matrix/client/v3/rooms/$room_id/state/m.room.encryption" \
  -H "Authorization: Bearer $inviter_token" -H 'Content-Type: application/json' \
  -d '{"algorithm":"m.megolm.v1.aes-sha2"}'

# The room is required: without it the service cannot read a power level, so it
# cannot tell an account that can honour the link it hands out from one that
# cannot.
# ONE CLAIMABLE INVITATION, MINTED AND MADE CLAIMABLE.
#
# Create it, let the service draw an account for it, invite that account into
# the room, and hand both halves back. Echoes "<token> <entrant_user_id>".
#
# Written as a function and called more than once because each Detox test file
# gets a freshly installed application: the harness uninstalls between files,
# so nothing in the device's keystore survives that boundary and no suite can
# inherit a session another one claimed. Before the application claimed its
# own invitation this did not show, because the session was baked into the
# build and a reinstall cost nothing. Now it lives on the device, so every
# suite that needs an account claims its own.
mint_claimable_invitation() {
  local label="$1"
  local invitation invite_token invitation_id entrant attempt

  echo "creating an invitation for $label" >&2
  # The idempotency key is required, and the service says why: without it every
  # retry would create a new pool of definitive accounts.
  invitation="$(curl -sS -X POST "$SERVICE/invitations" \
    -H "Authorization: Bearer $inviter_token" -H 'Content-Type: application/json' \
    -H "idempotency-key: $(uuidgen)" \
    -d "$(python3 -c 'import json,sys; print(json.dumps({"max_uses":1,"ttl_seconds":3600,"room_id":sys.argv[1]}))' "$room_id")")"
  invite_token="$(printf '%s' "$invitation" | python3 -c 'import sys,json; print(json.load(sys.stdin)["token"])')"
  invitation_id="$(printf '%s' "$invitation" | python3 -c 'import sys,json; print(json.load(sys.stdin)["invitation_id"])')"

  # The account is created here, at claim time, and not before. The response
  # carries device_id as well as access_token because the triple is what
  # restores a session: given only a token, a client has to log in by password,
  # which creates a second device and wastes the token it was just handed.
  echo "drawing the account this invitation will create" >&2

  # THE CLAIM IS HALF OF A TWO-PARTY DANCE, AND THE 409 DOES NOT BLOCK.
  #
  # The call is synchronous, not a long-poll: the first claim draws an account,
  # answers 409 MESSAGR_NOT_YET_INVITED immediately because the drawn account is
  # in no room yet, and returns. Nothing about that connection reopens on its
  # own once the room invite lands — verified by hand: a backgrounded first call
  # still holds the 409 body after the invite, because it already returned
  # before the invite was sent. What unblocks the account is a SECOND claim
  # call, made after the invite, with the same token. The service names the
  # drawn entrant on the invitation's status in between, which is how the
  # issuer's side learns who to invite.
  echo "first claim, expected to draw the account and answer 409" >&2
  curl -sS -o /dev/null -X POST "$SERVICE/invitations/claim" \
    -H 'Content-Type: application/json' \
    -d "$(python3 -c 'import json,sys; print(json.dumps({"token":sys.argv[1]}))' "$invite_token")"

  echo "waiting for the service to name the drawn entrant" >&2
  entrant=""
  for attempt in $(seq 1 30); do
    entrant="$(curl -sS "$SERVICE/invitations/$invitation_id" \
      -H "Authorization: Bearer $inviter_token" \
      | python3 -c 'import sys,json; print(json.load(sys.stdin).get("entrant_user_id") or "")' 2>/dev/null || true)"
    [ -n "$entrant" ] && break
    sleep 2
  done
  [ -n "$entrant" ] || { echo "the service never named a drawn entrant: the wait contract did not engage" >&2; exit 1; }
  echo "  entrant drawn: $entrant" >&2

  echo "inviting the entrant into the room" >&2
  curl -sS -o /dev/null -X POST \
    "$MESSAGR_BENCH_HOMESERVER/_matrix/client/v3/rooms/$room_id/invite" \
    -H "Authorization: Bearer $inviter_token" -H 'Content-Type: application/json' \
    -d "$(python3 -c 'import json,sys; print(json.dumps({"user_id":sys.argv[1]}))' "$entrant")"

  # A brief settle: the invite is one homeserver call and the second claim reads
  # the same server's room state, but nothing here promises they land in the
  # same instant.
  sleep 2

  printf '%s %s\n' "$invite_token" "$entrant"
}

# THE SECOND CLAIM IS NOT MADE HERE ANY MORE, AND THAT IS THE POINT.
#
# It used to happen in this script, and the session it produced was baked
# into the application's bundle at build time. That made the application
# unrunnable by anyone who was not building it, and it is exactly the scaffold
# the invitation flow replaces: the application claims the invitation itself,
# on the device, which is what a real person does.
#
# What this script hands over is therefore the link, not a session. The
# invitation is drawn and its entrant invited, so the claim will succeed; the
# claim itself belongs to whoever opens the link.

# ONE INVITATION PER TEST FILE, AND WHY THERE IS MORE THAN ONE.
#
# An invitation is single-use, and each Detox test file starts from a freshly
# installed application, so a suite cannot spend an invitation another suite
# already spent nor inherit the session it produced. Each suite that needs an
# account therefore gets its own link, and the accounts are distinct people in
# the same room -- which is what they are.
# Command substitution rather than process substitution: a failure inside the
# function has to stop this script, and `read < <(...)` would swallow it --
# the subshell's exit status is not the one `set -e` looks at.
boot_pair="$(mint_claimable_invitation "the boot suite")"
trip_pair="$(mint_claimable_invitation "the round-trip suite")"
read -r boot_token boot_entrant <<<"$boot_pair"
read -r trip_token trip_entrant <<<"$trip_pair"

as_link() { printf 'messagr://%s/i/%s\n' "${MESSAGR_BENCH_HOMESERVER#https://}" "$1"; }

python3 -c "
import json, sys
inviter, room, entrant, link, trip_entrant, trip_link = sys.argv[1:7]
out = {
    'homeserver': '$MESSAGR_BENCH_HOMESERVER',
    'room_id': room,
    'inviter': json.loads(inviter),
    'entrant_user_id': entrant,
    'invitation_link': link,
    'roundtrip_entrant_user_id': trip_entrant,
    'roundtrip_invitation_link': trip_link,
}
print(json.dumps(out, indent=2))
" "$inviter" "$room_id" "$boot_entrant" "$(as_link "$boot_token")" \
  "$trip_entrant" "$(as_link "$trip_token")" > "$OUT"

chmod 600 "$OUT"
echo "wrote the invitation to $OUT" >&2
python3 -c "
import json
d = json.load(open('$OUT'))
print('inviter :', d['inviter']['user_id'], '(registered)')
print('entrant :', d['entrant_user_id'], '(drawn, invited, not yet claimed)')
print('entrant2:', d['roundtrip_entrant_user_id'], '(drawn, invited, not yet claimed)')
print('room    :', d['room_id'])
print('both links are in the file; the application claims one per suite')
"
