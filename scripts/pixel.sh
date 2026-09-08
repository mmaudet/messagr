#!/usr/bin/env bash
#
# The demonstration Pixel, updated in one gesture.
#
# WHY THIS EXISTS, AND THE HOUR IT COST.
#
# `assembleDebug` does not build the JavaScript. React Native's Gradle plugin
# leaves `bundleInDebug` off, because a debug build is meant to load its code
# from Metro over the network -- and the demonstration Pixel is not on Metro,
# it carries its own copy at `android/app/src/main/assets/index.android.bundle`.
#
# So the APK packages whatever that file happens to hold. It is git-ignored,
# it is written only by an explicit `react-native bundle`, and nothing warns
# when it is old. On 8 September 2026 a build was made, installed, and
# reported working -- and the telephone was running JavaScript from an
# earlier day: the account holder looked for the new emoji picker and found
# the six keys it replaced. Every native change had shipped; not one line of
# product code had.
#
# Bundle, assemble, install, in that order and never one without the others.
#
# NEVER `adb install` WITHOUT `-r`, AND NEVER `uninstall`. That telephone's
# account and room keys live in its application data; the predecessor
# repository's AGENTS.md §7.2 freezes it on its signature for exactly this
# reason. An update keeps the data. A reinstall is a lost identity, which is
# what #190 is about.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)/.."
APP="$ROOT/packages/app"
APK="$APP/android/app/build/outputs/apk/debug/app-debug.apk"
SERIAL="${MESSAGR_PIXEL_SERIAL:-}"

DEVICE=()
if [ -n "$SERIAL" ]; then DEVICE=(-s "$SERIAL"); fi

echo "==> bundling the JavaScript (the step assembleDebug does not do)"
cd "$APP"
npx react-native bundle \
  --platform android \
  --dev false \
  --entry-file index.js \
  --bundle-output android/app/src/main/assets/index.android.bundle \
  --assets-dest android/app/src/main/res

echo "==> assembling the debug APK"
cd "$APP/android"
./gradlew assembleDebug -q

echo "==> installing as an update"
adb "${DEVICE[@]}" install -r "$APK"

echo "done. The telephone is running the working tree."
