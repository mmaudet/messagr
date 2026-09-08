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
#
# ═══ THE DEVICE IS NAMED, AND A PHYSICAL ONE IS REFUSED ═══════════════════
#
# Every `adb` call here used to carry no `-s`. With one device attached that
# is fine and it was true when this was written. It is no longer: a laptop
# with the Pixel plugged in and an emulator running gets
#
#     adb: more than one device/emulator
#
# and the script dies halfway through, which is the GOOD outcome. The bad one
# is a laptop with only the Pixel plugged in. Then every line here lands on
# the phone that carries a REAL ACCOUNT: `force-stop` on somebody's messenger,
# and then a store listing showing their conversation and their account
# identifier, published to Google Play.
#
# So the device is named, and a device that is not an emulator is refused
# rather than merely discouraged. The refusal can be lifted with
# MESSAGR_CAPTURE_ALLOW_DEVICE=1, deliberately, by somebody who has read this
# and knows whose account is on the phone.
#
# The discriminant is `ro.boot.qemu`, which is `1` on an emulator and empty on
# hardware. The serial prefix `emulator-` would have been easier and is a
# convention rather than a fact: `adb -s` accepts any serial, and a device
# reachable over TCP does not carry it.
#
# ═══ WHAT THIS SCRIPT CAN AND CANNOT REACH ════════════════════════════════
#
# Two screens, and that is a property of the end-to-end suite rather than a
# choice made here. This script drives the device with `adb`, which can start
# the application and press the hardware back key, and nothing else -- tapping
# at a coordinate is exactly what the comment below refuses, because a layout
# change moves a coordinate and photographs the wrong thing in silence.
#
# Reaching trust, verification, vouching, the invitation, a photograph, a call
# or the settings means navigating by test identifier, and only the Detox
# suite can do that. Today it visits the first-launch promise and the
# conversation, and carries `by.id` for four controls in all. The press kit
# #145 describes is therefore two tickets and not one: this device safety and
# the theme sweep here, and the six remaining screens inside the suite, with
# the identifiers they need.
set -euo pipefail

OUT="${1:-store-screenshots}"
mkdir -p "$OUT"

# ── Choosing the device ───────────────────────────────────────────────────

attached=$(adb devices | tail -n +2 | awk '$2 == "device" { print $1 }')
count=$(printf '%s\n' "$attached" | sed '/^$/d' | wc -l | tr -d ' ')

SERIAL="${MESSAGR_CAPTURE_SERIAL:-${ANDROID_SERIAL:-}}"

if [ -z "$SERIAL" ]; then
  if [ "$count" = "0" ]; then
    echo "capture: FAIL: no device is attached." >&2
    exit 1
  fi
  if [ "$count" != "1" ]; then
    echo "capture: FAIL: $count devices are attached and none was named:" >&2
    printf '%s\n' "$attached" | sed '/^$/d' | sed 's/^/    /' >&2
    echo "  Name one with MESSAGR_CAPTURE_SERIAL=<serial>. This script used to" >&2
    echo "  take whichever adb picked, which on a laptop with a real phone" >&2
    echo "  plugged in meant photographing somebody's actual account." >&2
    exit 1
  fi
  SERIAL=$(printf '%s\n' "$attached" | sed '/^$/d')
fi

if ! printf '%s\n' "$attached" | sed '/^$/d' | grep -qx -- "$SERIAL"; then
  echo "capture: FAIL: $SERIAL is not among the attached devices." >&2
  exit 1
fi

emulated=$(adb -s "$SERIAL" shell getprop ro.boot.qemu 2>/dev/null | tr -d '\r')
if [ "$emulated" != "1" ] && [ "${MESSAGR_CAPTURE_ALLOW_DEVICE:-0}" != "1" ]; then
  echo "capture: FAIL: $SERIAL is a physical device, and this refuses to" >&2
  echo "  photograph one. A phone carries a real account: the conversation," >&2
  echo "  the given names and the account identifier in these screenshots" >&2
  echo "  would be somebody's, published to a store listing or a web page." >&2
  echo "  Captures belong on a bench emulator with bench identities." >&2
  echo "  MESSAGR_CAPTURE_ALLOW_DEVICE=1 lifts this, deliberately." >&2
  exit 1
fi

echo "capture: photographing $SERIAL$([ "$emulated" = 1 ] && echo ' (emulator)')"

shot() {
  adb -s "$SERIAL" shell screencap -p /sdcard/messagr-shot.png
  adb -s "$SERIAL" pull /sdcard/messagr-shot.png "$OUT/$1.png" >/dev/null
  adb -s "$SERIAL" shell rm -f /sdcard/messagr-shot.png
  printf '  captured %s\n' "$OUT/$1.png"
}

# ── The theme, because the dark palette is half the readers ───────────────
#
# `color.dark` is a full second palette in the tokens, one role for one role
# with the light side. A listing and a landing page that only ever show the
# light one are showing half the product.
#
# The mode is put back where it was found. This runs on a bench, and a bench
# left in dark mode makes the NEXT run's light captures dark without anybody
# noticing what changed.
theme_was=$(adb -s "$SERIAL" shell cmd uimode night 2>/dev/null | tr -d '\r' | awk '{print $3}')
remettre_le_theme() {
  [ -n "${theme_was:-}" ] && adb -s "$SERIAL" shell cmd uimode night "$theme_was" >/dev/null 2>&1 || true
}
trap remettre_le_theme EXIT

theme() {
  adb -s "$SERIAL" shell cmd uimode night "$1" >/dev/null
  sleep 2
}

# Relaunched rather than photographed where the suite left it: the last test
# leaves the screen wherever its own gesture did, and a listing should show
# what opening the application shows.
relancer() {
  adb -s "$SERIAL" shell am force-stop eu.messagr
  adb -s "$SERIAL" shell am start -n eu.messagr/.MainActivity >/dev/null
  sleep 25
}

for mode in no yes; do
  suffixe=$([ "$mode" = no ] && echo clair || echo sombre)
  theme "$mode"
  relancer

  # An account with one room opens into that room, which is what a person
  # arriving by invitation sees first.
  shot "01-conversation-$suffixe"

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
  adb -s "$SERIAL" shell input keyevent KEYCODE_BACK
  sleep 3
  shot "02-conversations-$suffixe"
done

# THE NAMES GAINED A SUFFIX, AND NOTHING READS THEM BY NAME. Checked rather
# than assumed: `publish.py` globs `*.json` and never mentions a screenshot,
# and `device.yml` uploads the whole directory as one artifact. A person takes
# the four files from that artifact and chooses which pair a store shows.

# ── AND THEN: ARE THEY SCREENS AT ALL? ────────────────────────────────────
#
# The first run of this version, on a bench where Metro was listening and
# `eu.messagr/.MainActivity` was the top resumed activity, produced four files
# and printed "store screenshots captured". All four were the same blank white
# 1080x2400 rectangle, byte for byte identical across both themes and both
# screens.
#
# Nothing above can notice that. This script stops the application, starts it,
# waits, and photographs whatever is there; its one guarantee is that it runs
# after a green suite, and that guarantee is about BEHAVIOUR the tests checked,
# not about what the screen was showing at the instant of `screencap`.
node "$(dirname "$0")/assert-captures.mjs" "$OUT"

echo "store screenshots captured"
