# The timeline stays on the application's own state

The application renders conversations from state it holds itself, reading raw
events out of raw syncs and decrypting them through the bridge. It does not
adopt matrix-js-sdk's room and timeline model.

## Why

ADR-0001 named plaintext re-injection as the largest exposure to an upstream
break in the whole design: `MatrixEvent.attemptDecryption` accepts a
duck-typed decryptor and works, but is marked `@internal` and is not
exported. The first increment did not take that exposure, and the reason is
exactly this decision — the internal method exists to put plaintext back into
the SDK's own timeline objects, and an application that does not use those
objects never calls it.

Adopting the SDK's model would also reopen a decision this one already
settled. That model is populated by the SDK's sync loop, which this
application deliberately stops after its first sync (`sessionSync.ts`), and
whose long-polling is what made Detox's network-idle tracker hang before it
was stopped. Taking the model means taking the loop back.

## What this decided, and what it did not

**It did not decide that there is no live sync.** The sentence above about
stopping the SDK's loop is a consequence of not taking its model, with a
test-tooling reason attached — Detox's network-idle tracker hung on
long-polling. It was never argued on product or security grounds, and it was
read afterwards as settling a question it never asked.

ADR-0007 asks that question and answers it: the application runs a sync loop
**of its own**, over the `/sync` fetch it already performs through
`authedRequest`. That takes nothing back. What this decision refuses —
`MatrixEvent`, `attemptDecryption`, the SDK's room model — stays refused.

## The cost, stated plainly

Pagination, ordering, deduplication, gap handling and read markers are
machinery the SDK's model would have provided and that this application now
has to write. That is real work, and it is work with subtle failure modes:
a timeline that silently drops an event is harder to notice than one that
crashes.

This decision is worth revisiting if that machinery grows beyond what a
conversation view genuinely needs. What it must not be revisited _for_ is
convenience on a single screen, because the exposure returns whole.

## Consequences

Whoever builds the conversation view inherits ADR-0001's paragraph on this,
not as background but as a constraint: the day a timeline is built on the
SDK's room model, `attemptDecryption` comes back into the path and the
largest named exposure of the design is taken after all.

The round trip that proves both directions of encryption
(`packages/app/e2e/roundTrip.test.ts`) is what watches the surfaces this
leaves load-bearing — `client.http.authedRequest`, which matrix-js-sdk calls
intended private, and the raw sync shape, which moves with the homeserver
rather than with a dependency bump. Neither is a documented contract, and
neither fails quietly under that test.
