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

## Asking the server what it serves

Every other check in this directory reads what the repository holds. None of
them had ever read what the server answers, and on 7 September 2026 that cost
two live defects at once, both invisible to a green CI:

- the landing page carried a language-selector fix that `master` did not have,
  so the next deploy from `master` would have put the broken selector back;
- the privacy policy served was the one from before #102, still claiming
  _"il n'existe aucun tiers dans cette application"_ while the application had
  since gained Firebase Cloud Messaging and `master` had gained a whole section
  explaining exactly what crosses Google.

`tests/conformite-site-deploye.js` closes that. It builds the site and compares
it with what an address answers, file by file, and names the byte where each
one first disagrees.

**One difference is tolerated and it is written as narrowly as the build
allows**: the three store destinations, only inside `i/index.html`, only inside
the `DESTINATIONS` object, and only when the served value satisfies the address
grammar — which is **read out of `build-site.sh`** rather than copied here, so
the two cannot drift. A renamed object is a failure, not a pass, for the same
reason `build-site.sh` refuses a renamed slot.

**And the tolerance switches off when the destinations are known.** With
`MESSAGR_DEST_IOS` and its two sisters in the environment, as they are during a
deployment, the page is built with them and the comparison is byte for byte.
Accepting any https address at the moment you know which one you just put there
would accept somebody else's store. `deploy.sh` passes them.

Run with no argument it takes no network: it builds the site and holds its own
comparator against ten fabricated servers, which is how the tolerance is kept
from quietly widening. That is the half CI runs. `--live` is the half that
reads a real server, and `deploy.sh` runs it after every deployment.

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

**The Play App Signing fingerprints — measured, vouched, and deliberately
not served.** Both were read off the console on 6 September 2026: Play now
generates a _classic_ certificate and a _post-quantum_ one, and the registry
carries both, because which of the two a device presents to Digital Asset
Links verification is not something this project decides.

They are not in `assetlinks.json`, and that is a decision rather than an
omission. `tests/doctrine-app-links.js` refuses to serve a debug key
alongside a publication key — one file with a documented password must not be
able to claim messagr.eu links once something else can — and withdrawing the
debug key would stop `https://messagr.eu/i/<token>` opening the application on
the two phones that carry an install signed by it. Android refuses an update
signed by another key, and the uninstall that migration would need erases the
account, the Megolm keys and the history.

**What waiting costs, so the choice is not free:** anybody installing from the
internal testing track gets no App Links verification, so an invitation link
opens a browser. The landing page is written for exactly that — it offers
_Copy the link_, which is what carries an invitation across an install — and
`docs/unassisted-trial.md` records it as a different finding rather than a
step gone badly.

The condition is the field, not the keyring: the debug key goes when no
install signed by it is still in use. #114 holds it.

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
    node deploy/messagr-eu/tests/conformite-site-deploye.js --live

`deploy.sh` runs the last of those itself, at the end.

## Pointing Android at Play, and the address that is NOT the right one

`MESSAGR_DEST_ANDROID` is unset today, so the page offers the self-hosted
APK and nothing else. #91 needs the opposite: a trial that installs from the
internal testing track, because what is being tested includes the
distribution.

The mechanism is already here. The value is not, and **the obvious value is
wrong**.

**Not this.** `https://play.google.com/store/apps/details?id=eu.messagr` is
the address of a published application. On an internal track, anybody who is
not already an enrolled tester gets "item not found" from it. Wiring that
would give most people a dead end, which is worse than the APK they have
today.

**This.** The tester opt-in link, of the form

    https://play.google.com/apps/internaltest/<numeric id>

It enrols the person and then offers the install, which is the whole path a
participant needs. The id is per track and is shown **only in the Play
Console**, under Testing, Internal testing, Testers. Nothing in this
repository can derive it, which is why it is written here rather than
defaulted somewhere.

Then:

    MESSAGR_DEST_ANDROID='https://play.google.com/apps/internaltest/<id>' \
      deploy/messagr-eu/deploy.sh

`build-site.sh` refuses a value that does not land in the built page, so a
typo is a failed deployment rather than a page that serves the waiting
sentence to somebody holding a working invitation. That guard is the reason
this is one command and not a checklist.

**The APK is not withdrawn by this.** Both slots coexist, and withdrawing
the download is its own gesture (`MESSAGR_APK=none`). Leave it until the
trial says the Play path works.

**And iOS stays a dead end** until `MESSAGR_DEST_IOS` has a value. See #106:
`ios: ''` is what production serves today, and an iPhone is told to ask the
person who invited them.
