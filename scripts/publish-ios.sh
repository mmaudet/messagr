#!/usr/bin/env bash
#
# An archive, a check, and a TestFlight build -- with no window open.
#
# `publishing-ios.md` described the Organizer, because the first upload was
# going to be made by hand. It was made by this instead, on 7 September 2026,
# and what it learned on the way is the reason each step is here rather than
# in a list of clicks somebody has to follow again.
#
# THE ORDER IS THE ARGUMENT.
#
# Archive, export, *read what was exported*, validate, send. The reading is
# the step a single `destination: upload` would have skipped, and it is the
# only one that can catch the failure this whole ticket is about: an archive
# comes out carrying `aps-environment: development` whatever the entitlements
# say, because automatic signing intersects them with a development profile.
# The export re-signs and `production` returns -- which is a claim, and claims
# about push environments are checked here, not assumed.
#
#   ./scripts/build.sh ios          # raises the build number, then this
#   ./scripts/publish-ios.sh        # this alone, at whatever number is set
#
# The two identifiers are read from ~/.appstoreconnect/env when it exists,
# and can still be given in the environment:
#
#   ASC_KEY_ID=...  ASC_ISSUER_ID=...  ./scripts/publish-ios.sh
#
# That file and the .p8 beside it live in ~/.appstoreconnect/ at chmod 600.
# Never in this repository: `.gitignore` refuses *.p8, and the repository is
# public.
set -euo pipefail

if [ -f "$HOME/.appstoreconnect/env" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.appstoreconnect/env"
fi

ROOT="$(cd "$(dirname "$0")" && pwd)/.."
IOS="$ROOT/packages/app/ios"
KEY_ID="${ASC_KEY_ID:-}"
ISSUER_ID="${ASC_ISSUER_ID:-}"
KEY_PATH="${ASC_KEY_PATH:-$HOME/.appstoreconnect/private_keys/AuthKey_${KEY_ID}.p8}"
WORK="${ASC_WORK_DIR:-$(mktemp -d)}"

if [ -z "$KEY_ID" ] || [ -z "$ISSUER_ID" ]; then
  echo "ASC_KEY_ID and ASC_ISSUER_ID must be set." >&2
  echo "Put them in ~/.appstoreconnect/env (chmod 600), two lines:" >&2
  echo "  ASC_KEY_ID=..." >&2
  echo "  ASC_ISSUER_ID=..." >&2
  echo "Both are on App Store Connect -> Users and Access -> Integrations -> Keys;" >&2
  echo "the Issuer ID is above the table, the Key ID is in the .p8 filename." >&2
  exit 2
fi
if [ ! -f "$KEY_PATH" ]; then
  echo "no key at $KEY_PATH" >&2
  echo "Download it once from that same page and chmod 600 it there." >&2
  exit 2
fi

AUTH=(-allowProvisioningUpdates
      -authenticationKeyPath "$KEY_PATH"
      -authenticationKeyID "$KEY_ID"
      -authenticationKeyIssuerID "$ISSUER_ID")

echo "==> archiving (this registers the App ID and mints the profile if needed)"
xcodebuild -workspace "$IOS/Messagr.xcworkspace" \
  -scheme Messagr -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$WORK/Messagr.xcarchive" \
  "${AUTH[@]}" archive

echo "==> exporting a signed .ipa"
xcodebuild -exportArchive \
  -archivePath "$WORK/Messagr.xcarchive" \
  -exportOptionsPlist "$IOS/ExportOptions.plist" \
  -exportPath "$WORK/export" \
  "${AUTH[@]}"

IPA="$WORK/export/Messagr.ipa"

# THE STEP THAT EXISTS BECAUSE THE ARCHIVE LIED.
# Not a formality: it reads the file that is about to be sent, and a
# `development` entitlement here means a tester whose phone never rings and
# nothing anywhere that says why.
echo "==> reading what would be uploaded"
"$ROOT/scripts/assert-ipa-push.sh" "$IPA"

echo "==> validating with App Store Connect"
xcrun altool --validate-app -f "$IPA" -t ios \
  --apiKey "$KEY_ID" --apiIssuer "$ISSUER_ID"

echo "==> uploading"
xcrun altool --upload-app -f "$IPA" -t ios \
  --apiKey "$KEY_ID" --apiIssuer "$ISSUER_ID"

echo
echo "Uploaded. Apple takes five to thirty minutes to process it, then the"
echo "build appears in TestFlight. Inviting a tester is still a gesture in"
echo "App Store Connect -- see publishing-ios.md step 4."
