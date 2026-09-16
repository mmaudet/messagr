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
# SINCE #341 IT GUARDS A SENTENCE AS WELL AS A SHAPE. ADR-0009 asked for a
# visible fallback for the wake that does not happen, and asked it to say
# nothing: "no sender, no conversation, no count. […] It is the worst possible
# place to make an exception, because nobody would see it happening." That last
# clause is the whole reason the fallback block below exists. What it guards
# against is not a bug anybody would file -- it is somebody finding the
# notification poor, putting a name in it, and nobody noticing, because a
# notification is drawn on other people's lock screens and never on the
# reviewer's. So the words the gateway may send are pinned, one by one, against
# the application's own catalogues.
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

# The blind notification's French sentence, filled in from the application's
# own catalogue below and compared against the published page. Declared here so
# a missing gateway does not leave it unset under `set -u`.
BLIND_FR=""

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
  # about a message. The others are what goes inside it.
  #
  # `data` and `default_payload` joined the list in #341, and they are the two
  # this script watches hardest: `data` is the field a client writes and sygnal
  # merges, so a `data` FORWARDED rather than WRITTEN here is a payload anybody
  # holding an access token can fill. The checks further down are what tell the
  # two apart.
  expected="app_id data default_payload devices event_id notification prio pushkey "
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

  # ── THE VISIBLE FALLBACK, AND THE WORDS IT MAY SAY (#341) ───────────────

  # The `data` that goes out is WRITTEN, not PASSED ON. This is the single
  # most important line of this script: `strip` handing back the `data` it
  # received would forward whatever the registering client put in it, and
  # every assertion above would still pass.
  if printf '%s' "$payload" | grep -q '"data": { "default_payload": blind_alert(spoken(device)) },'; then
    say_ok "the only thing forwarded under \`data\` is the template the gateway wrote itself"
  else
    say_bad "the gateway's \`data\` is no longer the template it writes itself: a \`data\` taken from the notification is a payload any client can fill"
  fi

  # AND IT IS ATTACHED TO APPLE'S TRANSPORT ONLY. sygnal's Firebase pushkin
  # merges `default_payload` into the data message exactly as the Apple one
  # does (`gcmpushkin.py`, `_build_data`), so a template on an Android device
  # would push the sentence, and the language it names, across Google.
  if printf '%s' "$payload" | grep -q 'if device.app_id != APPLE {'; then
    say_ok "the fallback is attached to Apple's transport and to no other"
  else
    say_bad "the gateway no longer keeps the fallback off Firebase: sygnal merges default_payload into the Google data message too"
  fi

  template="$(sed -n '/^fn blind_alert(/,/^}/p' "$GATEWAY")"
  chooser="$(sed -n '/^fn spoken(/,/^}/p' "$GATEWAY")"

  # NAMED RATHER THAN INFERRED, for the reason the top of this file gives: a
  # renamed function would make every check below pass over nothing.
  [ -n "$template" ] || say_bad "the fallback is no longer built by \`fn blind_alert(\` in $GATEWAY"
  [ -n "$chooser" ] || say_bad "the language is no longer chosen by \`fn spoken(\` in $GATEWAY"

  if [ -n "$template" ]; then
    # It is a function of the language and of NOTHING ELSE. Taking the device
    # or the notification is the first move of every version of this that ends
    # up naming somebody, and it is a signature change rather than a leak, so
    # nothing else here would see it.
    if printf '%s' "$template" | grep -q '^fn blind_alert(language: Spoken) -> Value {$'; then
      say_ok "the fallback is built from the language alone"
    else
      say_bad "\`blind_alert\` no longer takes the language and nothing else: whatever it takes now, read this script before changing it"
    fi

    shown="$(printf '%s' "$template" | grep -o '"[a-z_-]*":' | tr -d '":' | sort -u | tr '\n' ' ')"
    if [ "$shown" = "alert aps body title " ]; then
      say_ok "the fallback carries only: $shown"
    else
      say_bad "the fallback carries [$shown], and a blind notification may carry only [alert aps body title ]"
    fi

    for named in room sender content membership unread badge count account user display subtitle; do
      if printf '%s' "$template" | grep -qi "$named"; then
        say_bad "the fallback names $named, which ADR-0009 forbids it to"
      fi
    done
  fi

  if [ -n "$chooser" ]; then
    # A tag nobody recognises FALLS BACK rather than being carried. Without
    # this, the tag itself is the way a client writes into the payload.
    if printf '%s' "$chooser" | grep -q '_ => Spoken::Fr,'; then
      say_ok "a language tag this application does not speak falls back to French"
    else
      say_bad "the language tag no longer falls back: a notification can now be lost, or a client's string carried"
    fi
    for copying in to_owned to_string 'String::from' 'format!' push_str; do
      if printf '%s' "$chooser" | grep -qF "$copying"; then
        say_bad "the language tag is copied rather than matched ($copying): a client's string would reach the payload"
      fi
    done
  fi

  # ── The words themselves, read out of the application's catalogues ──────
  #
  # Restating them here would be a third place to keep in step, and the whole
  # point of this file is that there are two. Read instead: a sentence edited
  # in the application and not in the gateway fails here, rather than shipping
  # as two notifications that disagree about what the product says.
  copy_of() {
    sed -n "s/^  $2: '\(.*\)',\$/\1/p" "$ROOT/packages/app/src/copy/$1.ts" 2>/dev/null | head -1
  }

  allowed="aps
