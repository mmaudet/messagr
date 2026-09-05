#!/usr/bin/env bash
#
# The published policy and the running configuration must say the same thing.
#
# They did not, once: the policy claimed the invitation graph was kept as long
# as the accounts existed, while the service purged it at thirty days. A
# privacy policy is a statement about what a system does, so a divergence
# there is not a documentation bug -- it is the document being false.
#
# deploy/messagr-eu/retention.json holds the durations once. This checks that
# the live page states them, and, when a server is reachable, that the server
# applies them.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE="$ROOT/deploy/messagr-eu/retention.json"
PAGE="${MESSAGR_SITE:-https://messagr.eu}/confidentialite"
HOST="${MESSAGR_HOST:-hermes}"

failed=0

# ── The page says what the source declares ────────────────────────────────
page="$(curl -sSL --max-time 20 "$PAGE" 2>/dev/null || true)"
if [ -z "$page" ]; then
  echo "FAIL  the policy page could not be read at $PAGE" >&2
  failed=1
else
  while IFS= read -r phrase; do
    if printf '%s' "$page" | tr -s ' \n' ' ' | grep -qF "$phrase"; then
      printf '  OK    the page says "%s"\n' "$phrase"
    else
      printf '  FAIL  the page never says "%s"\n' "$phrase" >&2
      failed=1
    fi
  done < <(python3 -c "
import json
d = json.load(open('$SOURCE'))
for k, v in d.items():
    if isinstance(v, dict) and 'duree' in v:
        print(v['duree'])
")
fi

# ── The server applies what the source declares ───────────────────────────
if ssh -o ConnectTimeout=10 -o BatchMode=yes "$HOST" true 2>/dev/null; then
  days="$(python3 -c "
import json; print(json.load(open('$SOURCE'))['journaux_techniques']['jours'])")"
  actual="$(ssh -o BatchMode=yes "$HOST" "grep -oE '^[[:space:]]*rotate [0-9]+' /etc/logrotate.d/nginx | grep -oE '[0-9]+'" 2>/dev/null || echo 0)"
  if [ "$actual" = "$days" ]; then
    printf '  OK    nginx rotates %s times, as declared\n' "$actual"
  else
    printf '  FAIL  nginx rotates %s times and the policy promises %s\n' "$actual" "$days" >&2
    failed=1
  fi

  if ssh -o BatchMode=yes "$HOST" "grep -q '^MaxRetentionSec=1year' /etc/systemd/journald.conf" 2>/dev/null; then
    printf '  OK    journald is bounded at one year\n'
  else
    printf '  FAIL  journald carries no one-year bound\n' >&2
    failed=1
  fi
else
  printf '  ----  server not reachable from here; page checked, configuration not\n'
fi

if [ "$failed" -ne 0 ]; then
  echo >&2
  echo "The policy and the configuration disagree. One of them is wrong, and" >&2
  echo "the published one is the one people rely on." >&2
  exit 1
fi
echo "the policy and the configuration agree"
