# A push notification carries nothing

A notification is silent. It wakes the application, which reads the sync it
was told about, decrypts locally, and posts whatever it decides to post. The
payload that crosses the push infrastructure carries no message body, no
sender, and no conversation.

## Why

Push is the only part of this product where a third party stands between two
devices and is asked to deliver something. Apple's and Google's services see
every payload, and so does the push gateway. A notification that carried "Alice:
see you at six" would defeat the encryption for the one message a person is
most likely to read, which is the one they are notified about.

The three shapes available:

- **Content in the payload.** Rejected outright.
- **Sender and conversation, no body.** Rejected too, and it is the tempting
  one. Who talks to whom and how often is the metadata this product exists to
  protect, and handing it to a push gateway per message is a better social
  graph than most services build deliberately.
- **Nothing, and a wake.** Taken.

## What it costs, and the part that is not optional

**A silent wake is not guaranteed.** Apple explicitly rate-limits
`content-available` pushes and may defer or drop them; Android doze does its
own version of the same. So there must be a visible fallback for the case where
the wake does not happen or does not finish in time.

**That fallback must also say nothing.** "New message" and nothing else — no
sender, no conversation, no count. A fallback that named the sender would
reintroduce, on exactly the unreliable path, the metadata the main path
refuses. It is the worst possible place to make an exception, because nobody
would see it happening.

**The wake has to be able to decrypt**, which is ADR-0008: without a passphrase
readable while the screen is locked, every notification takes the fallback and
this decision degrades to "nothing, ever".

**A notification the user taps must land somewhere sensible** even when the
wake failed and the application does not yet know what arrived.

## What this obliges us to keep true

The published privacy policy is a promise about this. When the push path is
built, `deploy/messagr-eu/site/confidentialite/` is read against what the code
actually sends — the same discipline `scripts/assert-retention.sh` applies to
retention, and for the same reason: a policy and an implementation drift in
silence, and only somebody reading one against the other notices.

`messagr-sygnal` is the gateway and it is already running. What it is _given_
is what this decision governs; that it exists changes nothing about the shape
of the payload.

## Consequences

Notifications for a call are the same shape as notifications for a message.
A call invitation carries no content either — "somebody is calling" is all the
payload says, and the application decides how to present it once awake. The
difference is urgency, not privacy, and urgency is a delivery priority rather
than a payload field.