alert
title
body"
  for language in de en es fr it nl uz; do
    said="$(copy_of "$language" notify_blind_body)"
    called="$(copy_of "$language" notify_blind_title)"
    if [ -z "$said" ] || [ -z "$called" ]; then
      say_bad "the application's $language catalogue has no blind notification text"
      continue
    fi
    [ "$language" = fr ] && BLIND_FR="$said"
    allowed="$allowed
$said
$called"
    if [ -z "$template" ]; then
      continue
    fi
    if printf '%s' "$template" | grep -qF "\"$said\""; then
      say_ok "the fallback says the application's own $language sentence"
    else
      say_bad "the gateway's $language sentence is not the application's, which is \"$said\""
    fi
  done

  # AND NOTHING ELSE. The checks above say the seven sentences are there; this
  # one says there is no eighth -- which is the shape the defect takes, because
  # nobody removes a sentence to add a name, they add one.
  if [ -n "$template" ]; then
    for literal in $(printf '%s' "$template" | grep -o '"[^"]*"' | sed 's/^"//; s/"$//' | sort -u | tr ' ' '\001'); do
      literal="$(printf '%s' "$literal" | tr '\001' ' ')"
      if printf '%s\n' "$allowed" | grep -Fxq -- "$literal"; then
        continue
      fi
      say_bad "the fallback carries a word no catalogue of this application holds: \"$literal\""
      say_bad "if the notification is meant to say that, it is meant to say it in seven languages, and in the application first"
    done
  fi
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
# THE VISIBLE FALLBACK, SAID ON THE PAGE IN THE GATEWAY'S OWN WORDS (#341).
#
# The sentence is READ OUT OF THE APPLICATION rather than typed here, so the
# page, the gateway and the application cannot end up saying three different
# things. What the second one binds is the claim, not the wording: a page that
# stopped promising the notification names nobody would be a page describing a
# different product from the one `blind_alert` builds.
MUST_SAY_4="${BLIND_FR:-Quelque chose est arrivé.}"
MUST_SAY_5="Elle ne nomme ni votre correspondant, ni votre conversation, ni vous"
MUST_NOT_SAY="il n'existe aucun tiers dans cette application"

source_text="$(cat "$PAGE_SOURCE" 2>/dev/null || true)"
if [ -z "$source_text" ]; then
  say_bad "the policy page is missing from the repository: $PAGE_SOURCE"
else
  check_text "the page in the repository" "$source_text" "$MUST_SAY_1"
  check_text "the page in the repository" "$source_text" "$MUST_SAY_2"
  check_text "the page in the repository" "$source_text" "$MUST_SAY_3"
  check_text "the page in the repository" "$source_text" "$MUST_SAY_4"
  check_text "the page in the repository" "$source_text" "$MUST_SAY_5"
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
  for phrase in "$MUST_SAY_1" "$MUST_SAY_2" "$MUST_SAY_3" "$MUST_SAY_4" \
    "$MUST_SAY_5"; do
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
