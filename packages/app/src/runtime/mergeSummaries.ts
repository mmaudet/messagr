import type { ConversationSummary } from './conversationList'

/**
 * Keeps what a row already said when the derivation could not say it again.
 *
 * # THE DEFECT THIS EXISTS FOR
 *
 * Reported from the demonstration Pixel on 11 September 2026: *« je suis en
 * réseau limité avec perte de réseau et je m'aperçois que cela bloque,
 * ralentit l'affichage des conversations »*.
 *
 * `listCacheStore.ts` already draws the last list instantly, so a device with
 * no network at all keeps its rows: `fetchJoinedRooms` rejects, the whole
 * derivation rejects, and nothing replaces what is on screen.
 *
 * The failure is the PARTIAL network, which is what a train or a lift
 * actually is. `/joined_rooms` gets through; the one `/messages` request per
 * conversation does not. `summarise` guards each row on its own -- correctly,
 * so one bad conversation does not fail a list -- and hands back a row with
 * `preview: null`, `lastAt: 0` and a reason. That row then replaced a good
 * one on screen, **and was written to the notebook over it**, so the next
 * launch drew the damaged version too. A moment of bad signal cost a list
 * that had been right for days.
 *
 * `lastAt: 0` also sorts the row to the bottom, so the list reorders itself
 * while somebody is looking at it. That is the "ralentit" in the report: not
 * latency, movement.
 *
 * # WHAT COUNTS AS A ROW THAT FAILED
 *
 * A reason AND no timestamp. Both, because either alone is an ordinary
 * answer this must not touch:
 *
 * - A reason with a timestamp is a conversation whose **last message** could
 *   not be read -- the keys never arrived, or it was removed. That is a true
 *   row and `list_unreadable` is the sentence for it.
 * - No timestamp without a reason is a conversation nothing has been said
 *   in. Also true, also not a failure.
 *
 * Only the pair means the derivation itself did not run.
 *
 * # AND ONLY WHEN THE REMEMBERED ROW IS BETTER
 *
 * A remembered row with no timestamp of its own has nothing to offer, so the
 * fresh answer stands. Preferring it would be preferring an older way of
 * knowing nothing.
 *
 * # DEPARTURES STILL TAKE EFFECT
 *
 * Driven by the derived list and never by the remembered one: a conversation
 * that is gone from `/joined_rooms` is gone from here, whatever is
 * remembered about it. A merge that unioned the two would resurrect
 * conversations somebody left.
 */
export function mergeSummaries(
  /** What is on screen: the cache on the first frame, a derivation after. */
  shown: readonly ConversationSummary[],
  /** What was just derived. Drives the result, row for row. */
  derived: readonly ConversationSummary[],
): readonly ConversationSummary[] {
  if (shown.length === 0) return derived

  const remembered = new Map(shown.map(row => [row.scope, row]))

  const merged = derived.map(row => {
    if (!failed(row)) return row
    const before = remembered.get(row.scope)
    if (before === undefined || before.lastAt === 0) return row
    return before
  })

  // SORTED AGAIN, because a kept row brings its own timestamp back with it
  // and the derived list was ordered when every one of them was zero. The
  // same comparison `fetchConversationSummaries` uses, for the same reason:
  // two conversations that do not swap places between launches.
  return [...merged].sort(
    (a, b) => b.lastAt - a.lastAt || a.scope.localeCompare(b.scope),
  )
}

function failed(row: ConversationSummary): boolean {
  return row.reason !== undefined && row.lastAt === 0
}
