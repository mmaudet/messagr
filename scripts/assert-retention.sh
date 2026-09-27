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
#
# An entry can also carry, under `dit`, what the page says about it, checked
# the same way. The device's own log (#285) has no duration anybody here
# decides -- the device's system keeps and clears it -- so its sentence is the
# claim there is to hold, and a sentence nothing checks is how a policy starts
# saying something the code does not do.
#
# And an entry can name, under `page`, the page that says it, when that is not
# the policy in force: the upcoming version (#412), which states a new
# duration from the day it is announced until the day it applies. Until it is
# announced -- while the repository's copy still carries the mark that waits
# for its date -- nothing serves it, and what it will say is not checked.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE="$ROOT/deploy/messagr-eu/retention.json"
SITE_SOURCE="$ROOT/deploy/messagr-eu/site"
SITE="${MESSAGR_SITE:-https://messagr.eu}"
HOST="${MESSAGR_HOST:-hermes}"

failed=0

# ── Each page says what the source declares ───────────────────────────────
while IFS= read -r where; do
  # The upcoming version only: the policy in force carries the same mark in
  # the passage that will announce it, and is checked all the same.
  if [[ "$where" == */a-venir/ ]] &&
    grep -qF 'MESSAGR-DATE-A-VENIR' "$SITE_SOURCE${where}index.html" 2>/dev/null; then
    printf '  ----  %s is not announced yet; what it will say is not checked\n' "$where"
    continue
  fi
  page="$(curl -sSL --fail --max-time 20 "$SITE$where" 2>/dev/null || true)"
  if [ -z "$page" ]; then
    echo "FAIL  the policy page could not be read at $SITE$where" >&2
    failed=1
    continue
  fi
  while IFS= read -r phrase; do
    if printf '%s' "$page" | tr -s ' \n' ' ' | grep -qF "$phrase"; then
      printf '  OK    %s says "%s"\n' "$where" "$phrase"
    else
      printf '  FAIL  %s never says "%s"\n' "$where" "$phrase" >&2
      failed=1
    fi
  done < <(python3 - "$SOURCE" "$where" <<'EOF'
import json, sys
d = json.load(open(sys.argv[1]))
for k, v in d.items():
    if not isinstance(v, dict) or v.get('page', '/confidentialite/') != sys.argv[2]:
        continue
    if 'duree' in v:
        print(v['duree'])
    for phrase in v.get('dit', []):
        print(phrase)
EOF
)
done < <(python3 - "$SOURCE" <<'EOF'
import json, sys
d = json.load(open(sys.argv[1]))
pages = ['/confidentialite/']
for v in d.values():
    if isinstance(v, dict) and v.get('page', '/confidentialite/') not in pages:
        pages.append(v['page'])
print('\n'.join(pages))
EOF
)

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
