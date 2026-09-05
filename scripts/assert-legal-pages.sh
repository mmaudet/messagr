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
set -euo pipefail

BASE="${MESSAGR_SITE:-https://messagr.eu}"
PAGES=(/confidentialite /conditions-generales)

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

if [ "$failed" -ne 0 ]; then
  echo >&2
  echo "The legal pages are not being served." >&2
  echo "  Publish them: see deploy/messagr-eu/site/LISEZ-MOI.md" >&2
  echo "  Google follows the privacy policy link during review; a 404 fails it." >&2
  exit 1
fi

echo "both legal pages answer"
