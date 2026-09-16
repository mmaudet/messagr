#!/usr/bin/env bash
#
# The published policy and the push gateway must say the same thing.
#
# This is `assert-retention.sh`'s rule applied to a second claim. That one
# exists because the policy once said the invitation graph was kept as long as
# the accounts existed while the service purged it at thirty days -- a privacy
# policy is a statement about what a system does, so a divergence is not a
# documentation bug, it is the document being false.
#
# The claim here is narrower and more consequential: that what crosses Google
# carries no sender, no conversation and no content. It is enforced in one
# place -- `services/invitations/src/handlers/wake.rs`, whose `strip` keeps
# exactly `devices` and `prio` -- and stated in another, the published page.
# Nothing but this script makes the two agree.
#
# SINCE #286 THE VALUE AND ITS BUILDER ARE IN TWO PLACES. `strip` builds what
# leaves, one device at a time; the meaningless event id is drawn by `notify`,
# once per notification, and handed down. So the payload is read out of one
# function and the provenance of the event id out of the other. Reading only
# `strip` would have found `"event_id": event_id` and called it generated,
# which says nothing at all -- the parameter could carry the real one.
#
# It also guards a claim that was FALSE for as long as it took to notice: the
# page said the application contained no third-party library "parce qu'il
# n'existe aucun tiers dans cette application", which stopped being true the
# day Firebase Messaging was added. The check for that sentence's absence is
# not tidiness; it is the one assertion here that has already caught something.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GATEWAY="$ROOT/services/invitations/src/handlers/wake.rs"
PAGE_SOURCE="$ROOT/deploy/messagr-eu/site/confidentialite/index.html"
PAGE="${MESSAGR_SITE:-https://messagr.eu}/confidentialite/"

failed=0
say_ok() { printf '  OK    %s\n' "$1"; }
say_bad() { printf '  FAIL  %s\n' "$1" >&2; failed=1; }

# ── What the gateway actually forwards ────────────────────────────────────
#
# Read out of the code rather than restated here. A constant in this file
# would be a third place to keep in step, and the whole point is that there
# are only two.
if [ ! -f "$GATEWAY" ]; then
  say_bad "the push gateway is not where this expects it: $GATEWAY"
else
  payload="$(sed -n '/^fn strip(/,/^}/p' "$GATEWAY")"
  handler="$(sed -n '/^pub async fn notify(/,/^}/p' "$GATEWAY")"

  # NAMED RATHER THAN INFERRED FROM AN EMPTY RESULT. A renamed function would
  # otherwise make every check below pass over nothing at all, and the only
  # sign would be an empty field list -- which reads like a gateway that
  # forwards nothing, the safest-looking failure there is.
  [ -n "$payload" ] || say_bad "the payload is no longer built by \`fn strip(\` in $GATEWAY"
  [ -n "$handler" ] || say_bad "the handler is no longer \`pub async fn notify(\` in $GATEWAY"

  kept="$(printf '%s' "$payload" | grep -o '"[a-z_]*":' | tr -d '":' | sort -u | tr '\n' ' ')"
  # `notification` is the envelope the push gateway API defines, not a field
  # about a message. The other four are what goes inside it.
  expected="app_id devices event_id notification prio pushkey "
  if [ "$kept" = "$expected" ]; then
    say_ok "the gateway forwards only: $kept"
  else
    say_bad "the gateway forwards [$kept], and this script expected [$expected]"
    say_bad "if that change is intended, the policy page has to change with it"
  fi

  for leaked in room_id sender content room_name membership type; do
    if printf '%s' "$payload" | grep -q "\"$leaked\""; then
      say_bad "the gateway forwards $leaked, which the page says it does not"
    fi
  done

  # `event_id` IS forwarded, and the whole question is which one.
  #
  # Sygnal discards a notification carrying no room id, no event id and no
  # counts -- measured against the real deployment, where it answered 200 and
  # sent nothing. So a value has to be there, and it is a random one. Passing
  # the real event id instead would be the leak this gateway exists to
  # prevent, and it is a one-word edit away.
  #
  # Read in the HANDLER, which is where the value is drawn since #286, and
  # not in the builder that receives it.
  if printf '%s' "$handler" | grep -q 'let event_id = meaningless_id();'; then
    say_ok "the event id sent is generated, not the message's"
  else
    say_bad "the gateway's event id is no longer a generated one"
  fi
  # And the builder still puts THAT value in the payload, rather than one of
  # its own or one read off the notification.
  if printf '%s' "$payload" | grep -q '"event_id": event_id,'; then
    say_ok "the generated event id is the one that goes out"
  else
    say_bad "the payload's event id is not the value the handler drew"
  fi
  for place in "$payload" "$handler"; do
    if printf '%s' "$place" | grep -q 'notification.event_id'; then
      say_bad "the gateway reads the real event id, which must never leave"
    fi
  done
