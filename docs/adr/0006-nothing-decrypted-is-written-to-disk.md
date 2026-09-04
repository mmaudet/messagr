# Nothing decrypted is written to disk

The conversation a person sees is derived, never stored. Reopening the
application asks the homeserver for the room again and decrypts it again. No
plaintext message body is written to the device's storage.

## Why

ADR-0005 settled that the timeline is the application's own state. It did not
say where that state lives between launches, and #48 forced the question:
"the conversation survives a relaunch" is satisfied by two very different
designs.

The obvious one keeps the decrypted messages in local storage. It is what
most messengers do, it is fast, and it works offline. It also means that every
message the person has ever read sits in cleartext on the device, in a file
whose protection is whatever the operating system's app sandbox happens to
give it.

The other derives the timeline again on each launch, from ciphertext the
homeserver still holds and Megolm sessions the crypto store already keeps.

We take the second, and the reason it costs little here is specific rather
than general: this application already fetches and decrypts on every launch.
It has no live sync loop (ADR-0005), so a launch is already a fetch. Deriving
the timeline is not extra work bolted on; it is the work that was happening
anyway, kept rather than duplicated into a second store.

## What this buys

An attacker holding the device finds ciphertext and a crypto store. That store
is encrypted with a 32-byte random passphrase held in the operating system's
own keystore (#55), so reading the history requires defeating the keystore,
not reading a file.

It also removes a class of defect rather than a single one. A second copy of
the conversation is a second thing to keep consistent: a message edited,
redacted or decrypted late has to be reconciled in both places, and the two
drift in ways that are hard to see and harder to test.

## What it costs, plainly

**There is no offline history.** Opening the application without a network
shows nothing but what this launch could fetch. For a messenger that is a real
loss, and it is the strongest argument against this decision.

**A relaunch is slower.** The conversation appears after a round trip and a
decryption pass rather than instantly.

**History is bounded by what the device can still decrypt.** A Megolm session
this device never received, or one lost with a reinstalled store, leaves a
message that will not open — and no local copy to fall back on. Those gaps are
shown rather than hidden, which is the honest version of the same limitation.

## When to revisit

Offline history is a product requirement nobody has stated yet. When it is
stated, this decision is the one to reopen, and the answer is probably an
encrypted local store keyed from the same keystore secret rather than a
cleartext one — which is a different decision from the one taken here, not a
reversal of it.

Key backup, if it ever lands, changes the third cost above but not this
decision: it makes more history decryptable, not more of it stored in clear.
