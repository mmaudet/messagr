# The application runs its own sync loop

A conversation updates while somebody is looking at it. The loop that makes
that true is the application's own — a long-polling `/sync` through
`authedRequest`, reduced by `encryptionSlice` and fed to the bridge and to the
application's own timeline. It is not matrix-js-sdk's sync loop, and adopting
it does not adopt the SDK's room or timeline model.

## Why this is a new decision and not a reversal

ADR-0005 is read as having settled that there is no live sync. It did not. It
settled that **the timeline is the application's own state**, and it argued
that from ADR-0001's exposure: `MatrixEvent.attemptDecryption` is marked
`@internal`, is not exported, and exists to put plaintext back into the SDK's
own timeline objects. An application that does not use those objects never
calls it.

The SDK's sync loop appears there in one sentence, as something the
application stops, with one reason attached: its long-polling made Detox's
network-idle tracker hang. That is a test-tooling reason. It was never argued
on product or security grounds, and it was never the decision — it was a
consequence mentioned in passing on the way to a different one.

**The two are separable, and the code already proves it.** `syncDelta.ts`
fetches `/sync` directly through `http.authedRequest` and reduces the response
with the application's own `encryptionSlice`. No `MatrixEvent`, no
`attemptDecryption`, no room model. It is called once per pump cycle with
`timeout=0`, and its own comment says what this decision now acts on:

> `timeout=0` always: this is not the app's live sync loop … No `since` token,
> and none returned: one fetch per pump cycle is all this increment needs, and
> a continuation token nothing persists or reads back would be plumbing for a
> caller that does not exist yet.

The caller now exists. A loop over the function the application already has is
live sync; it takes nothing back.

## Why it is worth the cost

Without it a message arrives when the application is relaunched. Not late —
**not at all**, until somebody closes and reopens. Everything else in the
product can be excellent and it will still not be a messenger, because the one
thing a messenger does is tell you something happened while you were not
asking.

`docs/unassisted-trial.md` predicts this will be the worst moment of the
unassisted trial, and it should not need a trial to establish.

## The cost, stated plainly

**Detox's network-idle tracker hangs on long-polling.** This is the problem
ADR-0005 sidestepped by stopping the SDK's loop, and it comes back whole. It
has to be solved rather than rediscovered: the suite must be told this request
is expected to stay open, or the loop must be suspended for the duration of a
device test. Choosing which is the first piece of work under this decision,
not an afterthought.

**A `since` token has to be persisted and read back.** `syncDelta.ts` returns
none today, deliberately. Getting this wrong is quiet in both directions: a
token that is lost replays everything, and a token that advances past
unprocessed events loses them. Neither crashes.

**A held-open connection costs battery and has to be managed.** Backgrounding,
network changes and server restarts each end a long poll in a different way,
and a loop that treats them identically will either spin or stop.

**A loop that dies silently is worse than no loop**, because the screen looks
live. Whatever this becomes has to report its own state, the way every other
runtime surface in this application already does.

## What this does not change

**The timeline stays the application's own state.** ADR-0005's core stands
untouched, and the exposure it protects against is not reopened: the loop
feeds `receiveSyncChanges` and the application's own merge, never
`MatrixEvent`. The day a timeline is built on the SDK's room model,
`attemptDecryption` returns to the path — that remains true and remains
refused.

**Nothing decrypted reaches the disk.** ADR-0006 stands, but one of its cost
paragraphs is now wrong and should be read with this: it says "this
application already fetches and decrypts on every launch. It has no live sync
loop (ADR-0005), so a launch is already a fetch." With a loop, a launch is
still a fetch, and the argument that deriving the timeline is free because the
work was happening anyway holds _more_ strongly rather than less. The costs it
names — no offline history, a slower relaunch, history bounded by what the
device can decrypt — are unchanged.

## Consequences

The SDK's `startClient()` keeps exactly one job: proving in `sessionSync.ts`
that a restored session syncs at all. It is started and stopped there and
feeds no data, which is what it already does. Anyone tempted to leave it
running to get liveness for free is taking the room model back with it.
