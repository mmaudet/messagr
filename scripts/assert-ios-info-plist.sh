#!/usr/bin/env bash
#
# What Info.plist must say before App Store Connect will take a build.
#
# ITMS-90683, on the first delivery of #109: "Your app's code references one
# or more APIs that access sensitive user data... While your app might not
# use these APIs, a purpose string is still required."
#
# Two rules so far, each learned by having a delivery refused.
#
# ITMS-90683: `react-native-webrtc` references the camera. Messagr does not: this lot is
# audio and video is not offered (#88). Apple asks the string of whoever
# *references* the API, not whoever calls it -- so the obligation follows the
# dependency list, which is what this reads.
#
# WHAT IT COST TO LEARN. The build compiled, signed, validated (`altool
# --validate-app` said VERIFY SUCCEEDED), uploaded, and was refused an hour
# later by an email to an address nobody was watching. Nothing between the
# source and that email had any opinion. This does.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)/.."

failed=0

if ! python3 - "$ROOT" <<'PY'
import json, plistlib, sys

root = sys.argv[1]

# WHAT EACH DEPENDENCY OBLIGES.
#
# Add a package that touches a protected resource and its keys land here, so
# the plist is failed by the same commit that adds the dependency rather than
# by Apple a week later. A package absent from this table obliges nothing --
# which is a claim, and the claim is checked by Apple the first time it is
# wrong.
OBLIGES = {
    'react-native-webrtc': [
        # The library's video paths reference AVCaptureDevice even in an
        # audio-only build, which is exactly the case ITMS-90683 describes.
        'NSCameraUsageDescription',
        'NSMicrophoneUsageDescription',
    ],
    'react-native-image-picker': [
        'NSPhotoLibraryUsageDescription',
        'NSCameraUsageDescription',
    ],
}

manifest = json.load(open(f'{root}/packages/app/package.json'))
declared = set(manifest.get('dependencies', {})) | set(manifest.get('devDependencies', {}))

# READ WITH A STRICT PARSER, AND SAY SO WHEN IT REFUSES.
#
# `plutil -lint` accepts things XML does not -- `--` inside a comment, most
# of all, which this file has grown twice. Xcode builds such a plist happily
# and the failure surfaces somewhere else entirely, so this is the thing that
# notices, and it must name what it found rather than raise a traceback.
try:
    plist = plistlib.load(open(f'{root}/packages/app/ios/Messagr/Info.plist', 'rb'))
except Exception as refused:
    print(f'  FAIL  Info.plist is not well-formed XML: {refused}', file=sys.stderr)
    print('        (plutil -lint is lenient; "--" inside a comment is the usual cause)',
          file=sys.stderr)
    sys.exit(1)

missing, checked = [], 0
for package, keys in OBLIGES.items():
    if package not in declared:
        continue
    for key in keys:
        checked += 1
        value = plist.get(key)
        # Present is not enough: an empty string is a purpose string that
        # explains nothing, and Apple rejects those too.
        if not isinstance(value, str) or len(value.strip()) < 10:
            missing.append(f'{key} (obliged by {package})')

if missing:
    for one in sorted(set(missing)):
        print(f'  FAIL  no usable purpose string for {one}', file=sys.stderr)
    sys.exit(1)
print(f'  OK    {checked} purpose string(s) obliged by dependencies, all declared')
PY
then
  failed=1
fi

# ── The export declaration, which may not be half-made ────────────────────
#
# 90592, on the delivery that tried to answer the export question in the
# build: "Invalid Export Compliance Code. The export compliance key value []
# in the app's Info.plist doesn't match the key value of the app's export
# compliance documentation."
#
# `ITSAppUsesNonExemptEncryption = true` is a pointer to a compliance code,
# and a pointer to nothing is refused. The pair is all-or-nothing: hold the
# code and both go in the plist; hold neither and the question is answered in
# App Store Connect, once per build, by a person.
if ! python3 - "$ROOT" <<'PY'
import plistlib, sys

try:
    plist = plistlib.load(open(f'{sys.argv[1]}/packages/app/ios/Messagr/Info.plist', 'rb'))
except Exception:
    # The check above already named this, and has already failed the run.
    # Reporting it twice, as a traceback, would bury the one line that says
    # what to fix.
    sys.exit(0)
uses = plist.get('ITSAppUsesNonExemptEncryption')
code = plist.get('ITSEncryptionExportComplianceCode')

if uses is True and not (isinstance(code, str) and code.strip()):
    print('  FAIL  ITSAppUsesNonExemptEncryption is true with no '
          'ITSEncryptionExportComplianceCode: App Store Connect answers 90592',
          file=sys.stderr)
    sys.exit(1)
if code and uses is not True:
    print('  FAIL  a compliance code with no ITSAppUsesNonExemptEncryption: '
          'the code points at a declaration that is not made', file=sys.stderr)
    sys.exit(1)
if uses is True:
    print('  OK    the export declaration carries its compliance code')
elif uses is False:
    # The build says what the account said. They are two records of one
    # declaration, and the only failure worth guarding is their disagreeing,
    # which nothing here can see -- so this says which one it is reading.
    print('  OK    the build declares exempt encryption, as the account holder '
          'answered in App Store Connect')
else:
    print('  OK    the export question is left to App Store Connect, which is '
          'where it must go without a compliance code')
PY
then
  failed=1
fi

if [ "$failed" -ne 0 ]; then
  echo "App Store Connect would refuse a build from this tree" >&2
fi
exit "$failed"
