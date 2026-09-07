#!/usr/bin/env bash
# deploy/messagr-eu/deploy.sh — publishes the messagr.eu site and vhost.
#
# IDEMPOTENT, like the gestures documented in deploy/messagr-eu-invitations.md:
# every step first checks whether its work is already done. Every change to
# the vhost is preceded by a dated backup, validated by `nginx -t`, and nginx
# is reloaded only if something changed.
#
# Run from the repository root:  deploy/messagr-eu/deploy.sh
set -euo pipefail
cd "$(dirname "$0")"

HOST=hermes
SITE_DIR=/var/www/messagr-eu-site
VHOST=/etc/nginx/sites-available/messagr-eu

# THE DOWNLOAD IS ONE FIXED ADDRESS, and it is not configurable on purpose.
# An operator who could type the address could type one with no file behind
# it; here the address is derived from the act of publishing the file.
APK_NAME=messagr.apk
APK_URL="https://messagr.eu/$APK_NAME"

# ── The gates, before anything reaches the server ────────────────────────
#
# Both also run in `make check`. They run again HERE because this script is
# the last place a wrong value can still be stopped, and the two files they
# guard are cached hard once served: iOS keeps the AASA on the device, and
# Android re-verifies app links only on install and on update.
#
# doctrine-app-links.js carries the APPLE_TEAM_ID guard this script used to
# hold on its own, and adds the one that was missing: no fingerprint may be
# served unless android-fingerprints.json records which key produced it.
# On 9 August 2026 the served fingerprint came from a file placed on this
# server by hand, matched no key anyone could find, and nothing noticed for
# a week.
node tests/doctrine-app-links.js
node tests/destinations-page-invitation.js

# THE DESTINATION COMES FROM THE DEPLOYMENT, NEVER FROM THE LINK.
#
# No link ever issued goes stale when these change: that is the whole reason
# the destination is configured here rather than carried in the invitation.
# Unset means the waiting sentence, which is the honest state today — the
# application is published in no store.
MESSAGR_DEST_IOS="${MESSAGR_DEST_IOS:-}"
MESSAGR_DEST_ANDROID="${MESSAGR_DEST_ANDROID:-}"

# ── The direct download, and why the page cannot advertise a missing file ─
#
# MESSAGR_APK is a PATH TO A FILE, never an address. The page's download
# slot is filled only by the branch that publishes that file in the same
# run, so "the page offers a download" and "a download exists" are one fact
# and not two that could drift apart.
#
# MESSAGR_APK=none withdraws it: the file is removed and the page goes back
# to the waiting sentence, together.
MESSAGR_APK="${MESSAGR_APK:-}"
MESSAGR_DEST_ANDROID_APK=""

apk_on_server=$(ssh "$HOST" "test -f $SITE_DIR/$APK_NAME && echo yes || echo no")

if [ "$MESSAGR_APK" = "none" ]; then
  # The removal happens AFTER the page stops naming the file, further down.
  echo "== the direct download will be withdrawn"
elif [ -n "$MESSAGR_APK" ]; then
  if [ ! -f "$MESSAGR_APK" ]; then
    echo "deploy: FAIL: MESSAGR_APK is not a file: $MESSAGR_APK" >&2
    exit 1
  fi
  MESSAGR_DEST_ANDROID_APK="$APK_URL"
elif [ "$apk_on_server" = "yes" ]; then
  # THE ONE THAT KEEPS THEM IN STEP. A deployment that says nothing about
  # the download would leave the file served and the page saying the
  # application is not published yet — a page lying about a download sitting
  # one directory away.
  echo "deploy: FAIL: $SITE_DIR/$APK_NAME is served, and this run offers" >&2
  echo "  no download, so the page would say the application is not" >&2
  echo "  published yet while the file is still there." >&2
  echo "  Pass MESSAGR_APK=<path to the apk> to keep it, or" >&2
  echo "  MESSAGR_APK=none to withdraw the file and the offer together." >&2
  exit 1
fi

# The committed page always holds the empty defaults, so it is valid and
# testable on its own; the substitution happens on a COPY, never in the
# tree. build-site.sh verifies that every value it was given actually landed
# and runs the page doctrine on its output — see its header for the silent
# `sed` this replaced.
poussee=$(mktemp -d)
trap 'rm -rf "$poussee"' EXIT
MESSAGR_DEST_IOS="$MESSAGR_DEST_IOS" \
MESSAGR_DEST_ANDROID="$MESSAGR_DEST_ANDROID" \
MESSAGR_DEST_ANDROID_APK="$MESSAGR_DEST_ANDROID_APK" \
  ./build-site.sh site "$poussee"

