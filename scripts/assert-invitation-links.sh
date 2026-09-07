#!/usr/bin/env bash
#
# Both applications claim the same hosts, or an invitation opens on one
# platform and not the other.
#
# WHY THIS EXISTS. The invitation page's own link points at its own address:
# tapping "Ouvrir dans Messagr" is meant to be intercepted by the operating
# system, and the page says so -- "si les liens universels sont en place".
# They were not. iOS had no `com.apple.developer.associated-domains` at all,
# so it never even fetched the association file the site had been serving for
# weeks; Android claimed the `messagr` scheme and no https link. The button
# reloaded the page on both, which is what "rien ne se passe" looks like.
#
# Neither could be seen from a build. Both were reported from devices on
# 7 September 2026, minutes apart, by two people looking at the same button.
#
# THE HOSTS ARE COMPARED AGAINST EACH OTHER, not against a list written here.
# A link names its instance -- the homeserver of the account that invited --
# so the set grows when an instance is added, and the failure worth catching
# is the two platforms disagreeing about it.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)/.."

failed=0

if ! python3 - "$ROOT" <<'PY'
import plistlib, re, sys

root = sys.argv[1]

# STRICT XML, AND THE ENTITLEMENTS EARNED THIS THE HARD WAY.
# `plutil -lint` accepts "--" inside a comment; XML does not, and Xcode
# builds such a file happily. Three separate edits grew one on 7 September
# 2026 alone.
try:
    entitlements = plistlib.load(
        open(f'{root}/packages/app/ios/Messagr/Messagr.entitlements', 'rb'))
except Exception as refused:
    print(f'  FAIL  Messagr.entitlements is not well-formed XML: {refused}',
          file=sys.stderr)
    print('        ("--" inside a comment is the usual cause; plutil -lint '
          'accepts it)', file=sys.stderr)
    sys.exit(1)

declared = entitlements.get('com.apple.developer.associated-domains') or []
ios = {d.split(':', 1)[1] for d in declared
       if isinstance(d, str) and d.startswith('applinks:')}
if not ios:
    print('  FAIL  the iOS entitlements claim no applinks host, so no https '
          'link can ever open the application', file=sys.stderr)
    sys.exit(1)

manifest = open(f'{root}/packages/app/android/app/src/main/AndroidManifest.xml').read()
# Only inside a filter that carries autoVerify: without it Android offers a
# chooser instead of opening, which the manifest's own comment refused.
verified = re.findall(
    r'<intent-filter[^>]*android:autoVerify="true".*?</intent-filter>',
    manifest, re.S)
android = set()
for block in verified:
    if 'android:scheme="https"' not in block:
        continue
    android.update(re.findall(r'android:host="([^"]+)"', block))

if not android:
    print('  FAIL  the Android manifest verifies no https host, so an '
          'invitation link opens a browser', file=sys.stderr)
    sys.exit(1)

only_ios = sorted(ios - android)
only_android = sorted(android - ios)
if only_ios or only_android:
    for host in only_ios:
        print(f'  FAIL  iOS claims {host} and Android does not', file=sys.stderr)
    for host in only_android:
        print(f'  FAIL  Android claims {host} and iOS does not', file=sys.stderr)
    sys.exit(1)

print(f'  OK    both applications claim the same {len(ios)} invitation '
      f'host(s): {", ".join(sorted(ios))}')
PY
then
  failed=1
fi

if [ "$failed" -ne 0 ]; then
  echo "an invitation link would not open the application" >&2
fi
exit "$failed"
