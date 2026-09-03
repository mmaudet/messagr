#!/usr/bin/env bash
#
# The release APK's bundle must be Hermes bytecode, not JavaScript source.
#
# #16's failure was that the release build could not find hermesc, and the
# quickest way out of it was `hermesEnabled=false`, which silently swaps the
# engine for JSC. That is a product decision about startup time and memory,
# not a build fix. Configuration cannot prove which engine an APK ended up
# with, so this reads the artifact: a Hermes bundle is bytecode with a magic
# header, and a JSC one is the JavaScript source itself.
#
# This is the build-time half of the check. The runtime half is the app's own
# `hermes` probe (packages/app/src/runtime/hermes.ts), reported on screen and
# in the log, which answers the same question of the engine actually running.
set -euo pipefail

APK=${1:-packages/app/android/app/build/outputs/apk/release/app-release.apk}

if [ ! -f "$APK" ]; then
  echo "FAIL: no release APK at $APK" >&2
  exit 1
fi

EXTRACT=$(mktemp -d)
trap 'rm -rf "$EXTRACT"' EXIT

unzip -o -q "$APK" assets/index.android.bundle -d "$EXTRACT"
BUNDLE="$EXTRACT/assets/index.android.bundle"

if [ ! -f "$BUNDLE" ]; then
  echo "FAIL: the APK carries no JavaScript bundle at all" >&2
  exit 1
fi

# Hermes bytecode files open with this magic. Read as hex rather than with
# `file`, which does not know the format, and compared on the first four
# bytes, which is the part Hermes itself treats as the identifier; the two
# after it are the bytecode version, which moves with every release.
MAGIC=$(od -An -tx1 -N 4 "$BUNDLE" | tr -d ' \n')

if [ "$MAGIC" != "c61fbc03" ]; then
  echo "FAIL: the release bundle is not Hermes bytecode (magic: ${MAGIC:-empty})" >&2
  echo "      A JavaScript bundle here means the build fell back to JSC." >&2
  echo "      Check react.hermesCommand in packages/app/android/app/build.gradle" >&2
  exit 1
fi

echo "OK: the release APK carries a Hermes bytecode bundle"
