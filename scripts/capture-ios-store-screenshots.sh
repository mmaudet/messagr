#!/usr/bin/env bash
#
# The screenshots App Store Connect refuses to publish 1.0 without, taken from
# a simulator running the build that is going to be submitted.
#
# The Android half of this is `capture-store-screenshots.sh`, and its argument
# is the argument here: "a listing shows what somebody will get, and the surest
# way to keep that true is to photograph the thing itself". Nothing below draws
# anything. It boots a simulator, installs the `.app` that was built for the
# simulator, launches it, and photographs what appears.
#
# ═══ THE DEVICE IS MADE HERE, WHICH IS HOW A REAL ONE IS REFUSED ══════════
#
# The Android script names its device because a laptop can have an emulator
# and the Pixel attached at once, and `adb` with no `-s` picks whichever it
# likes -- which on the Pixel means force-stopping somebody's messenger and
# publishing their conversation and their account identifier to a store.
#
# The same danger exists here and takes a different shape, so it is refused in
# a different way: this script CREATES the simulator it photographs, boots it,
# and deletes it at the end. A device that did not exist a minute ago carries
# no account, no conversation and no given name, and there is nothing to
# mistake it for. `xcrun simctl` cannot address a physical iPhone at all --
# that is `devicectl` -- so the only way to reach one from here would be to
# name it, and naming one is what the check below refuses.
#
# MESSAGR_CAPTURE_SIMULATEUR lifts the "make it here" rule for somebody who
# wants an existing simulator. It is then resolved against the list of
# AVAILABLE SIMULATORS and anything absent from that list is refused; if
# `devicectl` recognises the identifier, the refusal says so in as many words.
# The default is refusal, so a `devicectl` that fails cannot open the door.
#
# ═══ NO KEYSTROKE, NO TAP, AND ON iOS THAT IS TWO REASONS ═════════════════
#
# The Android script refuses to tap at a coordinate because a layout change
# moves a coordinate and photographs the wrong thing in silence. That reason
# holds here.
#
# The second one is iOS's own and it is lived: KEYSTROKES AIMED AT A SIMULATOR
# LAND WHEREVER THE KEYBOARD FOCUS IS, and that has been the operator's own
# terminal. Driving this simulator by keyboard would type into whatever window
# happens to be in front.
#
# So this script never opens Simulator.app. `xcrun simctl boot` runs the device
# headless: there is no window, which means there is nothing a keystroke could
# be aimed at. That is a structural guarantee rather than a rule somebody has
# to keep, and it is the reason the boot is headless rather than a preference.
#
# ═══ WHAT THIS REACHES, AND WHAT IT DOES NOT ══════════════════════════════
#
# ONE SCREEN: the promise, which is what a fresh install shows and the only
# screen that can be reached without touching the interface. Everything behind
# it is behind the "Begin" button -- `FirstLaunch.tsx` gates it on the terms
# box, deliberately, and a gate that can be walked past is not a gate.
#
# That is the same kind of fact as the Android script's "two screens": there,
# it is a property of the Detox suite, which navigates by test identifier and
# leaves the application somewhere real. Here there is no such run at all --
# `.detoxrc.js` marks the `ios.release` configuration UNVERIFIED, it needs
# applesimutils, and continuous integration runs the suite on Android for a
# tenth of the billed minutes. The day an iOS suite exists, this script can
# photograph what it leaves on screen, exactly as the Android one does.
#
# NO THEME SWEEP, AND THAT IS A FACT ABOUT THE APPLICATION RATHER THAN A GAP.
# The Android script photographs light and dark. This application does not read
# the system's colour scheme anywhere: four components did, they turned dark
# inside screens that stayed pale, and the reading was removed
# (`NotchedButton.tsx` carries the account). The promise screen is `ink900`
# whatever the phone is set to -- `FirstLaunch.tsx` says so in as many words.
# Two captures under two appearances would be the same image, and the check at
# the end would refuse them, correctly.
#
# NO LANGUAGE SWEEP EITHER, AND THAT ONE WAS TRIED BEFORE IT WAS GIVEN UP.
# The listing's primary language is French and the application speaks seven, so
# one capture per language would have been worth having, and there are two ways
# to ask a simulator for a language without typing anything. Both were measured
# on 16 September 2026, against the Release build of 15 September:
#
#   `-AppleLanguages "(en)" -AppleLocale en_GB` as launch arguments, which land
#   in NSUserDefaults' argument domain -- the two captures came out BYTE FOR
#   BYTE IDENTICAL to the French ones, and the check at the end said so.
#
#   `AppleLanguages` and `AppleLocale` written into the device's own
#   `.GlobalPreferences.plist` before its first boot, set to German -- the
#   application still opened in French.
#
# So the application does not follow the device's language on iOS at all. It
# opens on `readChosenLanguage`'s last resort, which is French by name
# (`chosenLanguage.ts`), and that is a defect in the product rather than in
# this script: a German iPhone meeting a French screen is the exact thing that
# file's comment says it exists to prevent. That is #353, and nothing here
# works around it -- a capture script that made the product look
# like it behaves differently than it does would be the mockup this refuses to
# draw.
#
# One capture per class, then, in the language the application actually shows.
#
# ═══ IT DOES NOT BUILD, AND WILL NOT ══════════════════════════════════════
#
# An archive costs twenty minutes and several gigabytes, and `build.sh` exists
# for it. This reuses the simulator build that is already on the machine, at
# the path `.detoxrc.js` already names, and refuses with that same command
# when there is none. A capture script that rebuilds is a capture script
# nobody runs.
set -euo pipefail

