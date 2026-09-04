# Publishing the Android application

Play App Signing, the internal testing track, and what to do when the key is
lost.

## Two keys, and only one of them is an ending

This is the distinction the whole arrangement rests on, and confusing them is
the expensive mistake.

**The app signing key** is what an application's identity is permanently bound
to. A device will only accept an update signed by the same key that signed the
installed version. It cannot be changed after publication, and losing it means
the application cannot be updated by anyone, ever — the only way forward is a
new listing under a new package name, which every existing installation is
blind to.

Under Play App Signing, **Google holds it**. That is the point of enrolling.

**The upload key** is what this repository has. It proves to Play that a
bundle came from us, and nothing else. Play verifies it, strips it, and
re-signs the bundle with the app signing key before it reaches a device.

So the upload key is **replaceable**, and that replaceability is not a
convenience — it is what makes it safe to keep in a secret store, on a runner,
in the hands of continuous integration.

## Doing all of this once, guided

```
./scripts/setup-play-publishing.sh
```

Eleven stages, one task each: it opens every page, says what to click, mints
the key, sets the five secrets, builds a signed bundle **before** you touch
Play, and stops at the two things only a person can do — the first release and
installing it on a phone. Nothing it captures is written to a file in this
repository.

The rest of this document is what the wizard does, written out, for whoever
needs to do it by hand or understand what it did.

## Creating the upload key

Once, by hand, and never in this repository.

```
keytool -genkeypair -v -keystore upload.jks -alias messagr-upload \
  -keyalg RSA -keysize 4096 -validity 10000
```

`-validity 10000` is Play's own requirement: a key that expires before 22
October 2033 is refused. 4096 rather than the more commonly copied 2048, since
this key is generated once and will be trusted for a decade.

Keep `upload.jks` somewhere it survives the loss of any single machine — a
password manager's file attachment, or an encrypted archive somebody else also
holds. It is not in this repository and it is not in a cloud drive that
synchronises a laptop.

## The secrets the publish workflow needs

Set in the repository's Actions secrets:

| Secret                              | What it is                                                                                             |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `MESSAGR_UPLOAD_KEYSTORE_BASE64`    | `base64 -i upload.jks` — the keystore itself                                                           |
| `MESSAGR_UPLOAD_KEYSTORE_PASSWORD`  | the store password given to `keytool`                                                                  |
| `MESSAGR_UPLOAD_KEY_ALIAS`          | `messagr-upload`                                                                                       |
| `MESSAGR_UPLOAD_KEY_PASSWORD`       | the key password given to `keytool`                                                                    |
| `MESSAGR_PLAY_SERVICE_ACCOUNT_JSON` | a Google Cloud service account with the Play Developer API, granted release access in the Play Console |

The workflow refuses to start when the first is absent, by name, rather than
producing an unsigned bundle and failing at the upload with a message about
the bundle.

## If the upload key is lost

This is the recoverable half, and it is only recoverable if somebody knows
how. Nothing about the application ends here.

1. Generate a new upload key with the command above, into a new file.
2. Export its certificate:
   `keytool -export -rfc -keystore upload-new.jks -alias messagr-upload -file upload-certificate.pem`
3. In the Play Console, go to **Setup → App integrity → App signing**, and use
   **Request upload key reset**. Attach the certificate.
4. Google replaces the registered upload certificate, usually within a couple
   of days. Nothing is republished, no version is affected, and no
   installation on any device notices.
5. Replace the four secrets above.

Builds signed with the old upload key are refused from the moment the reset
takes effect. Nothing already published is touched.

## If the app signing key is lost

It cannot be, which is the reason for enrolling in Play App Signing. Google
holds it. There is no copy here to lose.

Had this application been published with a locally held signing key — the
arrangement the framework template leaves you in — this section would say that
the application is over and a new package name is the only path. That is the
outcome the enrolment buys away, and it is why the decision was made before
the first upload rather than after it.

## Reaching a device

`Actions → Publish → Run workflow`, track `internal`. The build is uploaded to
the internal testing track, which reaches testers listed in the Play Console
within minutes and does not go through review.

The first release is made **by hand** through the Play Console. Not because
the API is known to refuse it — Google's own documentation says nothing either
way, and the claim is folklore — but because a first release cannot go out
until the store listing, the content rating, the data safety form and the
target audience declarations are filled in, and the API fills in none of
them. Every upload after that is this workflow's.

## Why the release build is unsigned everywhere else

`device.yml` builds a release APK on every push and does not sign it. The
React Native template signed release builds with the committed debug keystore,
which produces something that installs, looks finished, and can never be
published under this identity — the template's own comment warns about it.

An unsigned release still builds, which is all that job needs: it inspects
what the artifact contains. Nothing should be installable from a build nobody
signed.
