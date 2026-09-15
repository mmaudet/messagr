#!/usr/bin/env bash
#
# The three things an iPhone needs to be woken, and which fail in silence.
#
# A standards review found all three missing at once, on a branch whose
# `ios-simulator` job was green. That job is right to be: a simulator build
# proves compilation, and none of these is about compiling. They are about
# entitlement, and an unentitled build registers with Apple, is refused, and
# reports nothing -- `getAPNSToken` answers null for ever, which reads exactly
# like "Apple has not answered yet".
#
# So this is the only thing that will ever notice. It runs in the ordinary
# checks rather than only on macOS: all three are files in this repository,
# and a Linux runner can read them.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)/.."
IOS="$ROOT/packages/app/ios"
PLIST="$IOS/Messagr/Info.plist"
ENTITLEMENTS="$IOS/Messagr/Messagr.entitlements"
PROJECT="$IOS/Messagr.xcodeproj/project.pbxproj"

failed=0
say_ok() { printf '  OK    %s\n' "$1"; }
say_bad() { printf '  FAIL  %s\n' "$1" >&2; failed=1; }

# ── 1. The background mode ────────────────────────────────────────────────
# Without it iOS drops a content-available push rather than deferring it: the
# application is never started and nothing is ever drawn.
if python3 - "$PLIST" <<'PY'
import plistlib, sys
d = plistlib.load(open(sys.argv[1], 'rb'))
sys.exit(0 if 'remote-notification' in (d.get('UIBackgroundModes') or []) else 1)
PY
then
  say_ok "Info.plist declares the remote-notification background mode"
else
  say_bad "Info.plist has no remote-notification background mode: a closed iPhone cannot be woken"
fi

# ── 2. The entitlement ────────────────────────────────────────────────────
if [ ! -f "$ENTITLEMENTS" ]; then
  say_bad "there is no entitlements file: the build can never get an APNs token"
else
  environment="$(python3 - "$ENTITLEMENTS" <<'PY'
import plistlib, sys
print(plistlib.load(open(sys.argv[1], 'rb')).get('aps-environment', ''))
PY
)"
  case "$environment" in
    development|production) say_ok "the entitlements ask for aps-environment: $environment" ;;
    "") say_bad "the entitlements carry no aps-environment" ;;
    *) say_bad "aps-environment is '$environment', which is neither development nor production" ;;
  esac
fi

# ── 3. The project knows about it ─────────────────────────────────────────
# An entitlements file the project does not reference is a file. Both
# configurations, because an entitlement on Debug alone is a build that pushes
# while it is being written and silently cannot once it is released.
declared="$(grep -c 'CODE_SIGN_ENTITLEMENTS = Messagr/Messagr.entitlements;' "$PROJECT" 2>/dev/null || echo 0)"
if [ "$declared" -ge 2 ]; then
  say_ok "both build configurations reference the entitlements"
elif [ "$declared" -eq 1 ]; then
  say_bad "only one build configuration references the entitlements: the other cannot push"
else
  say_bad "no build configuration references the entitlements, so it is a file nothing reads"
fi

# ── 4. The two halves that have to agree ──────────────────────────────────
# `aps-environment: production` needs sygnal on `platform: production`, and
# the reverse. A mismatch answers BadDeviceToken and delivers nothing, with
# no other sign. It is not the only road to BadDeviceToken: see 5.
SYGNAL="$ROOT/deploy/messagr-sygnal/sygnal.yaml"
if [ -f "$SYGNAL" ] && [ -f "$ENTITLEMENTS" ]; then
  # Read with sed rather than a YAML parser: PyYAML is not in the standard
  # library and this check must not depend on what a runner image happens to
  # carry. The file is ours and its shape is stable: the `platform:` line
  # inside the `eu.messagr.apns:` block, and nothing else.
  platform="$(sed -n '/^  eu\.messagr\.apns:/,/^  [a-z]/p' "$SYGNAL" \
    | sed -n 's/^    platform: *//p' | head -1)"
  wanted=sandbox
  [ "$environment" = "production" ] && wanted=production
  if [ "$platform" = "$wanted" ]; then
    say_ok "sygnal is on platform '$platform', which matches aps-environment '$environment'"
  else
    say_bad "sygnal is on '$platform' and the build asks for '$environment': Apple would answer BadDeviceToken"
  fi
fi

# ── 5. The token's encoding ───────────────────────────────────────────────
# The application registers the APNs token as `getAPNSToken` hands it over, in
# hexadecimal (`pusher.ts`). sygnal base64-decodes an APNs pushkey unless told
# not to, and then sends Apple 48 bytes that are not the token: BadDeviceToken
# at every push, with the environments perfectly paired. That is how every
# iOS push failed until 15 September 2026 (#325), while check 4 stayed green.
if [ -f "$SYGNAL" ]; then
  convert="$(sed -n '/^  eu\.messagr\.apns:/,/^  [a-z]/p' "$SYGNAL" \
    | sed -n 's/^    convert_device_token_to_hex: *//p' | head -1)"
  if [ "$convert" = "false" ]; then
    say_ok "sygnal takes the hexadecimal APNs token as it is (convert_device_token_to_hex: false)"
  else
    say_bad "sygnal would base64-decode the hexadecimal APNs token: Apple would answer BadDeviceToken"
  fi
fi

if [ "$failed" -ne 0 ]; then
  echo "an iPhone built from this tree could not be woken" >&2
fi
exit "$failed"
