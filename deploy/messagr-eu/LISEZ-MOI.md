# messagr.eu — the site, and what deploys it

The landing page, the invitation page, the two legal pages, the nginx vhost
and the scripts that build and publish them. Brought here from the previous
repository on 6 September 2026 (#106): before that, the deployed copies were
dated 18 August and nothing in this repository would have noticed if they
changed.

## What is here

    site/                     what gets served
      index.html              the landing page
      i/index.html            the invitation page — one file, every token
      .well-known/            the app-link declarations, Android and Apple
      confidentialite/        the privacy policy (Google follows this link)
      conditions-generales/   the terms the first-launch screen links to
    build-site.sh             produces the served tree; run in CI
    deploy.sh                 publishes it to the server
    nginx-messagr-eu.conf     the vhost
    android-fingerprints.json the signing-key registry — NEVER deployed
    tests/                    what holds all of it

## The invitation page's two properties

Both are the reason the page is written as it is, and both are now checked
rather than claimed in a comment:

1. **Its response is byte-identical for every token, valid or not.** No
   request, no branch on the token, so the page cannot reveal whether an
   invitation exists. `tests/identical-page-invitation.sh` asserts it — on the
   built tree, on the vhost, and with `--live` on the site itself.
2. **It never claims the token.** The token stays in the URL, on the device.
   `tests/doctrine-page-invitation.sh` holds the mechanism: a content security
   policy with no exits, and no `src=`, `@import` or `<link href=` in the
   source.

`build-site.sh` runs both on what it produced, so they are held by what is
deployed and not only by what is committed.

## The QR code, and the second encoder

The page draws a QR of the invitation link for the desktop case. It carries
its own encoder because its content security policy forbids an external
script, and `tests/qr-page-invitation.js` pins it against a vector verified
end to end.

**The application's encoder is a port of it**, in
`packages/app/src/runtime/qr.ts`, and `qr.spec.ts` compares the two against
the same vector module for module. Not "both decode to the same link" — two
encoders can choose different masks and both be readable. The claim is that a
person scanning a printed invitation and a person scanning a phone see the
same picture, so the level or a mask rule cannot drift between them without a
test failing.

## What still needs a person

**The Play App Signing fingerprint.** `android-fingerprints.json` carries the
slot as `awaited`. Until it is measured in the Play Console (Setup → App
signing → App signing key certificate, SHA-256) and vouched here,
`assetlinks.json` serves the debug key — which is right for installing builds
by hand and wrong the day the store carries the application. The registry's
own rule refuses both at once, so the swap is a decision somebody makes rather
than one that happens quietly.

**The iPhone destination.** `DESTINATIONS.ios` is empty and the page says so
honestly, because no iOS build is published anywhere. It wants a TestFlight
address; the slot is already there and `build-site.sh` refuses a value that is
not a plain https address, or one that does not land in the built page.

**The walk itself.** #106's last criterion is one invitation opened end to end
on a phone that never had the application: link, landing, install, first
launch (language, terms), paste, claim. Nothing here proves that.

## What was found on the way in

Three declarations were stale, and each of them broke the path this whole
directory exists for:

- `assetlinks.json` declared `cloud.maudet.messagr`; the application is
  `eu.messagr`. **Android App Links could not verify**, so an invitation link
  opened the browser rather than the application, installed or not.
- Its fingerprint was a per-machine `~/.android/debug.keystore`, not the
  `debug.keystore` committed in this repository that every build is actually
  signed with.
- `apple-app-site-association` declared `KUT463DS29.cloud.maudet.messagr`.

And `build-site.sh` copied `i/` and `.well-known/` **by name**, which was true
when they were the only two directories — so `confidentialite/` and
`conditions-generales/`, added since, were built into nothing. Google follows
the privacy link during review and a 404 fails it without saying why. Copied
by shape now, the way the root files already were.

## Publishing

    deploy/messagr-eu/deploy.sh

Idempotent: every step checks whether its work is already done, the vhost is
backed up before any change and validated with `nginx -t`, and nginx is
reloaded only if something changed.

Verify after:

    curl -sS -o /dev/null -w '%{http_code}\n' https://messagr.eu/
    curl -sS -o /dev/null -w '%{http_code}\n' https://messagr.eu/confidentialite
    curl -sS -o /dev/null -w '%{http_code}\n' https://messagr.eu/conditions-generales
    deploy/messagr-eu/tests/identical-page-invitation.sh /tmp/messagr-site \
      deploy/messagr-eu/nginx-messagr-eu.conf --live
