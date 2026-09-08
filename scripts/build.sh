#!/usr/bin/env bash
#
# Both telephones, one gesture.
#
#   ./scripts/build.sh            # Android onto the Pixel, then iOS to TestFlight
#   ./scripts/build.sh android    # only the Pixel
#   ./scripts/build.sh ios        # only TestFlight
#
# WHY THIS EXISTS. The two platforms were two procedures with nothing in
# common except the working tree they build from, and each had a trap of its
# own: `assembleDebug` does not build the JavaScript (`pixel.sh` says what
# that cost), and an iOS build number that is not new is refused by App Store
# Connect after a ten-minute archive. Asked for on 8 September 2026: « il
# serait plus simple de lancer des builds qui construit ios et Android ».
#
# ANDROID FIRST, DELIBERATELY. It takes two minutes and needs the telephone
# plugged in; iOS takes twenty and needs nothing but this machine. Running
# the one that can be interrupted first means an unplugged cable costs two
# minutes rather than twenty-two -- which is not hypothetical: it happened,
# at the install step, at the end of an Android build.
#
# WHAT IT REFUSES TO DO. It does not commit, tag, or push. A build is a thing
# you do to look at something; deciding that what you looked at is a release
# is a separate gesture with a separate audience.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)/.."
IOS="$ROOT/packages/app/ios"
PROJECT="$IOS/Messagr.xcodeproj/project.pbxproj"
WHICH="${1:-both}"

case "$WHICH" in
  both | android | ios) ;;
  *)
    echo "usage: $0 [both|android|ios]" >&2
    exit 2
    ;;
esac

# The App Store Connect identifiers, kept outside this repository because it
# is public. `publish-ios.sh` says the same about the .p8 beside them.
if [ -f "$HOME/.appstoreconnect/env" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.appstoreconnect/env"
fi

if [ "$WHICH" != "ios" ]; then
  echo
  echo "#### ANDROID ####"
  "$ROOT/scripts/pixel.sh"
fi

if [ "$WHICH" != "android" ]; then
  echo
  echo "#### iOS ####"

  # THE BUILD NUMBER, RAISED HERE RATHER THAN REMEMBERED BY A PERSON.
  #
  # App Store Connect refuses a build whose (version, build) pair it has seen
  # -- at the upload, after the archive, which is twenty minutes to learn
  # something a `sed` knows. Both configurations move together: Debug and
  # Release carry the field separately and a build signed from one and
  # numbered from the other is a build nobody can find.
  CURRENT="$(grep -m1 -oE 'CURRENT_PROJECT_VERSION = [0-9]+' "$PROJECT" | grep -oE '[0-9]+')"
  NEXT=$((CURRENT + 1))
  echo "==> build number $CURRENT -> $NEXT"
  sed -i '' "s/CURRENT_PROJECT_VERSION = $CURRENT;/CURRENT_PROJECT_VERSION = $NEXT;/g" "$PROJECT"

  # Archive, export, read what was exported, validate, send. The reading is
  # the step that catches an `aps-environment: development` slipping through,
  # which is a tester whose telephone never rings and nothing that says why.
  "$ROOT/scripts/publish-ios.sh"

  echo
  echo "iOS build $NEXT is with Apple. The bump is in the working tree and"
  echo "is not committed: commit it with whatever else this build carries."
fi