chmod -R u=rwX,go=rX "$poussee"

ssh "$HOST" "sudo mkdir -p $SITE_DIR/i $SITE_DIR/.well-known"

# THE FILE GOES UP BEFORE THE PAGE THAT NAMES IT, AND COMES DOWN AFTER.
# The order is the whole guarantee: there is no instant, in either
# direction, at which the page offers a download the server does not have.
# Reversed, adding one would open a window where the link 404s, and removing
# one would open the same window at the other end.
if [ -n "$MESSAGR_DEST_ANDROID_APK" ]; then
  echo "== apk → $HOST:$SITE_DIR/$APK_NAME"
  rsync -av --checksum --rsync-path="sudo rsync" \
    "$MESSAGR_APK" "$HOST:$SITE_DIR/$APK_NAME"
fi

# THE `chmod` BELOW IS NOT CAUTION, IT IS A PRODUCTION OUTAGE ALREADY PAID FOR.
# On 18 August 2026 this script pushed `i/index.html` at mode 600 and
# `https://messagr.eu/i` answered 403: nginx runs as another user and could no
# longer read the page. The cause is not here but upstream, in the umask of the
# machine running `build-site.sh`: the files are born inside a `mktemp -d` with
# the developer's own bits, and `rsync -a` preserves them faithfully, including
# when they are unusable on the server. A mode that is right on a laptop and
# wrong on hermes.
#
# The wanted mode is therefore IMPOSED before sending rather than inherited.
# NOT by `rsync --chmod`, which is a GNU option: macOS ships rsync 2.6.9, which
# answers "invalid argument" and fails the whole deployment from a laptop. Same
# family as the `cp -R` in tests/destinations-page-invitation.js, green on macOS
# and red in CI.
#
# WHAT THE GATE DID AND WHAT IT COULD NOT DO. This script's own final check did
# catch the outage, by refusing to conclude. But it catches AFTER the files are
# live, and the page stayed broken in between. A permission check before the
# send would be earlier; it is not written here.
# THE WHOLE TREE, BY SHAPE. AND THE SAME DEFECT, ONE LAYER DOWN.
#
# This was three commands: `i/` by name, `.well-known/` by name, and then the
# root's files with `--exclude='*/'` to leave those two alone. Its comment said
# the exclusion "leaves the two directories above to the two lines that already
# own them", and that was true when there were two.
#
# `confidentialite/` and `conditions-generales/` were added to the site since.
# They are excluded by `*/` and named by no line, so THEY HAVE NEVER BEEN
# UPLOADED BY THIS SCRIPT. Measured on the server on 7 September 2026:
#
#     index.html, i/, .well-known/, the marks   2026-09-07 12:30
#     conditions-generales/index.html           2026-09-05 04:57
#     confidentialite/index.html                2026-09-05 05:07
#
# Everything else was deployed that morning; the legal pages had not moved in
# two days, through every deployment in between. The privacy policy served was
# the one from before #102 -- it still claimed "il n'existe aucun tiers dans
# cette application" while the application carried Firebase Cloud Messaging --
# and no deployment could have fixed it.
#
# This is `build-site.sh`'s own defect, one layer down and unfixed. That script
# copied `i/` and `.well-known/` BY NAME, so the two legal directories were
# built into nothing; it was fixed on 18 August by copying by shape. The pages
# have been built correctly ever since, and uploaded nowhere.
#
# One command, no exclusion. Without `--delete`, so `messagr.apk` -- which
# lives on the server and not in the build -- stays where the block above put
# it.
echo "== site → $HOST:$SITE_DIR"
# rsync --checksum: only files actually modified are pushed.
rsync -av --checksum --rsync-path="sudo rsync" \
  "$poussee/" "$HOST:$SITE_DIR/"

if [ "$MESSAGR_APK" = "none" ]; then
  echo "== withdrawing $HOST:$SITE_DIR/$APK_NAME"
  ssh "$HOST" "sudo rm -f $SITE_DIR/$APK_NAME"
fi

echo "== vhost"
if ssh "$HOST" "sudo cmp -s $VHOST -" < nginx-messagr-eu.conf; then
  echo "vhost already up to date, nothing to do"
