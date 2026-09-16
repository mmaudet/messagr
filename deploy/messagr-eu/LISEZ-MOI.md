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
      aide/                   the help page: Apple's support URL, and the
                              account deletion resource Play requires, at
                              #supprimer-votre-compte (#333)
    build-site.sh             produces the served tree; run in CI
    deploy.sh                 publishes it to the server
    nginx-messagr-eu.conf     the vhost
    purge-jetons-journaux.sh  takes invitation tokens out of logs already written
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

## The invitation token and the server's log

The invitation link carries its token in the path,
`https://messagr.eu/i/<token>`, and that token is a bearer secret: while the
invitation is neither claimed nor expired, it lets somebody in. Until
15 September 2026 nginx wrote that whole path into its access log, and
`/etc/logrotate.d/nginx` keeps that log for 366 days — so every invitation
opened in a browser left its token readable on the server for up to a
year (#313).

**The vhost stops the bleeding.** A `map` on `$request_uri` and a
`log_format messagr_sans_jeton`, declared at the top of
`nginx-messagr-eu.conf` and set on `location /i/` and on `location = /i`. The
line still carries the date, the IP address, the status, the size and the
user agent — `retention.json` declares twelve months for connection data and
the decree imposes it — but the path reads `/i/...` and the referer reads
`-`. It is the token that goes, not the line.

**Three ASCII dots and not `…`, and that was measured.** nginx escapes every
byte above 0x7E carried by a _variable_ in the log, so the ellipsis arrives
written `\xE2\x80\xA6`. The only way to keep it readable would be
`escape=none`, which would also stop escaping the user agent — text the caller
chooses, and through which they could then write newlines into the log.

**`purge-jetons-journaux.sh` deals with what has already been written**, the
current log and the archived `.gz` alike. It rewrites the path, it never drops
an entry: it refuses to replace a file that does not come out with exactly as
many lines as went in, because a connection-log line is kept for twelve months
by law. It is idempotent, it never prints a token, and it refuses to write at
all until the deployed vhost carries `messagr_sans_jeton` — purging before the
vhost is deployed would clean a file nginx is still filling with tokens.

    # measure first, writes nothing, and does not need the vhost deployed
    deploy/messagr-eu/purge-jetons-journaux.sh --dry-run /var/log/nginx

    # then, with the owner's agreement, as root on hermes
    deploy/messagr-eu/purge-jetons-journaux.sh /var/log/nginx

`tests/journal-sans-jeton.js` holds both halves: the shape of the `map`, of
the `log_format` and of the two `access_log`, and the purge itself against a
fabricated log tree with fake tokens — current file, rotated file and `.gz`,
run twice.

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
It was asked on 13 September 2026, and the answer was no. `assetlinks.json`
then named the two certificates read off the Play console on 6 September 2026,
a _classic_ one and a _post-quantum_ one, served since #135 on 7 September. A
Galaxy S22 Ultra on Android 16, holding version 130 from the closed testing
track, answered `messagr.eu: 1024` and `messagr-fork.maudet.cloud: 1024`, and
named a third certificate as its signature, `46:AC:3F:6A:…:FE:EC:55`.
GoogleAssociationService had fetched `assetlinks.json` two seconds after that
install and got a 200: the file was reachable, and it did not name the key.

`apksigner verify --print-certs -v` on the `base.apk` pulled from that phone
says why. Play signs an install three times. A **v3.2 hybrid** signature
carries the classic and post-quantum certificates the console shows, and
Android honours it from API level 37 (Android 17) only. A **v3.0** signature
carries a third certificate, and every earlier device presents that one. So
from 7 to 13 September 2026 no phone below Android 17 could verify messagr.eu
links, and a person had to tick messagr.eu by hand under _Open by default_.
`android-fingerprints.json` now records all three with the command that
reproduces each, as `play-app-signing`, `play-app-signing-pq` and
`play-app-signing-v3`, and `assetlinks.json` declares all three.

**Observed verified on 14 September 2026.** A Pixel 10 on Android 16, holding
version 135 installed from the internal testing track that evening, presented
`46:AC:3F:6A:…:FE:EC:55` as its signature and answered `messagr.eu: verified`
and `messagr-fork.maudet.cloud: verified`, with nothing ticked by hand. Google's
Digital Asset Links API answered `linked: true` for that certificate on both
domains the same day. On any other device that installed from the track, the
check stays the same: ask Android to verify again, then read the answer.
`messagr.eu: verified` is the one that settles it.

**And since 16 September 2026, the bench is no longer claimed** (#287). The
application declared `messagr-fork.maudet.cloud` beside messagr.eu, on both
platforms, so that an invitation issued on the bench would open it too. The
inventory that decision asked for found nothing depending on it, and a build
installed from a store should not claim a domain that is not the service it
serves. A phone updated after that date will therefore answer nothing at all
for the bench host, which is the expected reading and not a regression. The
line above records what a Pixel 10 answered on 14 September, before the
change.

    adb shell pm verify-app-links --re-verify eu.messagr
    adb shell pm get-app-links eu.messagr

Worth running again before anybody is invited, rather than finding out at step
1 of `docs/unassisted-trial.md`. And a store fingerprint is measured on an
install, not only on the console: the console showed two certificates, and
the install carries three.

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
asked. That install of the Pixel no longer exists: it was removed at 05:31 UTC
the same morning and a debug build of `master` put in its place
(`docs/production-entry-point.md`). Neither says anything about the track,
since verification is against the certificate the installed copy was signed
with.

**Where a link does open a browser, the landing page does not carry the
invitation into the application.** This paragraph used to say its _Copy the
link_ did. That button put `location.href` on the clipboard and promised a
paste the application never offered, and #278 removed it. What
`site/i/index.html` does:

- _Open in Messagr_ is `href=""`, the page's own https address and not
  `messagr://`, so it reaches the application on the same condition as the
  link itself (expected, not observed on a device).
- Below it, shown on every platform, with or without script, one sentence:
  _"After installing, open the link again from the message you received: that
  is what opens Messagr."_ Nothing on the page touches the clipboard.

The application has no other way in: it has no field for a link and never
reads the clipboard, and its list, opened without a link, says
`list_not_in_yet`, _"Open the invitation link somebody sent you: it is the
only door"_. What carries an invitation across an install is the link opened
again once the application is there, which is what that sentence asks for
and all _Open in Messagr_ does, so when the system sends that link to a
browser nothing on the page gets past it.
`docs/unassisted-trial.md` treats a link that opens a browser on a build from
the track as a hard stop for this reason.

**The iPhone destination.** `DESTINATIONS.ios` is empty and the page says so
honestly, because no iOS build is published anywhere. It wants a TestFlight
address; the slot is already there and `build-site.sh` refuses a value that is
not a plain https address, or one that does not land in the built page.

**The walk itself.** #106's last criterion is one invitation opened end to end
on a phone that never had the application. Its fourth criterion had the person
paste the link until it was corrected on 13 September 2026 to say there is no
paste step, since the application has no paste: the walk that exists is link,
landing, install, the link opened again, first launch (language, terms),
claim. Nothing here proves that.

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
    curl -sS -o /dev/null -w '%{http_code}\n' https://messagr.eu/aide
    deploy/messagr-eu/tests/identical-page-invitation.sh /tmp/messagr-site \
      deploy/messagr-eu/nginx-messagr-eu.conf --live
    node deploy/messagr-eu/tests/conformite-site-deploye.js --live

`deploy.sh` runs the last of those itself, at the end. When the deployment
offers no download it also runs
`node deploy/messagr-eu/tests/telechargement-retire.js --live`, which reads
every page this repository builds as the server answers it, and fails on any
page that still names the file. On 13 September 2026 the six landing pages
kept a badge pointing at a withdrawn download, while the one page the
deployment read said there was none.

## Pointing Android at Play, and the address that is NOT the right one

**Done on 13 September 2026.** `MESSAGR_DEST_ANDROID` has been set since the
deployment of 03:33 UTC, and the site was deployed again the same morning
with

    MESSAGR_DEST_ANDROID='https://play.google.com/apps/internaltest/4701142005580137400' \
      MESSAGR_APK=none \
      deploy/messagr-eu/deploy.sh

Read off the served page afterwards (`last-modified: Sun, 13 Sep 2026
05:45:05 GMT`): `DESTINATIONS.android` is that link, `androidApk` and `ios`
are empty, and `https://messagr.eu/messagr.apk` answers `404`. An Android
phone is offered the internal testing track and no download.

Until then the page offered the self-hosted APK and nothing else, and #91
needs the opposite: a trial that installs from the internal testing track,
because what is being tested includes the distribution. What follows says why
that value, because **the obvious value is wrong**.

**Not this.** `https://play.google.com/store/apps/details?id=eu.messagr` is
the address of a published application. On an internal track, anybody who is
not already an enrolled tester gets "item not found" from it. Wiring that
would give most people a dead end, which would have been worse than the APK
they had then.

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

Step 1 was run on 12 September 2026, before the page was pointed at the
track: `Publish` on `864d580`, `track: internal`, run 34709655215, successful.

**2. Point the page at the opt-in link.**

    MESSAGR_DEST_IOS='https://testflight.apple.com/join/<code>' \
      MESSAGR_DEST_ANDROID='https://play.google.com/apps/internaltest/<id>' \
      MESSAGR_APK=none \
      deploy/messagr-eu/deploy.sh

`MESSAGR_DEST_IOS` is there because every deployment must carry every
destination: see the end of this section.

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

**iOS has had its destination since 14 September 2026.** Until then the page
served `ios: ''`, and an iPhone was told to ask the person who invited them
(#106). That morning, build 1.0 (25) was approved for external TestFlight
testing, and the site was deployed with the public link of the external
group:

    MESSAGR_DEST_IOS='https://testflight.apple.com/join/WDqApzKx' \
      MESSAGR_DEST_ANDROID='https://play.google.com/apps/internaltest/4701142005580137400' \
      MESSAGR_APK=none \
      deploy/messagr-eu/deploy.sh

`conformite-site-deploye.js --live` then found the 44 files this repository
builds, destinations included.

**That is the command for every deployment of the site from now on**, even
one that only corrects a sentence. `deploy.sh` does not remember the previous
values: a destination left out is served empty, and that platform falls back
to the waiting sentence. The live check cannot see it, because it builds its
reference from the same incomplete environment.
