#!/usr/bin/env bash
#
# Store screenshots, taken from a device that just proved the application
# works rather than drawn to look like it.
#
# Play requires at least two phone screenshots. Mocking them up is the usual
# answer and it is the wrong one here: a listing shows what somebody will get,
# and the surest way to keep that true is to photograph the thing itself, on
# the run that just asserted its behaviour.
#
# It runs only after a green suite, so a screenshot can never show a state the
# tests did not accept.
set -euo pipefail

OUT="${1:-store-screenshots}"
mkdir -p "$OUT"

shot() {
  adb shell screencap -p /sdcard/messagr-shot.png
  adb pull /sdcard/messagr-shot.png "$OUT/$1.png" >/dev/null
  adb shell rm -f /sdcard/messagr-shot.png
  printf '  captured %s\n' "$OUT/$1.png"
}

# Relaunched rather than photographed where the suite left it: the last test
# leaves the readout scrolled somewhere arbitrary, and a screenshot should
# show what opening the application shows.
adb shell am force-stop eu.messagr
adb shell am start -n eu.messagr/.MainActivity >/dev/null
sleep 25

# The conversation sits at the top of the readout, which is what a person
# opening the application sees first.
shot 01-conversation

# Then the state below it: what the device proved about itself. Honest for a
# version distributed to testers, and it will be replaced by a second product
# screen as soon as there is one.
adb shell input swipe 540 1600 540 400 400
sleep 2
shot 02-etat

echo "store screenshots captured"
