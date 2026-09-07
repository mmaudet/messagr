#!/usr/bin/env bash
#
# The app icon, which nothing else in this repository notices is missing.
#
# `AppIcon.appiconset` held a `Contents.json` listing nine slots and not one
# file. That builds. It installs. It runs. The home screen shows a white
# square and every test stays green -- and then App Store Connect refuses the
# upload with three errors at once (90713, 90022, 90023), which is where it
# was found, one round trip into #109.
#
# Apple's validation is the only thing that was checking, and it only checks
# what has already been built, signed and sent. This checks the source, in
# `checks`, on Linux, in a second.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)/.."
SET="$ROOT/packages/app/ios/Messagr/Images.xcassets/AppIcon.appiconset"
PROJECT="$ROOT/packages/app/ios/Messagr.xcodeproj/project.pbxproj"

failed=0
say_ok() { printf '  OK    %s\n' "$1"; }
say_bad() { printf '  FAIL  %s\n' "$1" >&2; failed=1; }

# ── 1. Every slot the catalogue declares has a file ───────────────────────
# An entry with no `filename` is a slot Xcode compiles to nothing. One is
# enough for Apple to refuse the build, so the count is what is reported --
# "some are missing" would leave somebody guessing which.
if [ ! -f "$SET/Contents.json" ]; then
  say_bad "there is no AppIcon.appiconset: the build has no icon at all"
else
  if ! python3 - "$SET" <<'PY'
import json, os, sys
root = sys.argv[1]
images = json.load(open(os.path.join(root, 'Contents.json'))).get('images', [])
named = [i for i in images if i.get('filename')]
missing = [i.get('filename') for i in named
           if not os.path.exists(os.path.join(root, i['filename']))]
if not images:
    print('  FAIL  the icon catalogue declares no images at all', file=sys.stderr)
    sys.exit(1)
if not named:
    print(f'  FAIL  the icon catalogue has {len(images)} slots and not one file: '
          'the build would carry no icon', file=sys.stderr)
    sys.exit(1)
if missing:
    print(f'  FAIL  the catalogue names files that are not there: {", ".join(missing)}',
          file=sys.stderr)
    sys.exit(1)
print(f'  OK    the icon catalogue has {len(named)} image(s), all present')
PY
  then
    failed=1
  fi
fi

# ── 2. The project compiles the catalogue under that name ─────────────────
# A catalogue the project does not name is a directory. Both configurations,
# for the same reason the entitlements are checked twice: a Debug-only icon
# is an icon that disappears exactly when it is going to be looked at.
declared="$(grep -c 'ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon;' "$PROJECT" 2>/dev/null || echo 0)"
if [ "$declared" -ge 2 ]; then
  say_ok "both build configurations compile AppIcon"
elif [ "$declared" -eq 1 ]; then
  say_bad "only one build configuration compiles AppIcon: the other ships without one"
else
  say_bad "no build configuration names AppIcon, so the catalogue is a directory nothing reads"
fi

if [ "$failed" -ne 0 ]; then
  echo "App Store Connect would refuse a build from this tree" >&2
fi
exit "$failed"
