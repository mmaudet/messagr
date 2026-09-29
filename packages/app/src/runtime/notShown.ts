import type { TimelineEntry } from '../timeline/mergeTimeline'

/**
 * What this device does not draw of a conversation, in one type and one
 * filter, wherever a conversation is drawn: in its own screen, and in the
 * list's previews and counts (`conversationList.ts`).
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
