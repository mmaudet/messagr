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

ANDROID_SKIPPED=no
if [ "$WHICH" != "ios" ]; then
  echo
  echo "#### ANDROID ####"
  # AN UNPLUGGED TELEPHONE MUST NOT TAKE THE iOS BUILD DOWN WITH IT.
  #
  # Android runs first so that a cable pulled out costs two minutes rather
  # than twenty-two -- but under `set -e` that turned "the Pixel is not
  # plugged in" into "no TestFlight build either", which is the opposite of
  # the point. It happened the first time somebody ran `build.sh` while the
  # cable was out. So a missing telephone is reported and the run carries on;
  # only `build.sh android` treats it as the failure it then is.
  if "$ROOT/scripts/pixel.sh"; then
    :
  elif [ "$WHICH" = "android" ]; then
    exit 1
  else
    ANDROID_SKIPPED=yes
    echo
    echo "Android did not finish -- carrying on to iOS, which needs no telephone."
  fi
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

  # A STABLE DIRECTORY, so a failed upload does not cost the archive.
  # `altool` fetches a file from Apple in the middle of the transfer, and a
  # network that blinks there ends twenty minutes of work with "The file
  # doesn't exist" -- build 14, and build 16 again today. Keeping the .ipa
  # means the retry is the transfer alone.
  WORK="$ROOT/.build/ios"
  mkdir -p "$WORK"
  export ASC_WORK_DIR="$WORK"

  # Archive, export, read what was exported, validate, send. The reading is
  # the step that catches an `aps-environment: development` slipping through,
  # which is a tester whose telephone never rings and nothing that says why.
  if "$ROOT/scripts/publish-ios.sh"; then
    echo
    echo "iOS build $NEXT is with Apple. The bump is in the working tree and"
    echo "is not committed: commit it with whatever else this build carries."

    # WHAT WENT INTO IT, WRITTEN DOWN WHERE SOMEBODY CAN FIND IT.
    #
    # Two builds went out on 11 September 2026 carrying no record of what was
    # in them, and the account holder asked for one. `release-notes.mjs`
    # argues the shape; the short version is that every pull request is
    # squash-merged, so the commit log already IS the list.
    #
    # AFTER the upload and never before: a release for a build Apple refused
    # would be a tag pointing at something that does not exist, and this
    # repository would then have to learn to delete tags.
    #
    # Neither of the two steps below is allowed to fail the build. The
    # artefact is with Apple by now; a changelog that did not publish is a
    # command to run again, not a build to redo.
    # LES ÉTIQUETTES D'ABORD, comme le fait la moitié Android. Sans elles
    # le compteur du dépôt repart d'où il croit en être, et un `build-<n>`
    # déjà poussé serait réattribué -- ce que seul le `git push` découvrirait,
    # une fois l'artefact parti chez Apple.
    git -C "$ROOT" fetch --tags --quiet || true

    NOTES="$WORK/notes-$NEXT.md"
    if node "$ROOT/scripts/release-notes.mjs" ios "$NEXT" > "$NOTES"; then
      node "$ROOT/scripts/release-notes.mjs" ios "$NEXT" --publish ||
        echo "The release was not published. Run it again when convenient."

      # AND INTO « What to Test », which needs Apple to have finished
      # processing -- five to thirty minutes. The wait is bounded and its
      # timeout says so rather than reading as a credential problem.
      node "$ROOT/scripts/testflight-notes.mjs" "$NEXT" \
        --notes-file "$NOTES" --wait 1800 ||
        echo "
« What to Test » was not filled in. Nothing is wrong with the build; run:

    node scripts/testflight-notes.mjs $NEXT --notes-file $NOTES
"
    else
      echo "
No changelog: no build-* tag carries an iOS build yet, so there is nothing to
measure from. For the first one, give it a floor and publish by hand:

    node scripts/release-notes.mjs ios $NEXT --since <ref> --publish
"
    fi
  else
    echo
    echo "The iOS step failed. The archive is kept at $WORK, so if it got as"
    echo "far as VERIFY SUCCEEDED, this re-sends it without rebuilding:"
    echo
    echo "    ASC_WORK_DIR=$WORK ./scripts/publish-ios.sh --upload-only"
    echo
    echo "Build $NEXT stays the number: it was never accepted, so do not bump."
    exit 1
  fi
fi

if [ "$ANDROID_SKIPPED" = yes ]; then
  echo
  echo "The telephone was not updated. Plug the Pixel in and run:"
  echo
  echo "    ./scripts/build.sh android"
  exit 1
fi