OUT="${1:-store-screenshots-ios}"
ROOT="$(cd "$(dirname "$0")" && pwd)/.."
BUNDLE=eu.messagr

# ── What the simulators cost, measured before they are made ───────────────
#
# A booted simulator device is about 1.9 GiB, measured on 16 September 2026
# over three of them. They are created one at a time and deleted as soon as
# their class is done, so the peak is one device and the application beside
# it -- but a disk that fills mid-run leaves a half-booted device behind and
# a failure that reads as anything but its cause.
LIBRE_GIO=$(df -g / | awk 'NR == 2 { print $4 }')
PLANCHER_GIO="${MESSAGR_CAPTURE_PLANCHER_GIO:-5}"
if [ "$LIBRE_GIO" -lt "$PLANCHER_GIO" ]; then
  echo "captures: FAIL: $LIBRE_GIO Gio libres sur /, il en faut $PLANCHER_GIO." >&2
  echo "  Un simulateur démarré pèse environ 1,9 Gio, et ce script en crée un" >&2
  echo "  par classe, l'un après l'autre. Faire de la place, ou baisser le" >&2
  echo "  plancher en connaissance de cause avec MESSAGR_CAPTURE_PLANCHER_GIO." >&2
  exit 1
fi

# ── The application, reused rather than rebuilt ───────────────────────────
#
# Release rather than Debug: the Release simulator build carries
# `main.jsbundle` inside the bundle, so it launches with no Metro listening.
# A Debug build would load its JavaScript from a dev server this script does
# not start, and would show a red screen or nothing at all.
APP="${MESSAGR_CAPTURE_APP:-$ROOT/packages/app/ios/build/Build/Products/Release-iphonesimulator/Messagr.app}"
if [ ! -d "$APP" ]; then
  echo "captures: FAIL: aucune build simulateur à $APP" >&2
  echo "  Ce script ne construit pas : une archive coûte vingt minutes et" >&2
  echo "  plusieurs gigaoctets, et rien ici ne justifie de les dépenser deux" >&2
  echo "  fois. C'est la commande que .detoxrc.js nomme déjà, depuis" >&2
  echo "  packages/app :" >&2
  echo >&2
  echo "    xcodebuild -workspace ios/Messagr.xcworkspace -scheme Messagr \\" >&2
  echo "      -configuration Release -destination 'generic/platform=iOS Simulator' \\" >&2
  echo "      -derivedDataPath ios/build build" >&2
  echo >&2
  echo "  MESSAGR_CAPTURE_APP=<chemin> en désigne une autre." >&2
  exit 1
