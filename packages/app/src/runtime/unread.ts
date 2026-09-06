import type { TimelineEntry } from '../timeline/mergeTimeline'

/**
 * How much of a conversation has not been looked at.
 *
 * # The mark is local, and that is the design rather than a shortcut
 *
 * Matrix computes an unread count of its own, from the read receipts a client
 * publishes. This application will not lean on it: receipts are public
 * metadata (`receiptSetting.ts` says why), they are off unless somebody turns
 * them on, and a badge that only worked for people who had agreed to be
 * observed would be a privacy setting that quietly costs a feature.
 *
 * So the mark is kept on the device, in the application's own encrypted
 * notebook (`lastReadStore.ts`), and it means exactly what a person means by
 * it: *the newest thing that was on screen the last time you looked at this
 * conversation, here.* Reading on another device does not clear it, and that
 * is honest — this device does not know you read it.
 *
 * # Inclusive, because a mark names what was read
 *
 * The mark is the newest event that **was** read, not the oldest that was
 * not. Comparing with `>` rather than `>=` is the whole difference between a
 * conversation that clears and one that sits on `1` forever.
 */

export function countUnread(
  entries: readonly TimelineEntry[],
  /** The newest event read here, by the homeserver's clock. `0` for never. */
  lastReadAt: number,
  selfUserId: string,
): number {
  return entries.filter(
    entry => entry.sentAt > lastReadAt && entry.claimedSender !== selfUserId,
  ).length
}
