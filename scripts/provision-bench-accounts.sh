#!/usr/bin/env bash
#
# Two pseudonymous accounts on the bench homeserver, the second obtained
# through the invitation service rather than registered directly.
#
# Neither carries an email address or a phone number. That is the point: the
# product's identity is pseudonymous by decision, not by omission. See
# docs/adr/0002-pseudonymous-identity-partial-twake-alignment.md.
#
# ONE ACCOUNT HAS TO BE BOOTSTRAPPED, AND THAT IS NOT A SHORTCUT.
# Creating an invitation requires the caller's own Matrix bearer and invite
# rights in a room, so the graph cannot start from nothing. The first account
# is registered with the bench's registration token; the second comes through
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
case "$MESSAGR_BENCH_HOMESERVER" in
  *messagr.eu*)
    echo "REFUSED: $MESSAGR_BENCH_HOMESERVER is the production instance." >&2
    echo "A bench never creates an account there. Use the fork." >&2
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

# The room is required: without it the service cannot read a power level, so it
# cannot tell an account that can honour the link it hands out from one that
# cannot.
echo "creating an invitation" >&2
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
echo "claiming it, which is where the second account is created" >&2

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

echo "second claim, expected to succeed now the entrant is invited" >&2
invitee=""
for attempt in $(seq 1 10); do
  invitee="$(curl -sS -X POST "$SERVICE/invitations/claim" \
    -H 'Content-Type: application/json' \
    -d "$(python3 -c 'import json,sys; print(json.dumps({"token":sys.argv[1]}))' "$invite_token")")"
  printf '%s' "$invitee" | grep -q '"user_id"' && break
  printf '%s' "$invitee" | grep -q 'MESSAGR_NOT_YET_INVITED' || { echo "claim refused: $invitee" >&2; exit 1; }
  sleep 2
done

python3 -c "
import json, sys
inviter, invitee, room = sys.argv[1:4]
out = {
    'homeserver': '$MESSAGR_BENCH_HOMESERVER',
    'room_id': room,
    'inviter': json.loads(inviter),
    'invitee': json.loads(invitee),
}
missing = [k for k in ('user_id', 'device_id', 'access_token') if k not in out['invitee']]
if missing:
    raise SystemExit('the claim response is missing ' + ', '.join(missing))
print(json.dumps(out, indent=2))
" "$inviter" "$invitee" "$room_id" > "$OUT"

chmod 600 "$OUT"
echo "wrote two accounts to $OUT" >&2
python3 -c "
import json
d = json.load(open('$OUT'))
print('inviter:', d['inviter']['user_id'], '(registered)')
print('invitee:', d['invitee']['user_id'], '(claimed through the invitation service)')
print('room   :', d['room_id'])
"