fi

# ── What the page says, in the repository and live ────────────────────────
#
# Both, because they are two different failures: a page edited here and never
# deployed, and a page edited on the server and never brought back.
check_text() {
  local where="$1" text="$2" phrase="$3"
  if printf '%s' "$text" | tr -s ' \n' ' ' | grep -qF "$phrase"; then
    say_ok "$where says \"$phrase\""
  else
    say_bad "$where never says \"$phrase\""
  fi
}

refute_text() {
  local where="$1" text="$2" phrase="$3"
  if printf '%s' "$text" | tr -s ' \n' ' ' | grep -qF "$phrase"; then
    say_bad "$where still says \"$phrase\", which stopped being true"
  else
    say_ok "$where no longer says \"$phrase\""
  fi
}

MUST_SAY_1="ni expéditeur, ni conversation, ni message"
MUST_SAY_2="l'identifiant technique de votre appareil, une priorité de remise, et un nombre tiré au hasard"
MUST_SAY_3="tiré au hasard à chaque envoi, sans aucun rapport avec le message"
MUST_NOT_SAY="il n'existe aucun tiers dans cette application"

source_text="$(cat "$PAGE_SOURCE" 2>/dev/null || true)"
if [ -z "$source_text" ]; then
  say_bad "the policy page is missing from the repository: $PAGE_SOURCE"
else
  check_text "the page in the repository" "$source_text" "$MUST_SAY_1"
  check_text "the page in the repository" "$source_text" "$MUST_SAY_2"
  check_text "the page in the repository" "$source_text" "$MUST_SAY_3"
  refute_text "the page in the repository" "$source_text" "$MUST_NOT_SAY"
fi

# THE LIVE HALF IS BINDING ONLY WHEN THE BUILD IS OUT.
#
# Between writing the page and shipping the application that makes it true,
# the two disagree on purpose: publishing first would describe an application
# nobody has, and shipping first would leave the policy false. The repository
# leads, the deployment follows, and this reports the gap loudly without
# failing -- until `--live`, which the release path passes and which makes the
# gap an error. Reported rather than skipped, because a silent skip is how a
# check stops checking.
binding=0
[ "${1:-}" = "--live" ] && binding=1

live_text="$(curl -sSL --max-time 20 "$PAGE" 2>/dev/null || true)"
if [ -z "$live_text" ]; then
  printf '  SKIP  the live page could not be read at %s\n' "$PAGE"
else
  behind=0
  for phrase in "$MUST_SAY_1" "$MUST_SAY_2" "$MUST_SAY_3"; do
    printf '%s' "$live_text" | tr -s ' \n' ' ' | grep -qF "$phrase" || behind=1
  done
  printf '%s' "$live_text" | tr -s ' \n' ' ' | grep -qF "$MUST_NOT_SAY" && behind=1

  if [ "$behind" -eq 0 ]; then
    say_ok "the live page says what the repository's does"
  elif [ "$binding" -eq 1 ]; then
    say_bad "the live page is behind the repository's, and this is a release"
  else
    printf '  AHEAD the repository page is not deployed yet; deploy it with the build\n'
  fi
fi

if [ "$failed" -ne 0 ]; then
  echo "the policy and the push gateway do not say the same thing" >&2
fi
exit "$failed"
