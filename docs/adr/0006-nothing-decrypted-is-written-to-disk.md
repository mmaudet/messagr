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
It has no live sync loop (ADR-0005), so a launch is already a fetch.
(ADR-0007 gives it one, which strengthens this argument rather than
weakening it: the work was happening anyway, and now it happens more often.) Deriving
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

## Revisited, 8 September 2026 — the conversation list, and only the list

The second cost was stated as a requirement, from the demonstration Pixel:
_« lorsque l'app s'ouvre sur mon pixel, l'écran de conversations s'affiche au
bout de plusieurs secondes — faudrait trouver un moyen que cela s'affiche
immédiatement. Cache… »_

Measured on that telephone, the seven seconds are: three quarters of a second
of JavaScript and keystore, then a client start and an initial sync, then two
key queries and an upload, then two `/joined_rooms`, and only then one round
trip and one decryption pass per conversation. The list needs none of it to
draw what it drew last time.

So the conversation list — one line per conversation, the line the list
already shows — is kept in the application's own encrypted notebook
(ADR-0010), as its fifth page, under the same keystore-held passphrase as the
names, the read marks and the calls. It is read at the top of the launch,
before anything asks the network a question, and written by every derivation
after it.

This is the answer the paragraph above predicted, taken for the narrower of
the two requirements: **an encrypted store keyed from a keystore secret, not
a cleartext one.**

**What is kept, and what is not.** A row's preview is the opening of the last
message, which is plaintext, and it is now on disk. What is not kept is the
conversation: opening one still derives it from ciphertext, exactly as
before. An attacker holding the device and defeating the keystore learns the
openings of the last messages, which is a real cost and a bounded one, and
not the history.

**The three costs above, now.** Offline history is unchanged — there is still
none, and a launch with no network shows the last known list and nothing
behind it, which is more honest than a blank screen and less than a
messenger. A relaunch is no longer slower to _look at_; it is still exactly
as slow to be _right_. The third cost is untouched.

**What did not change.** ADR-0005 still holds: the timeline is derived, and
nothing here caches a conversation. The day somebody asks for offline
history, that is a third decision and a much larger one — this page is one
line per conversation, and growing it into a message store would be the
reversal this ADR refuses rather than the amendment it invited.
