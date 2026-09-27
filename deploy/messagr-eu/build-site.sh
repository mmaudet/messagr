#!/usr/bin/env bash
# deploy/messagr-eu/build-site.sh — produces the site that will be served.
#
#   build-site.sh <source site directory> <destination directory>
#
# WHY THIS IS A SCRIPT OF ITS OWN AND NOT SIX LINES INSIDE deploy.sh.
# Until 16 August 2026 the destinations were substituted by deploy.sh with
#
#   sed -i '' -e "s|ios: ''|ios: '$MESSAGR_DEST_IOS'|" ...
#
# and `sed` EXITS ZERO WHEN IT SUBSTITUTES NOTHING. Rename the slot in the
# page, or change one space, and the operator who sets MESSAGR_DEST_IOS sees
# a green deployment and serves "the application is not published yet" to
# everyone holding a working invitation. Nothing anywhere would have said so.
#
# Everything risky about the deployment that does NOT need a server now lives
# here, so it can be run on a laptop and in CI:
# deploy/messagr-eu/tests/destinations-page-invitation.js drives THIS SCRIPT
# for every configuration and reads what the built page shows.
#
# THREE THINGS ARE HELD, and each one is a way the page could lie:
#
#   1. A slot named in the page but absent -> refused. No silent no-op.
#   2. A value given but not landed -> refused. The check is on the OUTPUT.
#   3. A value that is not a plain https address -> refused. The substitution
#      lands inside a JavaScript string literal: a quote there is not a typo,
#      it is code.
#
# And then the page doctrine runs on the BUILT page. Before this script it
# only ever ran on the committed one -- the page that carries no address at
# all -- so the allow-list of foreign origins had never seen a single real
# destination.
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: build-site.sh <source site directory> <destination directory>" >&2
  exit 2
fi

source_dir=$1
destination=$2
here=$(cd "$(dirname "$0")" && pwd)

[ -d "$source_dir/i" ] || { echo "build-site: FAIL: no $source_dir/i" >&2; exit 1; }

mkdir -p "$destination"

# EVERY DIRECTORY, BY SHAPE. This named `i/` and `.well-known/`, which was
# true when they were the only two -- and then `confidentialite/` and
# `conditions-generales/` were added to the site and were built into nothing.
# Google follows the privacy link during review and a 404 fails it without
# saying why, so the failure would have been a rejected application rather
# than a missing page.
#
# The same defect the root files already had and were fixed for on 18 August
# 2026, one line below, and it was worth fixing the same way rather than
# adding two more names.
find "$source_dir" -mindepth 1 -maxdepth 1 -type d -exec cp -R {} "$destination/" \;

# THE FILES AT THE ROOT, AND THEY WERE MISSED UNTIL 18 AUGUST 2026. This script
# copied `i/` and `.well-known/` by name, so a page added at the site root was
# built into nothing and deployed to nowhere. `https://messagr.eu/` answered 403
# for the whole life of the site: no index, and nginx refuses rather than lists.
# Copied by SHAPE rather than by name from here on, so the next file added at
# the root is carried without anyone remembering to add a line.
find "$source_dir" -maxdepth 1 -type f -exec cp {} "$destination/" \;

# ── LA VERSION À VENIR DES PAGES LÉGALES (#412) ─────────────────────────
#
# Un changement de la politique de confidentialité ou des conditions
# générales paraît trente jours avant de s'appliquer, à côté de la version en
# vigueur : la page promet qu'« un changement est annoncé avant d'être
# appliqué ». La version à venir attend dans `<page>/a-venir/index.html`, et
# la version en vigueur l'annonce dans un passage entre `<!-- a-venir -->` et
# `<!-- /a-venir -->`.
#
# LA DATE, C'EST LE PORTEUR QUI LA FIXE, en annonçant (`version-a-venir.mjs`).
# D'ici là, les deux portent la marque ci-dessous à la place de la date, et
# rien de ce qui la porte n'est servi : la page à venir n'est pas construite,
# et le passage qui l'annonce est retiré de la version en vigueur. Un site
# construit avant l'annonce est donc celui d'aujourd'hui, exactement, et un
# déploiement fait pour autre chose ne publie rien d'avance.
#
# ET RIEN DE CONSTRUIT NE PORTE LA MARQUE : vérifié sur la sortie, puisqu'une
# page qui dirait « s'appliquera le MESSAGR-DATE-A-VENIR » serait publiée
# fausse.
marque='MESSAGR-DATE-A-VENIR'
for venir in "$destination"/*/a-venir/index.html; do
  [ -f "$venir" ] || continue
  if grep -qF -- "$marque" "$venir"; then
    rm -r "$(dirname "$venir")"
    echo "build-site: $(basename "$(dirname "$(dirname "$venir")")")/a-venir/ is not announced yet, and is not built"
  fi
done
# The passage is removed by the same expression `version-a-venir.mjs` reads
# it with, over the whole page rather than line by line: a line-by-line
# reading that met both marks on one line would skip to the end of the page,
# and build a page cut short without a word.
for page in "$destination"/*/index.html; do
  grep -qF -- '<!-- a-venir -->' "$page" || continue
  grep -qF -- "$marque" "$page" || continue
  perl -0777 -pi -e 's/[ \t]*<!-- a-venir -->.*?<!-- \/a-venir -->[ \t]*\n?//gs' "$page"
done
if grep -rlF -- "$marque" "$destination" >/dev/null; then
  echo "build-site: FAIL: a built page still carries $marque:" >&2
  grep -rlF -- "$marque" "$destination" >&2
  echo "  A date that was never set would be published as it stands." >&2
  exit 1