fi
if [ ! -f "$APP/main.jsbundle" ]; then
  echo "captures: FAIL: $APP ne porte pas main.jsbundle." >&2
  echo "  C'est une build Debug : son JavaScript vient d'un serveur Metro que" >&2
  echo "  ce script ne lance pas, et l'écran photographié serait rouge ou" >&2
  echo "  vide. Construire en Release, comme ci-dessus." >&2
  exit 1
fi

# ── The classes, and the simulator that stands for each ───────────────────
#
# One line per Apple screenshot class, then the device names that produce its
# accepted pixel sizes, most recent first. Names rather than device type
# identifiers: an identifier carries the memory configuration
# (`…iPad-Pro-13-inch-M5-12GB`) and moves with the Xcode release, while the
# name is what `simctl list devicetypes` prints and what a person recognises.
#
# The fallbacks are not decoration. Each class needs ONE device type that the
# installed runtime still supports, and Apple drops old models from new
# runtimes every year. The measurement that matters, made on this machine on
# 16 September 2026 against iOS 26.5, is that `iPhone 11 Pro Max` is still
# there: it creates, it boots, and it screenshots at 1242x2688, which is one
# of the two sizes Apple accepts for a 6.5-inch display.
CLASSES_CONNUES='iphone-6.9|iPhone 17 Pro Max;iPhone 16 Pro Max;iPhone 15 Pro Max
iphone-6.5|iPhone 11 Pro Max;iPhone XS Max
ipad-13|iPad Pro 13-inch (M5);iPad Pro 13-inch (M4);iPad Pro (12.9-inch) (6th generation)'

# Both iPhone classes by default, and that is not belt and braces. Apple makes
# 6.5 required only when 6.9 is absent, and makes 6.9 optional; which of the
# two slots the console insists on has moved before. Producing both costs one
# device and two launches, and neither slot can then be the one that blocks a
# submission.
CLASSES="${MESSAGR_CAPTURE_CLASSES:-iphone-6.9 iphone-6.5 ipad-13}"

# ── Nothing this run made is left behind ──────────────────────────────────
#
# Including on a failure, and including on a ctrl-c: a simulator abandoned
# booted holds its 1.9 Gio and keeps running. The list only ever holds
# devices this run created or was handed, and the delete is guarded by that
# same list -- a name is never matched, so no simulator of the operator's can
# be deleted by a collision.
TRAVAIL=$(mktemp -d)
CREES=""
A_ETEINDRE=""
nettoyer() {
  rm -rf "$TRAVAIL"
  for udid in $A_ETEINDRE; do
    xcrun simctl shutdown "$udid" >/dev/null 2>&1 || true
  done
  for udid in $CREES; do
    xcrun simctl delete "$udid" >/dev/null 2>&1 || true
  done
}
trap nettoyer EXIT INT TERM

# ── Resolving a device type and a runtime, by name ────────────────────────

runtime_le_plus_recent() {
  xcrun simctl list runtimes --json | python3 -c '
import json, sys

runtimes = [
    r
    for r in json.load(sys.stdin)["runtimes"]
    if r.get("isAvailable") and r["identifier"].find("iOS") != -1
]
if not runtimes:
    sys.exit(1)


def clef(r):
    return [int(n) for n in r["version"].split(".") if n.isdigit()]


print(max(runtimes, key=clef)["identifier"])
'
}

type_pour_la_classe() {
  # Prints the device type identifier of the first name in the list that this
  # installation knows about, and nothing at all when none of them exists.
  xcrun simctl list devicetypes --json | python3 -c '
import json, sys

voulus = sys.argv[1].split(";")
connus = {t["name"]: t["identifier"] for t in json.load(sys.stdin)["devicetypes"]}
for nom in voulus:
    if nom in connus:
        print(connus[nom] + "\t" + nom)
        break
' "$1"
}

