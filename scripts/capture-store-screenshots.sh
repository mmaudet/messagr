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
# leaves the screen wherever its own gesture did, and a listing should show
# what opening the application shows.
adb shell am force-stop eu.messagr
adb shell am start -n eu.messagr/.MainActivity >/dev/null
sleep 25

# An account with one room opens into that room, which is what a person
# arriving by invitation sees first.
shot 01-conversation

# TWO PRODUCT SCREENS NOW, AND THAT IS #105.
#
# The second shot used to scroll down and photograph the diagnostic readout --
# "what the device proved about itself", honest for a build handed to testers
# and never right for a store listing. This script's own comment said it would
# be replaced by a second product screen as soon as there was one. There is.
#
# The hardware back key rather than a tap at a coordinate: the application
# handles it, unwinding one level at a time, so this asks for "the screen
# behind this one" instead of guessing where a control was drawn. A layout
# change moves a coordinate and would silently photograph the wrong thing.
adb shell input keyevent KEYCODE_BACK
sleep 3
shot 02-conversations

echo "store screenshots captured"
