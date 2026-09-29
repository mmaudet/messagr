#!/usr/bin/env bash
#
# The two legal pages must answer before Google is asked to review anything.
#
# Play fetches the privacy policy URL during review rather than merely
# recording it, and a 404 fails the review without saying clearly why: the
# console reports a rejected submission, not a missing page. Checking here
# turns a confusing rejection days later into a refusal now.
#
# The terms are checked too. They are not required by Play, but the privacy
# policy links to them, and a legal page whose own links are dead is worse
# than one that does not link at all.
#
# AND THE HELP PAGE, SINCE #333. It is not decoration either: its address is
# what the store listings carry as the support URL Apple visits, and its
# `#supprimer-votre-compte` anchor is the account deletion resource Play
# requires of any application that creates an account. A submission whose
# deletion URL answers 404 is refused for a reason the console does not
# spell out, exactly like the privacy policy, and the application's legal
# screen links to that same anchor. So it answers before anything is
# submitted, or nothing is submitted.
#
# THE ORDER THIS IMPOSES IS THE POINT. The page is committed in this
# repository before it is served from messagr.eu, and until somebody runs
# `deploy/messagr-eu/deploy.sh` this check fails on `/aide`. That failure is
# the gate working: it says the site has not been deployed, not that the
# page is wrong.
#
# Redirects are followed, and that is not a detail. A directory page served
# by nginx answers 301 towards its trailing slash, so a check reading the
# first status would fail on a site that is serving the page perfectly --
# measured against a local server before this was trusted. Google follows
# redirects when it fetches the policy, so following them is the faithful
# test.
#
# No pipe into `grep -q`: that closes the pipe at the first match, the writer
# dies of SIGPIPE, and `pipefail` reads a found match as a failure -- which
# cost a real publishing run once already. curl reports the status itself.
#
# AND THE VERSIONS AROUND THE ONE IN FORCE, SINCE #412. A change to a legal
# page is published thirty days before it applies, at `<page>/a-venir/`, and
# the version it replaces stays readable at `<page>/jusqu-au-<date>/` once it
# has. Which of them should answer is read from the repository, by shape as
# `build-site.sh` builds them, and not listed here: an upcoming version answers
# once it is announced -- its source no longer carries the mark that waits for
# the date -- and every dated version the repository holds answers.
#
# The other direction too, and exactly: 404. An upcoming version the
# repository has not announced, or no longer holds because it applied, must
# NOT be served. The first would be publishing ahead of the date the porteur
# sets, the second a page still saying the policy « s'appliquera » on a day it
# already does. nginx answers a missing file with a plain 404, so anything
# else -- a page, an error, no answer -- is not the absence being checked.
#
# AND THE TRANSLATIONS, SINCE #466. The terms are published in French, which is
# authoritative, and in English at `/conditions-generales/en/`, which the
# application opens when it is not in French. A translation of the version in
# force is a directory of two letters beside it, found by shape like the rest,
# and it answers. A version that applies the day it is published waits in
# `<page>/a-publier/` with its own translation until the porteur publishes it
# (`version-a-venir.mjs publier`), and until then neither it nor that
# translation is served: both answer 404.
#
# `MESSAGR_SITE_SOURCE` names the site the repository holds, and defaults to
# this repository's. deploy/messagr-eu/tests/controles-legaux.js points it at
# a copy, and `MESSAGR_SITE` at that copy served locally, so that this check
# is seen passing and refusing somewhere else than in production.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SITE_SOURCE="${MESSAGR_SITE_SOURCE:-$ROOT/deploy/messagr-eu/site}"
BASE="${MESSAGR_SITE:-https://messagr.eu}"
PAGES=(/confidentialite /conditions-generales /aide)
UNSERVED=()

for dir in "$SITE_SOURCE"/*/; do
  dir="${dir%/}"
  legal="$(basename "$dir")"
  upcoming="$dir/a-venir/index.html"
  dated_any=0
  for dated in "$dir"/jusqu-au-*/index.html; do
    [ -f "$dated" ] || continue
    dated_any=1
    dated="${dated#"$SITE_SOURCE"}"
    PAGES+=("${dated%index.html}")
  done
  if [ -f "$upcoming" ] && ! grep -qF 'MESSAGR-DATE-A-VENIR' "$upcoming"; then
    PAGES+=("/$legal/a-venir/")
  elif [ -f "$upcoming" ] || [ "$dated_any" -eq 1 ]; then
    UNSERVED+=("/$legal/a-venir/")
  fi
  for translated in "$dir"/[a-z][a-z]/index.html; do
    [ -f "$translated" ] || continue
    translated="${translated#"$SITE_SOURCE"}"
    PAGES+=("${translated%index.html}")
  done
  if [ -f "$dir/a-publier/index.html" ]; then
    UNSERVED+=("/$legal/a-publier/")
    for waiting in "$dir"/a-publier/[a-z][a-z]/index.html; do
      [ -f "$waiting" ] || continue
      lang="$(basename "$(dirname "$waiting")")"
      [ -f "$dir/$lang/index.html" ] || UNSERVED+=("/$legal/$lang/")
    done
  fi
done

failed=0
for page in "${PAGES[@]}"; do
  code="$(curl -sSL -o /dev/null -w '%{http_code}' --max-time 20 "$BASE$page" || echo 000)"
  if [ "$code" = "200" ]; then
    printf '  OK    %s%s\n' "$BASE" "$page"
  else
    printf '  FAIL  %s%s answered %s\n' "$BASE" "$page" "$code" >&2
    printf '        redirect chain: %s\n' \
      "$(curl -sSL -o /dev/null -w '%{url_effective}' --max-time 20 "$BASE$page" 2>/dev/null || echo '-')" >&2
    failed=1
  fi
done

# Written this way because the bash macOS ships (3.2) calls an empty array
# unbound under `set -u`, and both upcoming versions can be announced at once.
for page in ${UNSERVED[@]+"${UNSERVED[@]}"}; do
  code="$(curl -sSL -o /dev/null -w '%{http_code}' --max-time 20 "$BASE$page" || echo 000)"
  if [ "$code" = "404" ]; then
    printf '  OK    %s%s is not served (404)\n' "$BASE" "$page"
  else
    printf '  FAIL  %s%s answered %s, where the repository publishes nothing yet\n' "$BASE" "$page" "$code" >&2
    failed=1
  fi
done

if [ "$failed" -ne 0 ]; then
  echo >&2
  echo "The pages the stores are given are not being served." >&2
  echo "  Publish them: deploy/messagr-eu/deploy.sh sends the whole site." >&2
  echo "  Google follows the privacy policy link during review; a 404 fails it." >&2
  echo "  It fetches the account deletion resource too, and Apple visits the" >&2
  echo "  support URL: both are /aide." >&2
  echo "  An upcoming version is served from the deployment that follows its" >&2
  echo "  announcement, and retired by the one that follows its application;" >&2
  echo "  a version waiting in a-publier/, and its translation, from the" >&2
  echo "  deployment that follows its publication;" >&2
  echo "  see deploy/messagr-eu/LISEZ-MOI-pages-legales.md." >&2
  exit 1
fi

echo "the ${#PAGES[@]} pages the stores are given all answer"
