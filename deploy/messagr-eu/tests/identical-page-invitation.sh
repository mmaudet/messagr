#!/bin/sh
# THE PROPERTY ITSELF, NOT THE MECHANISM THAT GIVES IT.
#
# `doctrine-page-invitation.sh` checks that the page cannot send anything and
# cannot fetch anything -- the mechanism. What the page actually promises is
# narrower and stronger: **its response is byte-identical for every token,
# valid or not**, so nobody can learn from it whether an invitation exists.
#
# That property was written in a comment and held by nothing. A page that
# fetched its own status, or an nginx location that answered a real file for
# some paths and a fallback for others, would keep every rule the doctrine
# checks and still be an existence oracle.
#
#   identical-page-invitation.sh <built site directory> [nginx config] [--live]
#
# Two halves. The first reads what is built and what nginx is configured to
# do, and is binding everywhere. The second asks the live site for two tokens
# and compares the bytes; it needs the network, so it is opt-in -- the same
# split `scripts/assert-push-payload.sh` makes, and for the same reason.
set -eu

site=${1:-}
config=${2:-}
live=no
for argument in "$@"; do
  [ "$argument" = "--live" ] && live=yes
done

[ -n "$site" ] || { echo "usage: identical-page-invitation.sh <built site> [nginx config] [--live]" >&2; exit 2; }
status=0
report() { echo "identical: FAIL: $1" >&2; status=1; }

# ── 1. One page, and nothing else under /i ──────────────────────────────
# `try_files $uri /i/index.html` serves a real file when one exists at the
# path asked for. For every token that is a miss and the fallback answers --
# unless something else is ever built into `i/`, at which point one token
# would get a different page and the property would be gone.
if [ ! -f "$site/i/index.html" ]; then
  report "no page at $site/i/index.html"
else
  count=$(find "$site/i" -type f | wc -l | tr -d ' ')
  if [ "$count" != "1" ]; then
    report "the built site has $count file(s) under i/, expected exactly 1.
  nginx serves \$uri before the fallback, so a second file there is a token
  that gets a different answer -- which is the oracle this page must not be."
  fi
fi

# ── 2. Nothing under /i is generated per request ────────────────────────
if [ -n "$config" ] && [ -f "$config" ]; then
  block=$(awk '/location (= )?\/i\/? \{/,/^    \}/' "$config")
  if printf '%s' "$block" | grep -q 'proxy_pass\|fastcgi\|uwsgi\|ssi on'; then
    report "the /i location passes the request somewhere.
  Anything that answers per request can answer differently per token."
  fi
  printf '%s' "$block" | grep -q 'index.html' ||
    report "the /i location does not fall back to a fixed page"
else
  echo "identical: (no nginx config given; skipped the location check)"
fi

# ── 3. The live site, on two tokens that differ ─────────────────────────
if [ "$live" = yes ]; then
  base=${MESSAGR_SITE:-https://messagr.eu}
  one=$(mktemp); two=$(mktemp)
  # Same length, different bytes: a page that varied with the token's shape
  # rather than its value would still pass a comparison of two lengths.
  curl -sS --max-time 20 "$base/i/aaaaaaaaaaaaaaaaaaaaaaaa" -o "$one" || report "cannot reach $base"
  curl -sS --max-time 20 "$base/i/zzzzzzzzzzzzzzzzzzzzzzzz" -o "$two" || report "cannot reach $base"
  if [ -s "$one" ] && [ -s "$two" ]; then
    if cmp -s "$one" "$two"; then
      echo "identical: the live site answers two different tokens with the same $(wc -c < "$one" | tr -d ' ') bytes"
    else
      report "the live site answers two tokens differently. That is an
  existence oracle: somebody can ask whether an invitation is real."
    fi
  fi
  rm -f "$one" "$two"
else
  echo "identical: (offline; pass --live to compare two tokens on the site)"
fi

[ "$status" = 0 ] && echo "identical: every token gets the same page"
exit "$status"
