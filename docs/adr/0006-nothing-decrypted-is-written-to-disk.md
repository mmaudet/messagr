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

## Revisited, 12 September 2026 — a file another application hands over, on iOS

#242: somebody looking at a photograph or a document in another application
chooses Messagr from the system's share sheet, then a conversation, and the
file is sent sealed. The gesture people already have.

**Android needed no exception and took none.** What crosses is an address —
a `content://`, a name, a type, a size — and the bytes are read only once a
conversation has been chosen. Nothing is copied anywhere. That half shipped
without touching this document, and it is the standard the iOS half is
measured against rather than an accident of the platform.

**iOS cannot do that, and the reason is a process boundary.** A share
extension is a separate process with its own sandbox. The file it is handed
is readable inside that process and nowhere else: the containing application
cannot open it, and the address is worth nothing on the other side. The only
route the system provides is a shared container both processes can reach —
which the clarification of 10 September says plainly is this application's
disk, because this application caused the file to exist.

So the iOS half needs an exception, and the shape of it is the whole of it.

**One file, for one crossing, and nothing else.** The shared container holds
exactly one thing: the file being handed over, written by the extension and
read by the application. It never holds the store, the notebook, a cache, a
log, or a second copy of anything. A container that accumulates is a cache
with a different name.

**Removed as soon as its bytes are in memory, in a `finally`.** The same
shape as the photograph somebody asks to keep, and for the same reason: the
path that fails is the path a happy-path implementation leaves plaintext on.
And swept at launch as well, because an extension can be killed between
writing and handing over — nobody would ever remove that one, and it is the
orphan this rule exists for.

**Excluded from device backup.** `NSURLIsExcludedFromBackupKey` on the
directory. Without it a file that exists for seconds can be copied to iCloud
and outlive the gesture by years, somewhere nobody thinks of as holding
someone's documents.

**The extension holds no keys, and this is refused rather than deferred.**
Three shapes were considered and all three are refused:

- _The extension sends the message itself._ It would need the crypto store,
  which means two processes on one Megolm store. A lost or forked Megolm
  session makes a room unreadable **forever**, for everyone in it. That is
  not a risk to be managed, it is a defect with no repair.
- _The extension shows the conversation list, so the person picks before
  anything is written._ The list is a page of the encrypted notebook
  (ADR-0010), under a keystore-held passphrase. Reading it means handing the
  extension that secret, which is ADR-0008's ground and a real widening of
  what an attacker reaches. The saving is one copy that lives for seconds;
  the price is a key in a second process, permanently.
- _A security-scoped bookmark instead of a copy._ It does not survive the
  crossing: what the extension is handed is temporary and scoped to the
  extension's own life, so the application resolves nothing.

The extension therefore does one thing: write the file and wake the
application. The person picks a conversation in the application, exactly as
on Android, and the sealing happens where the keys already are.

**What it costs, said plainly.** Between the share gesture and the moment the
application reads the file, a decrypted document sits in a directory this
application owns. That window is short but it is not zero, and on a device
whose keystore is defeated it is one more place to look. The Android half has
no such window, and saying the two halves are equivalent would be false.

**What did not change.** Nothing is written for the application to read back
later: the file is handed over once and removed, and there is no path from
the container into anything the product keeps. The exceptions this document
carries — the conversation list's openings, a file somebody asks to keep, and
this crossing — are alike in the way that matters: each is bounded, each is
named, and none of them is a message store.

## Clarified, 12 September 2026 — "a photograph" was always "a file"

The paragraph above first counted "three exceptions" and named the second
"a photograph somebody asks to keep". That was the amendment's own wording
from 10 September, and by 12 September it had stopped being true of the
code: #111 added documents, and `keepDocument.ts` saves one by the same
mechanism — temporary file, handed over by path, unlinked in a `finally` —
arguing in its own words that "the reasoning transfers whole".

It does transfer whole, and that is why this is a clarification and not a
fourth exception. What the 10 September amendment decided is not a policy
about photographs; it is a policy about **a file the person asks to keep**,
and every sentence of it holds word for word when the file is a PDF: the
destination is one the person chose rather than one the product picked, it
happens once per file and never in the background, the plaintext exists for
the length of one call, and what leaves is outside everything this product
provides.

Two things differ, and neither changes the decision. A document goes through
the system's own "save as" rather than to the photo library, so the person
names the destination instead of accepting a known one — which is weaker
disclosure, not stronger. And a document has no thumbnail, so nothing
resizes it and there is no second copy to sweep: the trap #209 found on the
photograph path cannot exist here.

**Why this is written down rather than left as an analogy.** Because the
analogy lived only in `keepDocument.ts`, and this document — the one anybody
checks when they want to know what the product allows — enumerated its
exceptions and left the document out. An ADR that contradicts the code
teaches the wrong thing to whoever reads it first, and the reader who trusts
it is the one who then removes an "undocumented" `write` in good faith.

**When to revisit.** If iOS ever offers the containing application a readable
handle to an extension's item, this exception should go rather than be kept
for symmetry: the Android shape is the better one and it is only the platform
that prevents it here.
