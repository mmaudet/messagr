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

## Revisited, 10 September 2026 — a photograph the person asks to keep

#169's third action: an image received in a conversation can be saved to the
telephone's photo library. That writes a decrypted photograph to disk, which
is the thing this document is named after refusing.

It is allowed, and the shape of the allowance is the whole of it.

**The gallery is not this application's storage.** Every other place this
decision governs is somewhere the product chose and the person did not: a
cache, a database, a file the application reads back. The gallery is where
the camera's own pictures go — the person's own shelf, on their own device,
which they already open every day. Refusing to put anything there is not
protecting them, it is deciding for them about their own picture.

**Once, per photograph, because somebody asked.** Never on arrival, never in
the background, never as a side effect of looking at something. The
automatic version — a toggle that keeps every image as it arrives, which the
account holder has asked for and which is what WhatsApp does — is a
different decision and is not taken here. It would turn the exception back
into a cache: everything received, on disk, in clear, without a gesture.

**The plaintext exists for the length of one call.** A photograph reaches the
screen as a `data:` URI and neither platform's gallery takes one, so the
bytes are written to the temporary directory, handed over by path, and
unlinked in a `finally` — including when the hand-over fails, which is the
case a happy path would have left the plaintext behind for.

**What it costs, said plainly.** A saved photograph is outside everything
this product provides. It is backed up by whatever backs the gallery up, it
is readable by every application the person has given photo access to, and
nobody at the other end of the conversation can remove it any more. Saving
is the end of Messagr's part in that picture, and the screen says the
photograph went to the photo library rather than pretending it merely
"downloaded".

**What did not change.** Nothing is written for the application to read
back: there is still no path from the gallery into this product, and a saved
photograph is not a cache of anything. ADR-0006's amendment of 8 September —
the conversation list's openings — is the other exception, and the two are
alike in the way that matters: both are bounded, both are named, and neither
is a message store.

## Clarified, 10 September 2026 — a dependency's cache is disk

#209, found while checking that #169's own temporary file was removed:
choosing **one** photograph and sending it left three readable JPEGs in this
application's cache — two written by the image picker, one by the resizer
that makes the thumbnail. All three began `FF D8 FF`, and they were still
there minutes later.

Nothing had decided that. `imageLibrary.ts` carried an argument that this
decision was not bent by reading a file the picker had written, since the
photograph came from the person's own gallery and was on that disk before
the application existed. **That argument is right about the source and says
nothing about the copies**, which is how three of them came to sit in a
cache indefinitely.

**The rule this states, which was assumed and never written.** A directory a
dependency writes into is this application's disk. It does not matter that
the library chose the path, that the bytes came from the person's own
gallery, or that the directory is private to the process: if the application
caused a file to exist, this decision governs it.

**Why it matters even though the source was already on the device.** The
copies outlive what they copy. Delete the photograph from the gallery and
Messagr still has it, in a directory nobody thinks of as holding
photographs, on a device somebody may hand to a repair shop. That is a
different fact from "the picture is on this telephone", and nobody chose it.

**What is done about it.** Each copy is unlinked as soon as its bytes are in
memory, including on the path where a thumbnail is judged too large to keep
— which was one of the three. Nothing is unlinked unless it sits in a
directory this application owns, because a module that removes whatever path
it is handed is one bad answer away from deleting a photograph out of
somebody's gallery. And a sweep at launch clears what earlier versions left,
which is what the telephones in use are carrying now.

**This is a clarification and not an exception.** No new place is allowed to
hold plaintext. What changes is that the sentence at the top of this
document is now understood to reach a library's cache, which it always
meant.
