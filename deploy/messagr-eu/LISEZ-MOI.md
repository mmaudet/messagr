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

**A device that installed from the track, asked whether its links verify.**
`assetlinks.json` names the two Play App Signing certificates, and has since
#135 put them there on 7 September 2026 and closed #114; messagr.eu was
serving exactly those two on 13 September 2026. Both were read off the console
on 6 September 2026: Play generates a _classic_ certificate and a
_post-quantum_ one, and both are served because which of the two a device
presents to Digital Asset Links verification is not something this project
decides. They are the certificates Google signs with before an install reaches
a phone, so an install from the internal testing track is expected to verify,
and `https://messagr.eu/i/<token>` is expected to open the application.

Expected, not yet observed. The check is one command on a device that
installed from the track, and `messagr.eu: verified` is the answer that
settles it:

    adb shell pm get-app-links eu.messagr

Worth running before anybody is invited, rather than finding out at step 1 of
`docs/unassisted-trial.md`.

**The debug keys went out of `assetlinks.json` the same day, and that was a
decision.** `tests/doctrine-app-links.js` refuses to serve a debug key
alongside a publication key: `debug.keystore` is committed to this public
repository, so while its fingerprint was served anybody could build an
application Android would accept as a claimant of messagr.eu links. The Play
fingerprints had been held back until then for one reason: withdrawing the
debug key was expected to stop invitation links opening the application on the
two phones carrying an install signed by it, and moving a phone to another key
needs an uninstall that erases the account, the Megolm keys and the history.
Who decided, on what date, and what it was expected to cost are in each debug
entry's `withdraw_when` in `android-fingerprints.json`.

**What was observed on 13 September 2026**, with `pm get-app-links`, on two
builds signed by the committed debug keystore. The emulator, installed fresh
on 12 September, answered `messagr.eu: 1024`: not verified. The demonstration
Pixel, installed on 5 September and updated on 12 September, still answered
`messagr.eu: verified`, which is not what the registry expected; why it kept
that state is not established, and the other of the two phones has not been
asked. Neither says anything about the track, since verification is against
the certificate the installed copy was signed with. Where a link does open a
browser, the landing page's _Copy the link_ is what carries an invitation
across an install.

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

## The order, and it is not the obvious one either

**Publish first, point the page second, withdraw the APK third.** Doing
these in any other order sends somebody to a build that cannot do what they
are being asked to do.

**1. Put a current build on the track.** Run the `Publish` workflow on
today's `master`, `track: internal`. This is not a formality. On
12 September 2026 the only successful publish was from **5 September**, and
every capability the trial needs landed after it:

| what the trial needs                       | closed  | on the 5 September build |
| ------------------------------------------ | ------- | ------------------------ |
| inviting from the application, step 9      | 6 Sept  | no                       |
| a notification with the app closed, step 6 | 6 Sept  | no                       |
| an audio call, step 10                     | 9 Sept  | no                       |
| ringing on a locked phone, step 10         | 9 Sept  | no                       |
| vouching and eviction, step 7              | 10 Sept | no                       |

Four of the ten steps were unplayable on it, including both of the two that
#91 adds. Pointing the page at that track would have been worse than the
APK, which at least carries a current build.

Check what is on the track before trusting it. A track that has not moved
is indistinguishable from one that has.

**2. Point the page at the opt-in link.**

    MESSAGR_DEST_ANDROID='https://play.google.com/apps/internaltest/<id>' \
      MESSAGR_APK=none \
      deploy/messagr-eu/deploy.sh

`build-site.sh` refuses a value that does not land in the built page, so a
typo is a failed deployment rather than a page that serves the waiting
sentence to somebody holding a working invitation. That guard is the reason
this is one command and not a checklist.

**3. And `MESSAGR_APK=none` is not optional, it is the point.** `deploy.sh`
refuses a run that leaves the file served while the page stops offering it,
so you have to say which you want. For #91 the answer is to withdraw it: the
criterion says "installed from the internal testing track, **not
sideloaded**", and a page offering both lets the participant take the
sideload path. The trial would then measure something other than what it
claims to.

Keep the APK only if this deployment is for something other than the trial.

**And iOS stays a dead end** until `MESSAGR_DEST_IOS` has a value. See #106:
`ios: ''` is what production serves today, and an iPhone is told to ask the
person who invited them.