fi

# THE BRAND MARKS ARE COPIED FROM `design/brand/`, NOT DUPLICATED INTO
# `site/`. That directory is authoritative for the visual and read-only: a
# second copy under `site/` would be a second truth, and the two would
# disagree the first time one moved. Copied at build time instead, so the page
# always serves what the brand directory holds today.
#
# It was `identite/` in the previous repository. The directory came across
# under `design/`, beside the tokens and the icons, because one place for the
# visual is the point of the rule.
brand="$(cd "$(dirname "$0")/../.." && pwd)/design/brand"
for asset in messagr-logotype-vert.svg messagr-logotype-vert-inverse.svg \
             messagr-monogramme-r-vert.svg \
             messagr-bulle-entrante.svg messagr-bulle-sortante.svg; do
  [ -f "$brand/$asset" ] || { echo "build-site: FAIL: missing brand asset $asset" >&2; exit 1; }
  cp "$brand/$asset" "$destination/$asset"
done

# ── UNE PAGE PAR LANGUE, ÉCRITE ICI ET NON DEVINÉE PAR LE NAVIGATEUR ──────
#
# La page d'accueil parlait six langues à une seule adresse : un moteur
# n'indexait que le français, il n'y avait aucun `hreflang`, et « la page en
# allemand » n'était pas une chose qu'on pouvait envoyer à quelqu'un.
#
# Le générateur écrit les cinq autres à côté de la française et pose les liens
# entre les six. Il refuse une clé marquée dans la page et absente du
# catalogue, l'inverse, et un remplacement sans effet -- les trois manières
# dont une page allemande se retrouverait avec une phrase française au milieu,
# sans que la construction s'en aperçoive.
node "$here/build-landing.mjs" "$destination"

page="$destination/i/index.html"

# THE DESTINATION COMES FROM THE DEPLOYMENT, NEVER FROM THE LINK. No link
# ever issued goes stale when these change: that is the whole reason the
# address is configured here rather than carried in the invitation. Unset
# means the waiting sentence, which is the honest answer while the
# application is published nowhere.
MESSAGR_DEST_IOS="${MESSAGR_DEST_IOS:-}"
MESSAGR_DEST_ANDROID="${MESSAGR_DEST_ANDROID:-}"
MESSAGR_DEST_ANDROID_APK="${MESSAGR_DEST_ANDROID_APK:-}"

fill() {
  slot=$1
  value=$2
  marker="$slot: ''"

  # The slot must exist EXACTLY ONCE. Zero means the page was renamed under
  # this script; more than one means the substitution would hit a place
  # nobody meant it to.
  count=$(grep -c -F -- "$marker" "$page" || true)
  if [ "$count" != "1" ]; then
    echo "build-site: FAIL: the page holds the slot \`$marker\` $count time(s)," >&2
    echo "  expected exactly once. A renamed slot makes every substitution a" >&2
    echo "  silent no-op, and the deployment would look perfectly fine." >&2
    exit 1
  fi

  [ -n "$value" ] || return 0

  # A plain https address and nothing else. The value is written between two
  # single quotes in a JavaScript literal, so a quote, a backslash or an
  # angle bracket is an escape from the literal, not a malformed link.
  if ! printf '%s' "$value" | grep -Eq '^https://[A-Za-z0-9._~:/?#@!$&()*+,;=%-]+$'; then
    echo "build-site: FAIL: $slot is not a plain https address:" >&2
    echo "    $value" >&2
    echo "  It is substituted inside a JavaScript string literal; a quote or" >&2
    echo "  a backslash there is executable, not a typo." >&2
    exit 1
  fi

  # `&` means "the whole match" on the right-hand side of a sed expression.
  # A store address routinely carries one.
  escaped=${value//&/\\&}

  # No `sed -i`: BSD and GNU disagree on whether it takes an argument, which
  # is why the previous version tried both forms and swallowed the failure
  # of the first. A temporary file is the same on every host.
  work=$(mktemp)
  sed "s|$marker|$slot: '$escaped'|" "$page" > "$work"
  mv "$work" "$page"

  # THE CHECK IS ON THE OUTPUT, and it is the whole reason this script
  # exists. Everything above can be right and this still fail; if it does,
  # the address did not land and the page would say there is none.
  if ! grep -q -F -- "$value" "$page"; then
    echo "build-site: FAIL: $slot was set to" >&2
    echo "    $value" >&2
    echo "  but the built page does not carry it. The page would show the" >&2
    echo "  waiting sentence to people the application is published for." >&2
    exit 1
  fi
}

fill ios "$MESSAGR_DEST_IOS"
fill android "$MESSAGR_DEST_ANDROID"
fill androidApk "$MESSAGR_DEST_ANDROID_APK"

# The doctrine, on the page that will actually be served. `set -e` carries
# its exit status out of here: the two properties -- identical for every
# token, and never claims the token -- are held by what is deployed, not
# only by what is committed.
"$here/tests/doctrine-page-invitation.sh" "$page"

# And the first of those two properties directly, on the built tree rather
# than on the page alone: the doctrine checks that the page cannot fetch, this
# checks that nothing under `i/` can answer a token differently. A second file
# built into that directory would keep every doctrine rule and still be an
# existence oracle.
"$here/tests/identical-page-invitation.sh" "$destination" \
  "$here/nginx-messagr-eu.conf"

echo "build-site: $destination is ready"