else
  ssh "$HOST" "sudo cp -a $VHOST $VHOST.avant-$(date +%Y%m%d-%H%M%S)"
  ssh "$HOST" "sudo tee $VHOST >/dev/null" < nginx-messagr-eu.conf
  ssh "$HOST" "sudo nginx -t"
  ssh "$HOST" "sudo systemctl reload nginx"
  echo "vhost updated and nginx reloaded"
fi

echo "== verification"
for url in \
  "https://messagr.eu/" \
  "https://messagr.eu/i" \
  "https://messagr.eu/i/verification-deploiement" \
  "https://messagr.eu/.well-known/apple-app-site-association" \
  "https://messagr.eu/.well-known/assetlinks.json"; do
  printf '%s -> ' "$url"
  curl -s -o /dev/null -w '%{http_code} %{content_type} redirect=%{redirect_url}\n' -m 10 "$url"
done

# THE PAGE IS IDENTICAL FOR EVERY TOKEN, and this is where that is CHECKED
# rather than asserted. The property is what makes the page reveal nothing:
# valid, revoked, expired or made up, the answer must not differ by one byte,
# or the answer itself becomes an existence oracle.
a=$(curl -s -m 10 "https://messagr.eu/i/aaaaaaaaaaaaaaaa")
b=$(curl -s -m 10 "https://messagr.eu/i/bbbbbbbbbbbbbbbb")
if [ -z "$a" ]; then
  echo "deploy: FAIL: the page serves nothing" >&2
  exit 1
elif [ "$a" != "$b" ]; then
  echo "deploy: FAIL: the page varies with the token — that is an oracle" >&2
  exit 1
fi
echo "no existence oracle: two made-up tokens, one identical answer"

# ── The page and the download say the same thing, MEASURED ───────────────
#
# Everything above happens before the server answers. This is the last check
# and the only one that reads what a visitor gets: the page as served, and
# the file it names.
served=$(curl -s -m 10 "https://messagr.eu/i/verification-deploiement")
offered=no
if printf '%s' "$served" | grep -q -F -- "$APK_URL"; then offered=yes; fi

# What this run MEANT to offer. Compared against what is actually served,
# so a substitution that went wrong between here and the server is caught by
# the server's own answer rather than by this script trusting itself.
intended=no
if [ -n "$MESSAGR_DEST_ANDROID_APK" ]; then intended=yes; fi

if [ "$offered" != "$intended" ]; then
  echo "deploy: FAIL: this run meant to offer a download: $intended," >&2
  echo "  and the served page offers one: $offered." >&2
  exit 1
fi

if [ "$offered" = "yes" ]; then
  code=$(curl -s -o /dev/null -w '%{http_code}' -m 60 -I "$APK_URL")
  if [ "$code" != "200" ]; then
    echo "deploy: FAIL: the page offers $APK_URL and the server answers $code." >&2
    echo "  Somebody following the download would get nothing." >&2
    exit 1
  fi
  echo "the offered download answers 200"
else
  echo "no download offered, and the page says so"
fi

# ── AND THE WHOLE SITE, FILE BY FILE, AS THE SERVER ANSWERS IT ───────────
#
# The block above reads one page and one download. This reads all of them,
# and it is the last thing that happens because it is the only one that can
# say the deployment as a whole landed.
#
# It exists because of what was true on 7 September 2026: messagr.eu served
# a landing page `master` did not contain, and a privacy policy that had
# lost a section `master` had gained. Both had been that way for a day or
# more, both were invisible to every check in this repository, and the
# reason is that no check had ever asked the server anything.
#
# Run here it answers the narrower of the two questions -- did THIS run land
# what it built -- and that is worth having on its own. The wider one, does
# the server match `master`, is the same script run from `master`.
#
# THE DESTINATIONS ARE PASSED, and that is what makes this run strict. Given
# them, the check builds the page with them and compares byte for byte; given
# nothing it falls back to tolerating any plain https address in those three
# slots. Tolerating any address here would accept somebody else's store at the
# exact moment we know which one we just put there.
echo "== the served site against the built one"
MESSAGR_DEST_IOS="$MESSAGR_DEST_IOS" \
MESSAGR_DEST_ANDROID="$MESSAGR_DEST_ANDROID" \
MESSAGR_DEST_ANDROID_APK="$MESSAGR_DEST_ANDROID_APK" \
  node tests/conformite-site-deploye.js --live "https://messagr.eu"
