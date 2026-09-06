#!/bin/sh
# THE DOCTRINE OF THE INVITATION PAGE, CHECKED ON THE DELIVERED FILE.
#
# Two properties define this page, and every change must preserve them:
#
#   1. It is IDENTICAL for every token, valid or not. No existence oracle.
#   2. It NEVER claims the token. The token stays in the URL, on the device.
#
# Until 11 August 2026 both lived in an HTML comment. They now live here,
# because the page gained a script that day, and a rule nobody runs is a rule
# the next commit breaks.
#
# THE RULE IS ABOUT EXFILTRATION, NOT ABOUT NAVIGATION. What is forbidden is
# anything the BROWSER fetches on its own: src=, @import, <link href=. An
# <a href> a person clicks is a navigation they decided, and no token travels
# with it — `meta referrer no-referrer` is set, and a fragment is never sent
# by any browser.
set -eu

page="${1:-deploy/messagr-eu/site/i/index.html}"
status=0
report() { echo "doctrine: FAIL: $1" >&2; status=1; }

[ -f "$page" ] || { echo "doctrine: FAIL: no page at $page" >&2; exit 1; }

# ── 1. The content security policy is present, and it closes the exits ───
csp=$(grep -i 'http-equiv="Content-Security-Policy"' "$page" || true)
[ -n "$csp" ] || report "no Content-Security-Policy meta tag"
for directive in \
  "default-src 'none'" \
  "connect-src 'none'" \
  "form-action 'none'" \
  "base-uri 'none'"; do
  case "$csp" in
    *"$directive"*) ;;
    *) report "the policy does not carry: $directive" ;;
  esac
done

# ── 2. No way to send anything, at the source level too ──────────────────
# The policy already blocks these at the browser. Banning them in the source
# as well means a reviewer sees the intent, and a policy typo is not the only
# thing standing between the token and the network.
#
# THIS SCANS THE WHOLE FILE, COMMENTS INCLUDED, and that is deliberate. It
# caught its own author on 11 August 2026, on a comment that merely NAMED the
# blocked APIs. Telling code from comment would need a parser, which is finer
# and more fragile than the property is worth; the page paraphrases instead.
# Do not loosen this into a code-only scan to save a comment.
for forbidden in 'fetch(' 'XMLHttpRequest' 'sendBeacon' 'WebSocket' 'EventSource' 'import('; do
  if grep -qF "$forbidden" "$page"; then
    report "the page contains $forbidden"
  fi
done

# ── 3. No form: a form is a token that leaves ────────────────────────────
if grep -qiE '<form' "$page"; then
  report "the page contains a form"
fi

# ── 4. Nothing the browser fetches by itself ─────────────────────────────
if grep -qiE '(src|srcset)=|@import|<link[^>]+href=' "$page"; then
  report "the page fetches an external resource (src, srcset, link href or @import)"
fi

# ── 5. Foreign origins only in <a href>, and only the stores ─────────────
# Every http(s) URL is extracted; whatever is not an allow-listed store or our
# own origin is refused. The allow-list is short ON PURPOSE: a destination
# added without a review is a destination nobody checked.
foreign=$(grep -oE 'https?://[^"'"'"' <>)]+' "$page" \
  | grep -vE '^https://(apps\.apple\.com|play\.google\.com|testflight\.apple\.com|messagr\.eu)(/|$)' \
  || true)
if [ -n "$foreign" ]; then
  report "foreign origin outside the allow-list:"
  echo "$foreign" >&2
fi

# ── 6. The page still never reads the invitation ─────────────────────────
# It passes `location.href` whole and never splits it. That is what keeps it
# indifferent to the link's format — path today, fragment tomorrow — and it
# is the line not to cross: a page that reads the token is a page that could
# leak it.
for reading in 'location.hash' 'location.search' 'location.pathname' 'URLSearchParams'; do
  if grep -qF "$reading" "$page"; then
    report "the page reads part of the URL ($reading): it must only pass location.href whole"
  fi
done

if [ "$status" -eq 0 ]; then
  echo "doctrine: the invitation page holds its two properties"
fi
exit "$status"
