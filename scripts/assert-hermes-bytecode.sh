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
# asserted by the boot suite, which answers the same question of the engine
# actually running.
set -euo pipefail

# Derived from this script's own location, like assert-no-crypto-wasm.sh
# beside it, so it runs from any working directory rather than only from the
# repository root the CI step happens to use.
ROOT=$(cd "$(dirname "$0")/.." && pwd)
APK="$ROOT/packages/app/android/app/build/outputs/apk/release/app-release.apk"

if [ ! -f "$APK" ]; then
  echo "FAIL: no release APK at $APK" >&2
  echo "      Build it first: (cd packages/app/android && ./gradlew :app:assembleRelease)" >&2
  exit 1
fi

EXTRACT=$(mktemp -d)
trap 'rm -rf "$EXTRACT"' EXIT

# `|| true`, and the emptiness decided by the file's absence below: unzip
# exits 11 when the named member is not in the archive, which under `set -e`
# would end the script here with `caution: filename not matched` and never
# reach the message that says what actually went wrong.
unzip -o -q "$APK" assets/index.android.bundle -d "$EXTRACT" 2>/dev/null || true
BUNDLE="$EXTRACT/assets/index.android.bundle"

if [ ! -f "$BUNDLE" ]; then
  echo "FAIL: the APK carries no JavaScript bundle at all" >&2
  exit 1
fi

# Hermes bytecode opens with a 64-bit magic, 0x1F1903C103BC1FC6, which on disk
# reads c6 1f bc 03 c1 03 19 1f. All eight bytes are the identifier; the
# bytecode version is a separate word after it, and is deliberately not
# checked here so a Hermes upgrade does not fail this. Read with `od`, which
# behaves the same on a developer's BSD userland and on CI's GNU one, rather
# than with `file`, which does not know the format.
MAGIC=$(od -An -tx1 -N 8 "$BUNDLE" | tr -d ' \n')

if [ "$MAGIC" != "c61fbc03c103191f" ]; then
  echo "FAIL: the release bundle is not Hermes bytecode (magic: ${MAGIC:-empty})" >&2
  echo "      A JavaScript bundle here means the build fell back to JSC." >&2
  echo "      Check react.hermesCommand in packages/app/android/app/build.gradle" >&2
  exit 1
fi

echo "OK: the release APK carries a Hermes bytecode bundle"
