import type { TimelineEntry } from '../timeline/mergeTimeline'

/**
 * Whether a pass over a conversation found a message from somebody else that
 * this device could read.
 *
 * # WHAT THIS IS FOR
 *
 * `offerBackup.ts` turns on three facts, and this is where one of them comes
 * from: *« Received, not sent: sending proves the account works, receiving
 * is the first time this device holds a key nobody else has. »* A readable
 * message from another person is that proof — the key that opened it was
 * made elsewhere and now exists here and nowhere else.
 *
 * # WHY A PREDICATE OVER THE RESULT, AND NOT A HOOK IN THE LOOP
 *
 * The live sync loop hands back timeline events **still encrypted**
 * (`syncLoop.ts`'s `SyncTick.timelineEvents`), so it cannot answer this: at
 * that point nothing has been read and nothing is known to be readable.
 * `toTimelineEntries` is what decrypts, and it is a builder rather than a
 * place for side effects.
 *
 * So the question is asked of what it built. That keeps the decryption path
 * exactly as pure as it was, keeps this testable with an array and no
 * device, and puts the write where the caller already knows whose account
 * this is — which this module does not and must not have to guess.
 *
 * # UNREADABLE DOES NOT COUNT, AND THAT IS THE POINT
 *
 * An entry whose `body` is `null` is one this device could not open. It
 * proves the opposite of what is being asked: the key is somewhere else. A
 * device with nothing but those has nothing a backup would save, so offering
 * one would be offering to protect an absence.
 *
 * # THE SENDER IS UNAUTHENTICATED, AND IT DOES NOT MATTER HERE
 *
 * `claimedSender` carries that warning in its name and `TimelineEntry` says
 * why. This is not a trust decision: it asks whether there is something here
 * worth keeping, and both ways of being wrong are harmless. A forged sender
 * claiming to be this account under-counts, so no offer is made and a line
 * in Réglages still is. A forged sender claiming somebody else over-counts,
 * and the cost is an offer made slightly early for a device that does hold a
 * key it did not create.
 *
 * # WHAT IT CANNOT TELL APART
 *
 * A message that arrived encrypted from one that arrived in clear:
 * `TimelineEntry` does not record which, because no screen has ever needed
 * to know. Strictly, only the first is evidence of a key. The distinction
 * would matter in a product with unencrypted conversations, and this one has
 * none — every conversation here is encrypted, so a plaintext message is an
 * anomaly rather than a case. Written down so that the day it stops being
 * true, this is the line that has to change.
 */
export function receivedFromSomebodyElse(
  entries: readonly TimelineEntry[],
  self: string,
): boolean {
  return entries.some(
    entry =>
      entry.claimedSender !== self &&
      // A photograph is a message that was read even when its `body` is
      // null: an `m.image` keeps its fallback name there sometimes and not
      // others, and either way the picture came out of the key.
      (entry.body !== null || entry.image !== undefined),
  )
}
