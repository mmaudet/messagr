import type { ConversationSummary } from './conversationList'

/**
 * How many conversations this device cannot read the last message of.
 *
 * # WHAT `offerRestore` MEANS BY «&nbsp;UNREADABLE&nbsp;», COUNTED
 *
 * That module asks for *"how many entries in view this device could not
 * read"* and argues at length why it is that rather than "is the store
 * fresh": a fresh store is true on a device that has never had a
 * conversation, where the offer is noise, and false on one whose keys were
 * partly lost, where the offer is exactly what is wanted.
 *
 * The list is where the answer lives, because the list is what has already
 * drawn when the offer appears.
 *
 * # A REASON **AND** A TIMESTAMP, WHICH IS THE OPPOSITE PAIR TO `mergeSummaries`
 *
 * The two modules read the same two fields and want opposite rows, and
 * saying so once here is cheaper than discovering it twice:
 *
 * - `reason` **with** a timestamp is a conversation that exists, has
 *   something in it, and whose last message this device cannot open. That is
 *   the state a restore fixes, so it counts here — and it is the state
 *   `mergeSummaries` passes through untouched, because it is a true row.
 * - `reason` **without** one is a derivation that did not run: the network,
 *   not the keys. Restoring a backup would fix nothing, so it does not count
 *   — and it is exactly the row `mergeSummaries` replaces with what it
 *   remembered.
 *
 * A device with no signal would otherwise be offered a restore for a problem
 * a key cannot solve, which is the worst possible moment to ask somebody for
 * their only copy of a secret.
 */
export function unreadableConversations(
  summaries: readonly ConversationSummary[],
): number {
  return summaries.filter(row => row.reason !== undefined && row.lastAt > 0)
    .length
}
