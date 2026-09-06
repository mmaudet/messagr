#!/usr/bin/env bash
#
# The application's legal screen and the published terms must say the same
# things.
#
# WHY THIS IS A SCRIPT AND NOT A PROMISE. The conditions published at
# messagr.eu say, in their own words, that "les trois points exigés par
# l'article 14 sont portés par l'écran « Informations légales », atteignable
# depuis les Réglages". Either that screen carries them or the page is false.
# These texts have already had to correct one false claim -- an earlier version
# announced a report "accessible depuis l'application, sur chaque message
# reçu" and, confronted with the code, nothing of the sort existed. That is the
# whole reason scripts/assert-retention.sh exists, and this is its sibling.
#
# WHAT IT CHECKS, AND WHAT IT DELIBERATELY DOES NOT. Not that the two texts
# match word for word: they are written for different readers and a check that
# demanded identical prose would be failed by every honest edit. What it checks
# is that each load-bearing FACT appears on both sides -- the contact address,
# the thirty-day deadline, that no automatic detection exists, that the
# operator cannot read, that reporting from inside the application does not
# exist yet. Those are the sentences somebody could quietly drop from one side
# while leaving the other claiming it.
#
# THE PAGE IS FETCHED, not read from the repository copy. What a person is
# bound by is what is served, and deploy/messagr-eu/site/ is what somebody
# intended to serve. The two can differ, and the day they do this must fail.
set -euo pipefail

TERMS="${MESSAGR_TERMS_URL:-https://messagr.eu/conditions-generales/}"
COPY="packages/app/src/copy/fr.ts"

[ -f "$COPY" ] || { echo "no copy catalogue at $COPY" >&2; exit 1; }

# Tags stripped and whitespace collapsed before anything is looked for: the
# published page breaks sentences across <strong> and <a>, so "conformite@
# messagr.eu" is three text nodes and a naive grep finds none of them.
# Apostrophes are normalised to the straight one, and that is not pedantry:
# the published page writes "n'existe pas encore" straight and the application
# writes it typographic. That is a difference of typography and this check is
# about facts, so a normalisation here is the difference between a check that
# reads meaning and one that reads punctuation.
flatten() {
  python3 -c '
import html, re, sys
text = re.sub(r"<[^>]+>", " ", sys.stdin.read())
text = html.unescape(text).replace("\u2019", "\u0027")
sys.stdout.write(re.sub(r"\s+", " ", text))
'
}

echo "fetching the published terms: $TERMS"
# -L because a directory URL answers 301 towards its trailing slash, and -f so
# a 404 stops here rather than being flattened into an empty string that
# matches nothing and reports every fact as missing.
published="$(curl -fsSL --max-time 30 "$TERMS" | flatten)"
[ -n "$published" ] || { echo "the published terms came back empty" >&2; exit 1; }

screen="$(flatten < "$COPY")"

# Each fact, as it must read on both sides. Written with straight apostrophes,
# which is what `flatten` normalises both texts to.
FACTS=(
  "conformite@messagr.eu"
  "trente jours"
  "aucun outil automatique"
  "cryptographiquement impossible"
  "n'existe pas encore"
  "quinze ans"
  "invitation nominative"
  "considérant 14"
)

missing=0
for fact in "${FACTS[@]}"; do
  in_page=no
  in_screen=no
  case "$published" in *"$fact"*) in_page=yes ;; esac
  case "$screen" in *"$fact"*) in_screen=yes ;; esac

  if [ "$in_page" = yes ] && [ "$in_screen" = yes ]; then
    printf '  both   %s\n' "$fact"
  else
    printf '  MISSING from %s: %s\n' \
      "$( [ "$in_page" = no ] && printf 'the published page' || printf 'the application' )" \
      "$fact"
    missing=$((missing + 1))
  fi
done

if [ "$missing" -ne 0 ]; then
  cat >&2 <<'WHY'

FAIL: the application's legal screen and the published terms disagree.

      One of the two has been edited without the other. Which one is wrong
      depends on which is true -- do not "fix" this by copying a sentence
      across until you know. A page that claims something the application
      does not do is the failure this check exists to catch.
WHY
  exit 1
fi

echo "PASS: the legal screen and the published terms agree on ${#FACTS[@]} facts"
