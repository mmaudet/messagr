import type { TimelineEntry } from '../timeline/mergeTimeline'
import {
  tallyReactions,
  type LooseReaction,
  type ReactionTally,
} from '../timeline/reactions'

/**
 * What this device does not draw of a conversation, in one type and one
 * filter, wherever a conversation is drawn: in its own screen, its messages
 * and their reactions (`reactionsShown`), and in the list's previews and
 * counts (`conversationList.ts`).
 *
 * Two things, of two different kinds:
 *
 * - **The events hidden here « pour moi »** (`hiddenStore.ts`): this device's
 *   own decision, kept in its notebook, and which does not travel.
 * - **Every message of an account this one blocked** (#469, `block.ts`): the
 *   account's ignored list, which its homeserver keeps and every device of
 *   the account syncs, received before the block or not.
 */
export interface NotShown {
  /** The events hidden on this device. */
  readonly hidden: ReadonlySet<string>
  /** The accounts this account blocked, as its ignored list names them. */
  readonly blocked: ReadonlySet<string>
}

/** Nothing withheld: a device with nothing hidden and nobody blocked. */
export const EVERYTHING_SHOWN: NotShown = {
  hidden: new Set(),
  blocked: new Set(),
}

/**
 * `entries` without what this device does not draw. The same list, handed
 * back, when nothing is withheld.
 */
export function shownOf<
  T extends Pick<TimelineEntry, 'eventId' | 'claimedSender'>,
>(entries: readonly T[], notShown: NotShown): readonly T[] {
  if (notShown.hidden.size === 0 && notShown.blocked.size === 0) return entries
  return entries.filter(
    entry =>
      !notShown.hidden.has(entry.eventId) &&
      !notShown.blocked.has(entry.claimedSender),
  )
}

/**
 * Whether every one of `entries` is still drawn: a photograph open full
 * screen closes when one of its own is not (#472), as a blocked account's
 * leave the viewer with the thread.
 */
export function allShown(
  entries: readonly Pick<TimelineEntry, 'eventId' | 'claimedSender'>[],
  notShown: NotShown,
): boolean {
  return shownOf(entries, notShown).length === entries.length
}

/**
 * The reactions drawn under the messages, tallied from those this device
 * draws, by the filter the messages are drawn by and from the same value:
 * a blocked account's leave in the same render as its messages (#494,
 * ADR-0011 as amended on 30 September 2026).
 */
export function reactionsShown(
  reactions: readonly LooseReaction[],
  notShown: NotShown,
  selfUserId: string,
): ReadonlyMap<string, readonly ReactionTally[]> {
  return tallyReactions(shownOf(reactions, notShown), selfUserId)
}
