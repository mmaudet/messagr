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
#
# IT HAS SINCE GROWN A SIXTH CHECK OF THE OPPOSITE KIND. Checks 1 to 5 are
# things that must happen for a push to arrive. Check 6 is a thing that must
# NOT happen while it does: Google's code being in the iPhone at all (#334).
# It lives here rather than in a file of its own because whoever would delete
# it is whoever is fixing push.
#
# CHECK 6 USED TO READ A KEY, AND THE KEY GUARDED NOTHING.
# `FirebaseMessagingAutoInitEnabled: false` was the documented lever, and
# reading FirebaseMessaging 12.18.0 established that its three reading points
# are all out of this application's reach (#361): the request that carries the
# APNs token to Google leaves from `setAPNSToken:withUserInfo:`, which never
# consults it. So the pods left the iOS target instead, and this now checks
# that they stay out.
#
# THE FOURTH PART IS THE ONE THAT MATTERS, and it is not the obvious one.
# Reading the lock says where this tree is now. Reading the exclusion in
# `packages/app/react-native.config.js` says where it will be after the next
# `pod install` -- and without that file `use_native_modules!` links every
# package carrying a podspec, the twelve pods come back, and NOTHING GOES RED:
# a build with Firebase in it compiles exactly as well as one without. Same
# shape as check 3, where an entitlements file the project does not reference
# is a file.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)/.."
IOS="$ROOT/packages/app/ios"
PLIST="$IOS/Messagr/Info.plist"
ENTITLEMENTS="$IOS/Messagr/Messagr.entitlements"
PROJECT="$IOS/Messagr.xcodeproj/project.pbxproj"

# TWO TALLIES, BECAUSE THE TWO FAILURES ARE NOT THE SAME SENTENCE. A missing
# entitlement means nobody is woken. Firebase back in the iOS target means
# everybody is woken and Google is told about it. Reporting either one under
# the other's summary line would send a reader to the wrong file.
failed=0
noisy=0
say_ok() { printf '  OK    %s\n' "$1"; }
say_bad() { printf '  FAIL  %s\n' "$1" >&2; failed=1; }
say_noisy() { printf '  FAIL  %s\n' "$1" >&2; noisy=1; }

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

# ── 6. And the one thing that must NOT happen ─────────────────────────────
# Nothing of Google's in the iPhone. Four readings, and the last is what keeps
# the other three true tomorrow. See the header.
#
# WHAT THIS PROVES, WHICH IS LESS THAN THE PROMISE. It proves this tree builds
# an application carrying no Firebase pod, no configuration file for one and
# no call to configure one, and that a `pod install` cannot quietly put them
# back. It does NOT prove that nothing reaches Google from a telephone: only a
# device with its traffic observed can, and #334 says exactly what to watch.
# So this check is a floor and not the answer, and must not be quoted as one.
CONFIG="$ROOT/packages/app/react-native.config.js"
LOCK="$IOS/Podfile.lock"
APPDELEGATE="$IOS/Messagr/AppDelegate.swift"

# 6a. The configuration file, and the project that would bundle it.
# `FirebaseApp.configure()` raises without this plist, so a build carrying one
# is a build somebody meant to configure Firebase in.
if [ -e "$IOS/Messagr/GoogleService-Info.plist" ]; then
  say_noisy "GoogleService-Info.plist is back in the iOS target: this build would configure Firebase"
elif grep -q 'GoogleService-Info' "$PROJECT" 2>/dev/null; then
  say_noisy "the Xcode project still names GoogleService-Info.plist, so a file put back beside it would be bundled"
else
  say_ok "no GoogleService-Info.plist, and the Xcode project names none"
fi

# 6b. The pods themselves, read from the lock. `Pods/` is not in this
# repository and does not exist on this runner; the lock is what CI compares
# against a fresh install anyway (`device.yml`), so it is the binding copy.
pods="$(sed -n '/^PODS:/,/^DEPENDENCIES:/p' "$LOCK" 2>/dev/null \
  | sed -n 's/^  - "\{0,1\}\([A-Za-z0-9_+-]*\).*/\1/p' \
  | grep -E '^(Firebase|Google|RNFB|nanopb|PromisesObjC|FBLPromises)' \
  | sort -u | tr '\n' ' ')"
if [ -z "$pods" ]; then
  say_ok "Podfile.lock locks no pod of Firebase's family"
else
  say_noisy "Podfile.lock locks Firebase again: $pods"
fi

# 6c. The call. A pod that came back would do nothing without this, and a call
# left behind after the pods went would not compile -- so this is the half
# that says the removal was meant rather than merely survived.
if grep -qE 'FirebaseCore|FirebaseApp' "$APPDELEGATE" 2>/dev/null; then
  say_noisy "AppDelegate.swift reaches for FirebaseCore again"
else
  say_ok "AppDelegate.swift configures no Firebase application"
fi

# 6d. AND THE ONE THAT KEEPS THE OTHER THREE TRUE. Both packages, both named,
# both with iOS nulled. `use_native_modules!` links whatever it is not told to
# leave alone, and it is told here or nowhere.
if [ ! -f "$CONFIG" ]; then
  say_noisy "packages/app/react-native.config.js is gone: the next pod install would link Firebase into the iPhone again, in silence"
else
  unexcluded=""
  for package in "@react-native-firebase/app" "@react-native-firebase/messaging"; do
    if ! python3 "$ROOT/scripts/lib/ios-excluded.py" "$CONFIG" "$package"; then
      unexcluded="$unexcluded $package"
    fi
  done
  if [ -z "$unexcluded" ]; then
    say_ok "react-native.config.js keeps both Firebase packages off the iOS target"
  else
    say_noisy "react-native.config.js does not exclude$unexcluded from iOS: a pod install would link Firebase back in"
  fi
fi

if [ "$failed" -ne 0 ]; then
  echo "an iPhone built from this tree could not be woken" >&2
fi
if [ "$noisy" -ne 0 ]; then
  echo "an iPhone built from this tree would carry Firebase, which the privacy page says it does not" >&2
fi
if [ "$failed" -ne 0 ] || [ "$noisy" -ne 0 ]; then
  exit 1
fi
exit 0
