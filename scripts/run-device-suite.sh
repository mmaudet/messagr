#!/usr/bin/env bash
#
# Runs the Detox suite and, when it fails, prints the application's own
# account of what happened into the job log.
#
# # Why this is a file rather than a few lines in the workflow
#
# It was a few lines in the workflow, and they did not run.
# `android-emulator-runner` hands its `script:` to `sh` a line at a time, so
# a multi-line `|| { ... }` block reached the shell as an unterminated brace
# and failed with a syntax error -- after a nine-minute build, and reported
# as a suite failure rather than as the shell error it was.
#
# A file has one more property that matters here: `bash -n` can check it, so
# the same mistake cannot reach continuous integration again.
#
# # Why the log is printed at all
#
# Three rounds went into learning that an emulator had no network. The
# application had said so on its own screen -- "the invitation service could
# not be reached" -- while the job showed thirteen crypto assertions failing
# for no stated reason, and provisioning had succeeded from the runner, so
# nothing above hinted at a network problem. The only way to see it was to
# download an artifact and open a screenshot.
set -uo pipefail

cd "$(dirname "$0")/../packages/app"

npx detox test --configuration android.emu.debug
status=$?

# Only on a green suite: a screenshot of a state the tests refused would be a
# listing showing something nobody should get.
if [ "$status" -eq 0 ] && [ "${MESSAGR_CAPTURE_STORE:-0}" = "1" ]; then
  ../../scripts/capture-store-screenshots.sh "../../store-screenshots" || true
fi

if [ "$status" -ne 0 ]; then
  echo "──────── what the application itself reported ────────"
  adb logcat -d 2>/dev/null | grep -E 'MESSAGR|ReactNativeJS' | tail -40 || true
  echo "─────────────────────────────────────────────────────"
fi

exit "$status"
