import type { TimelineEntry } from '../timeline/mergeTimeline'
import type { Favourite } from './favouriteStore'

/**
 * The messages behind the marks, derived rather than remembered.
 *
 * # THE NOTEBOOK SAYS WHICH, NEVER WHAT
 *
 * The eighth page keeps an event identifier, a conversation and a moment.
 * It does not keep the words. That is the same line the call log holds --
 * who and when, never what was said inside -- and it is deliberate here
 * rather than inherited.
 *
 * Keeping the text would have been easy and is the thing to resist.
 * ADR-0006's amendment of 8 September put message *openings* on disk for the
 * conversation list, and this looks like the same allowance until you notice
 * what differs: that page holds the last message of each conversation and
 * overwrites it constantly, while this one would hold **the handful of
 * messages somebody went back to, in clear, for as long as they keep them**.
 * Out of everything a device could be made to give up, that is a sharper
 * selection than the conversation list ever is -- somebody chose those.
 *
 * So the words are fetched when the screen is opened and dropped when it is
 * closed, exactly as a conversation is.
 *
 * # WHAT IT COSTS, AND WHY IT IS ACCEPTABLE HERE
 *
 * One round trip per conversation that has a favourite in it, paid on
 * opening a screen nobody opens often. `conversationList.ts` makes the same
 * trade for the list and says so; the difference is that the list is drawn
 * at every launch and this is not, which is what makes the cost smaller here
 * than there.
 *
 * Sequential rather than `Promise.all`, for the reason `sendImages.ts`
 * gives: several derivations at once are several decryption passes
 * competing for the same thread while somebody waits for a screen.
 */

/** A favourite with the message it points at, when the message is still there. */
export interface KeptMessage {
  readonly favourite: Favourite
  /**
   * The entry, or `null` when it could not be found.
   *
   * `null` is a real answer and gets a line of its own on the screen: the
   * conversation may have moved beyond what one fetch reaches, the key may
   * never have arrived on this device, or the message may have been removed
   * for everyone since it was kept. A row that vanished silently would leave
   * somebody sure they had kept something they cannot find.
   */
  readonly entry: TimelineEntry | null
}

export interface ReadingFavourites {
  /** Derives a conversation, the way every other screen gets one. */
  readonly entries: (scope: string) => Promise<readonly TimelineEntry[]>
}

export async function readFavourites(
  deps: ReadingFavourites,
  favourites: readonly Favourite[],
): Promise<readonly KeptMessage[]> {
  // Grouped so a conversation is derived once however many marks it holds.
  const scopes = [...new Set(favourites.map(one => one.scope))]
  const byScope = new Map<string, ReadonlyMap<string, TimelineEntry>>()
  for (const scope of scopes) {
    try {
      const found = await deps.entries(scope)
      byScope.set(scope, new Map(found.map(entry => [entry.eventId, entry])))
    } catch {
      // A conversation that would not derive costs its own marks a line
      // saying so, and costs the others nothing. `enterInvitations.ts` makes
      // the same argument about one failure not paying for the rest.
      byScope.set(scope, new Map())
    }
  }

  // The order the page answered in, which is newest kept first.
  return favourites.map(favourite => ({
    favourite,
    entry: byScope.get(favourite.scope)?.get(favourite.eventId) ?? null,
  }))
}
