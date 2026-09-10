# Given names live in an encrypted store of our own

The name one participant gives another — the _given name_ of `CONTEXT.md` — is
kept in a SQLite database belonging to the application, encrypted with a
passphrase of its own in the operating system's keystore. Not in ordinary
application storage, and not in the crypto store.

## Why there has to be somewhere

Identifiers here are pseudonymous by design: `@rabr642vve6v:messagr.eu` is what
the protocol offers, and a list of conversations showing those is a list
nobody can read. The inviter is the one person who knows who they invited —
that is already the ground the vouching gesture stands on — so the name they
give is the only readable thing available that costs no pseudonymity.

## Why not the obvious two places

**Not ordinary application storage.** ADR-0006 refuses decrypted message bodies
on disk. A given name is not a message body, and reading the letter of that
decision would allow it. Reading its _reason_ does not: a book of who you talk
to and what you call them is as revealing as what you said to them, and often
more — it survives when the messages are gone, it is short enough to read at a
glance, and it is exactly what somebody holding the device would look for
first.

**Not the crypto store.** It belongs to `react-native-matrix-crypto`, which
owns its schema. Writing product rows into a library's database means the
library cannot migrate it, and it would mean asking the bridge for a
general-purpose key-value surface — a third capability on top of the two this
lot already needs from it. The bridge is for cryptography, not for storing
whatever the product finds convenient.

## What this costs

**A second database and a second secret.** Two things to open at launch, two
things to migrate, two things a support conversation has to distinguish. The
passphrase is deliberately _not_ shared with the crypto store: one secret for
two stores means compromising either gives both, which trades a real property
for the convenience of one fewer keychain entry.

**Nothing here survives a reinstall.** The given names go with the store, and
they are not in the crypto store's recovery path either — ADR-0004's
cross-signing brings an identity back, not a private notebook. Somebody who
reinstalls gets their conversations back as pseudonyms and has to name them
again. That is worth saying in the product rather than discovering.

**And nothing here is backed up**, for ADR-0008's reason: the passphrase is
`ThisDeviceOnly`, so a restored device would hold a database it cannot open.
Same shape as the crypto store, same answer, deliberately.

## Consequences

Given names never reach the homeserver, never reach the other participant, and
never appear in a push payload (ADR-0009 sends no name at all, so this follows
without a separate rule). Two devices belonging to the same person can hold
different given names for the same participant, and that is correct rather
than a synchronisation defect: a given name says who somebody is _to you_, on
the device where you said it.

## Revisited, 10 September 2026 — a call may say how long it lasted

The notebook grew past given names into a small set of pages that all keep
the same kind of thing: what this device knows about the people it talks to,
in a form only this device can read. The fourth of them is the call log, and
it was written refusing one field — **a duration is the one field that would
make a stolen notebook say how long two people spoke.**

The refusal was asked to be lifted, by the person whose notebook it is, and
it is lifted.

**The line was drawn at the wrong field.** The page already keeps who, when,
and how often. This document calls that class of fact « as revealing as what
you said to them, and often more »; `callLogStore.ts` opens by calling a list
of who you telephone and when « the most revealing thing this product holds
— the shape of a life ». Against a reader who has all of that, _and it lasted
thirty-two minutes_ is the smaller sentence. It is not the field that turns
the page dangerous; the page was already the dangerous one, and it is kept
anyway because the alternative is a product that cannot show a missed call.

**The threat is answered where it is answered.** « A stolen notebook » is a
reader who has both the file and the keystore secret. Everything on these
seven pages is lost at once to that reader — the names, the read marks, the
call log, the openings of the last messages ADR-0006 put here on 8 September.
A per-field refusal does not defend against them; it only makes the product
worse for everybody else. What defends against them is ADR-0008: the
passphrase is `ThisDeviceOnly`, so the file does not travel and does not
restore.

**What is still refused, and this has not moved.** No content of any kind. A
duration is a fact about the call, of the same kind as its outcome and its
hour; what was said inside it is not this device's business to keep, and no
page of this notebook holds any of it. The duration is measured from the
pick-up rather than from the first ring, so a row says how long two people
were connected and never how long one of them waited.

**What this cost.** One integer column per call, and a threat model that is
now written down instead of assumed. The `-1` default is the column saying it
does not know, kept distinct from a zero, which is a call that ended in the
second it began.