# ── A simulator somebody else made, if they insist ────────────────────────
#
# The account danger the Android script describes has a smaller version here:
# a simulator that has been used for real work carries a session, and a
# session is a Megolm identity. Uninstalling the application to get back to a
# first launch would destroy it, and a lost Megolm session makes that device's
# rooms unreadable to it for good. So this refuses rather than uninstalls.
verifier_le_simulateur_nomme() {
  nomme="$1"
  udid=$(xcrun simctl list devices available --json | python3 -c '
import json, sys

voulu = sys.argv[1]
for runtime, devices in json.load(sys.stdin)["devices"].items():
    for d in devices:
        if voulu in (d["udid"], d["name"]):
            print(d["udid"])
            raise SystemExit(0)
' "$nomme")

  if [ -z "$udid" ]; then
    echo "captures: FAIL: « $nomme » n'est pas un simulateur disponible." >&2
    if xcrun devicectl list devices 2>/dev/null | grep -qF -- "$nomme"; then
      echo "  C'EST UN APPAREIL RÉEL, et ce script refuse d'en photographier" >&2
      echo "  un. Un iPhone porte un vrai compte : la conversation, les" >&2
      echo "  prénoms et l'identifiant de quelqu'un partiraient sur une fiche" >&2
      echo "  de magasin. Les captures se prennent sur un simulateur, et ce" >&2
      echo "  script en fabrique un tout seul quand on ne lui en nomme aucun." >&2
    else
      echo "  xcrun simctl list devices available les énumère." >&2
    fi
    exit 1
  fi

  if xcrun simctl get_app_container "$udid" "$BUNDLE" app >/dev/null 2>&1; then
    echo "captures: FAIL: $BUNDLE est déjà installée sur $nomme." >&2
    echo "  Deux raisons de s'arrêter là. La capture ne montrerait pas le" >&2
    echo "  premier lancement, seul écran atteignable sans toucher à" >&2
    echo "  l'interface. Et désinstaller pour y revenir détruirait la session" >&2
    echo "  de cet appareil : une session Megolm perdue rend ses salons" >&2
    echo "  illisibles pour toujours. À désinstaller à la main, en sachant ce" >&2
    echo "  qu'on perd, ou à laisser ce script fabriquer le sien." >&2
    exit 1
  fi

  echo "$udid"
}

# ── The capture itself ────────────────────────────────────────────────────

photographier() {
  # Le bruit de `simctl io` est retenu plutôt que jeté : il annonce sur quel
  # écran il a tiré, ce qui n'intéresse personne, mais il dit aussi quand il
  # n'a pas tiré du tout -- et un `2>/dev/null` transformerait ce refus en
  # fichier manquant trois lignes plus bas, loin de sa cause.
  if ! bruit=$(xcrun simctl io "$1" screenshot "$2" 2>&1); then
    echo "captures: FAIL: simctl io screenshot a refusé :" >&2
    printf '%s\n' "$bruit" | sed 's/^/    /' >&2
    exit 1
  fi
}

# WAITING FOR A SCREEN RATHER THAN FOR A NUMBER OF SECONDS.
#
# The Android script sleeps twenty-five seconds after a launch, which is the
# thing that photographs a splash screen on a slow morning and a real screen
# on a fast one, with nothing to tell the two apart.
#
# Here the clock is pinned to 9:41 by the status bar override below, so two
# screenshots of a screen that is not moving are byte for byte identical. That
# makes "it has settled" a fact this can wait for: shoot every three seconds
# and stop when three in a row agree AND the result is not the Home screen the
# witness holds. An application that never came up leaves the springboard
# there, and this says so instead of photographing it.
#
# THREE IN A ROW RATHER THAN TWO, AND THAT IS #351'S OWN INCIDENT. The
# first run of this script produced a perfectly sharp promise screen with a
# system notification slid over the top of it -- « Prêt pour Apple
# Intelligence », posted by Settings a minute or so after a freshly created
# device boots. Two consecutive shots three seconds apart had agreed, because
# a banner sits there for about five seconds, and the file was ready to be
# uploaded to a store with Apple's own advertisement across the product.
#
# Nothing downstream could have seen it. The size was right, the bytes were
# plentiful, the capture differed from its witness: every check said yes. Six
# seconds of stillness is longer than a banner lasts, so the banner breaks the
# run and the loop keeps going until the screen is the product's again.
attendre_un_ecran_stable() {
  udid="$1"
  cible="$2"
  temoin="${3:-}"
  limite="${MESSAGR_CAPTURE_LIMITE:-120}"
  immobiles="${MESSAGR_CAPTURE_IMMOBILES:-3}"
  # Hors du répertoire de sortie : le contrôle final lit tous les `*.png` qu'il
  # y trouve, et un cliché de travail abandonné là par une interruption serait
  # mesuré comme une capture de magasin.
  precedent="$TRAVAIL/precedent.png"
  ecoule=0
  suite=1

  rm -f "$precedent"
  while [ "$ecoule" -lt "$limite" ]; do
    sleep 3
    ecoule=$((ecoule + 3))
    photographier "$udid" "$cible"

    if [ -f "$precedent" ] && cmp -s "$precedent" "$cible"; then
      suite=$((suite + 1))
    else
      suite=1
    fi
    cp "$cible" "$precedent"

    if [ "$suite" -ge "$immobiles" ]; then
      if [ -z "$temoin" ] || ! cmp -s "$temoin" "$cible"; then
        rm -f "$precedent"
        return 0
      fi
    fi
  done

  rm -f "$precedent"
  if [ -n "$temoin" ] && cmp -s "$temoin" "$cible"; then
    echo "captures: FAIL: après $limite s l'écran est encore celui de" >&2
    echo "  l'accueil du simulateur. L'application n'est pas venue, ou elle" >&2
    echo "  est repartie -- une build Debug sans Metro fait exactement ça." >&2
  else
    echo "captures: FAIL: après $limite s l'écran n'est pas resté immobile" >&2
    echo "  $immobiles clichés de suite, alors que l'heure est figée à 9:41." >&2
    echo "  Quelque chose s'anime ou revient : $cible le montre." >&2
  fi
  exit 1
}

# ── The run ───────────────────────────────────────────────────────────────

mkdir -p "$OUT" "$OUT/temoins"

RUNTIME=$(runtime_le_plus_recent) || {
  echo "captures: FAIL: aucun runtime iOS installé." >&2
  echo "  Xcode -> Settings -> Components en installe un." >&2
  exit 1
}
echo "captures: runtime $RUNTIME"
echo "captures: application $APP"

NOMME="${MESSAGR_CAPTURE_SIMULATEUR:-}"
if [ -n "$NOMME" ]; then
  # One device, so one class, and the operator says which. Said rather than
  # guessed: the check at the end holds the claim against the pixels, so a
  # wrong answer fails loudly instead of mislabelling a file that a person
  # then uploads into the wrong slot of the console.
  if [ -z "${MESSAGR_CAPTURE_CLASSE:-}" ]; then
    echo "captures: FAIL: MESSAGR_CAPTURE_SIMULATEUR sans MESSAGR_CAPTURE_CLASSE." >&2
    echo "  Nommer la classe Apple de cet appareil : iphone-6.9, iphone-6.5" >&2
    echo "  ou ipad-13. Le contrôle final vérifie la réponse sur les pixels." >&2
    exit 1
  fi
  CLASSES="$MESSAGR_CAPTURE_CLASSE"
fi

for classe in $CLASSES; do
  noms=$(printf '%s\n' "$CLASSES_CONNUES" | awk -F'|' -v c="$classe" '$1 == c { print $2 }')
  if [ -z "$noms" ]; then
    echo "captures: FAIL: classe inconnue « $classe »." >&2
    printf '%s\n' "$CLASSES_CONNUES" | awk -F'|' '{ print "    " $1 }' >&2
    exit 1
  fi

  if [ -n "$NOMME" ]; then
    UDID=$(verifier_le_simulateur_nomme "$NOMME")
    MODELE="$NOMME"
    A_ETEINDRE="$A_ETEINDRE $UDID"
  else
    trouve=$(type_pour_la_classe "$noms")
    if [ -z "$trouve" ]; then
      echo "captures: FAIL: aucun appareil de la classe $classe n'existe ici." >&2
      echo "  Cherchés, dans l'ordre : $(printf '%s' "$noms" | tr ';' ',')" >&2
      echo "  xcrun simctl list devicetypes dit lesquels Xcode connaît." >&2
      exit 1
    fi
    TYPE=$(printf '%s' "$trouve" | cut -f1)
    MODELE=$(printf '%s' "$trouve" | cut -f2)
    UDID=$(xcrun simctl create "messagr-captures-$classe" "$TYPE" "$RUNTIME")
    CREES="$CREES $UDID"
    A_ETEINDRE="$A_ETEINDRE $UDID"
  fi

  echo
  echo "captures: $classe -- $MODELE ($UDID)"

  # `-b` démarre l'appareil s'il ne l'est pas, donc `boot` juste avant est
  # redondant -- et il échoue sur un appareil déjà démarré, ce qu'un
  # simulateur nommé par le porteur a toutes les chances d'être.
  xcrun simctl bootstatus "$UDID" -b >/dev/null

  # THE STATUS BAR, PINNED. Apple's own listings read 9:41, full signal and a
  # charged battery, and a store screenshot carrying a real clock and a
  # half-empty battery says "somebody photographed their laptop". It earns its
  # place twice over: a frozen clock is also what makes two screenshots of a
  # still screen identical, which is what `attendre_un_ecran_stable` waits for.
  if ! bruit=$(xcrun simctl status_bar "$UDID" override \
    --time "9:41" --batteryState charged --batteryLevel 100 \
    --cellularBars 4 --wifiBars 3 2>&1); then
    echo "captures: la barre d'état n'a pas pu être figée : $bruit" >&2
    echo "  L'heure réelle apparaîtra dans les captures et l'attente d'un" >&2
    echo "  écran stable peut expirer. Ce n'est pas une raison de s'arrêter." >&2
  fi

  # THE WITNESS, TAKEN BEFORE THE APPLICATION IS THERE.
  #
  # This is the Android lesson turned into an assertion. That bench once
  # produced four identical blank rectangles and printed "captured", and what
  # settled it was photographing the system's own home screen: the same blank
  # frame came back, so the fault was the bench and not the application.
  # Taking that shot every time makes the comparison automatic. It is what
  # proves the device renders at all, and it is what the check at the end
  # holds every capture against -- a capture equal to it is the springboard.
  # Pris avec la même attente d'immobilité que les captures, et pas d'un seul
  # coup : un appareil qui vient de démarrer finit de dessiner son écran
  # d'accueil, et un témoin pris au milieu de ça ne ressemblerait à l'écran
  # d'accueil d'aucun instant suivant -- ce qui rendrait muette la seule
  # comparaison capable de dire « l'application n'est jamais venue ».
  attendre_un_ecran_stable "$UDID" "$OUT/temoins/$classe.png"
  printf '  témoin   %s\n' "$OUT/temoins/$classe.png"

  xcrun simctl install "$UDID" "$APP"

  xcrun simctl launch "$UDID" "$BUNDLE" >/dev/null

  cible="$OUT/01-promesse-$classe.png"
  attendre_un_ecran_stable "$UDID" "$cible" "$OUT/temoins/$classe.png"
  printf '  capturé  %s\n' "$cible"

  xcrun simctl terminate "$UDID" "$BUNDLE" >/dev/null 2>&1 || true

  # Deleted as soon as its class is done, so the peak is one device rather
  # than three.
  xcrun simctl shutdown "$UDID" >/dev/null 2>&1 || true
  if [ -z "$NOMME" ]; then
    xcrun simctl delete "$UDID" >/dev/null 2>&1 || true
    CREES=$(printf '%s' "$CREES" | sed "s/ $UDID//")
  fi
  A_ETEINDRE=$(printf '%s' "$A_ETEINDRE" | sed "s/ $UDID//")
done

# ── AND THEN: ARE THEY THE SIZES APPLE ACCEPTS? ───────────────────────────
#
# Nothing above can tell. `simctl io screenshot` writes whatever the device
# renders, at whatever definition that device has, and a class resolved to the
# wrong model produces a perfectly good screenshot the console refuses. The
# dimensions are Apple's, so they are checked against Apple's.
echo
node "$(dirname "$0")/assert-ios-captures.mjs" "$OUT"

echo "captures iOS prises"
