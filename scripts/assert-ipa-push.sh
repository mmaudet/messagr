#!/usr/bin/env bash
#
# What the built .ipa actually carries, which is not what the sources asked for.
#
# `assert-ios-push.sh` reads this repository and it is right to: it catches an
# entitlements file nobody references, a background mode nobody declared, a
# sygnal on the wrong platform. It cannot catch the failure below, because the
# failure happens after it.
#
# AUTOMATIC SIGNING INTERSECTS ENTITLEMENTS WITH THE PROFILE.
#
# `Messagr.entitlements` says `aps-environment: production`. The archive step
# signs against a *development* profile -- that is what `xcodebuild archive`
# with automatic signing does -- and the archive comes out carrying
# `development`, silently. `xcodebuild -exportArchive` then re-signs against a
# distribution profile and `production` comes back.
#
# Observed on the first real archive of #109, and it is the whole hazard of
# that ticket in one line: a sandbox token on a TestFlight build answers
# `BadDeviceToken` at every push, delivers nothing, and says nothing anywhere.
# The symptom is a tester who locks their phone and waits.
#
# So nothing is uploaded until this has read the file that would be uploaded.
#
# Usage: scripts/assert-ipa-push.sh path/to/Messagr.ipa
set -uo pipefail

IPA="${1:-}"
if [ -z "$IPA" ] || [ ! -f "$IPA" ]; then
  echo "usage: $0 path/to/Messagr.ipa" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "$0")" && pwd)/.."
SYGNAL="$ROOT/deploy/messagr-sygnal/sygnal.yaml"

failed=0
say_ok() { printf '  OK    %s\n' "$1"; }
say_bad() { printf '  FAIL  %s\n' "$1" >&2; failed=1; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
unzip -q "$IPA" -d "$work" || { echo "not a readable .ipa: $IPA" >&2; exit 2; }

app="$(find "$work/Payload" -maxdepth 1 -name '*.app' | head -1)"
[ -n "$app" ] || { echo "no .app inside $IPA" >&2; exit 2; }

codesign -d --entitlements :- "$app" 2>/dev/null > "$work/entitlements.plist"
[ -s "$work/entitlements.plist" ] || { echo "the app in $IPA is not signed" >&2; exit 2; }

read_key() {
  python3 - "$work/entitlements.plist" "$1" <<'PY'
import plistlib, sys
d = plistlib.load(open(sys.argv[1], 'rb'))
v = d.get(sys.argv[2])
print('' if v is None else ('true' if v is True else 'false' if v is False else v))
PY
}

# ── 1. The environment the token will belong to ───────────────────────────
# Wanted is read from sygnal rather than hardcoded, so this script and
# `assert-ios-push.sh` agree by construction: whichever half somebody flips,
# the other is what this compares against.
wanted="$(sed -n '/^  eu\.messagr\.apns:/,/^  [a-z]/p' "$SYGNAL" 2>/dev/null \
  | sed -n 's/^    platform: *//p' | head -1)"
[ -n "$wanted" ] || wanted=production
environment="$(read_key aps-environment)"
if [ "$environment" = "$wanted" ]; then
  say_ok "the build carries aps-environment: $environment, which is what sygnal serves"
elif [ -z "$environment" ]; then
  say_bad "the build carries no aps-environment at all: it can never get a token"
else
  say_bad "the build carries '$environment' and sygnal serves '$wanted': Apple would answer BadDeviceToken"
fi

# ── 2. A distribution build, not a development one ────────────────────────
# `get-task-allow` is what lets a debugger attach. True means this was signed
# for development, which App Store Connect rejects -- and which would have
# been the tell, had the archive gone up unexamined.
if [ "$(read_key get-task-allow)" = "false" ]; then
  say_ok "get-task-allow is false, so this was signed for distribution"
else
  say_bad "get-task-allow is true: this is a development build and TestFlight will refuse it"
fi

# ── 3. TestFlight is what it is for ───────────────────────────────────────
if [ "$(read_key beta-reports-active)" = "true" ]; then
  say_ok "beta-reports-active is set, so TestFlight will accept it"
else
  say_bad "beta-reports-active is not set: this is not a TestFlight-capable build"
fi

# ── 4. The right application ──────────────────────────────────────────────
identifier="$(read_key application-identifier)"
if [ "$identifier" = "KUT463DS29.eu.messagr" ]; then
  say_ok "it is KUT463DS29.eu.messagr"
else
  say_bad "the application identifier is '$identifier', not KUT463DS29.eu.messagr"
fi

if [ "$failed" -ne 0 ]; then
  echo "this .ipa must not be uploaded" >&2
fi
exit "$failed"
