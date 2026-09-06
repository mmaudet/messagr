import type { TimelineEntry } from '../timeline/mergeTimeline'

/**
 * Who has read what, and the one thing Matrix does not offer.
 *
 * # There is no "delivered"
 *
 * #84 asks for sent and delivered to be distinguishable, and names them as
 * different from a read receipt. In Matrix they are not three things, they are
 * two: the homeserver accepting an event, and somebody's client saying it has
 * been read. There is no signal between them — nothing reports that a device
 * received an event without also saying a person saw it.
 *
 * So this application shows **sent** and **read**, and does not invent a
 * middle. A tick that meant "probably arrived" would be a guess drawn as a
 * fact, and the one thing worse than not knowing whether a message arrived is
 * being told it did when nobody knows.
 *
 * # A receipt is a high-water mark
 *
 * Matrix receipts say "read up to and including this event", not "read this
 * event". So a receipt on any event of this account's own marks every earlier
 * one read too, and the ordering that decides "earlier" is the homeserver's
 * timestamp — the only ordering `mergeTimeline` and this agree on.
 */

/** A receipt somebody left, as it comes out of a sync. */
export interface Receipt {
  readonly reader: string
  /** The event they have read up to, inclusive. */
  readonly upTo: string
}

/**
 * Which of this account's own messages somebody else has read.
 *
 * `others` only: this account reading its own messages says nothing, and a
 * screen that counted it would show every message as read the moment it was
 * sent.
 */
export function readUpTo(
  entries: readonly TimelineEntry[],
  receipts: readonly Receipt[],
  selfUserId: string,
): ReadonlySet<string> {
  const timestamps = new Map(
    entries.map(entry => [entry.eventId, entry.sentAt]),
  )

  let highest: number | null = null
  for (const receipt of receipts) {
    if (receipt.reader === selfUserId) continue
    const at = timestamps.get(receipt.upTo)
    // A receipt pointing at an event this device has not fetched is not a
    // reason to guess. It will resolve when the event does, and until then
    // the message is shown as sent, which it is.
    if (at === undefined) continue
    if (highest === null || at > highest) highest = at
  }
  if (highest === null) return new Set()

  const mark = highest
  return new Set(
    entries
      .filter(
        entry => entry.claimedSender === selfUserId && entry.sentAt <= mark,
      )
      .map(entry => entry.eventId),
  )
}

/**
 * Reads the receipts out of a `/sync` response.
 *
 * They arrive in the ephemeral section, which `syncResponse.ts` deliberately
 * does not read for anything else — a field read by nobody goes stale without
 * anything failing, and this is the first reader it has.
 *
 * Everything is read defensively. This walks four levels of a structure the
 * homeserver could have sent differently, and a walk that assumed its shape
 * would turn a strange response into a crash inside the live loop.
 */
export function readReceiptsFor(
  sync: Record<string, unknown>,
  scope: string,
): Receipt[] {
  return readAllReceipts(sync).get(scope) ?? []
}

/**
 * The same, for every joined conversation at once.
 *
 * What the live sync loop reports: one poll observes receipts for whatever
 * moved, and which conversation is on screen is the caller's question, not
 * the loop's.
 */
export function readAllReceipts(
  sync: Record<string, unknown>,
): ReadonlyMap<string, Receipt[]> {
  const joined = asRecord(asRecord(sync.rooms)?.join)
  const byScope = new Map<string, Receipt[]>()
  if (joined === null) return byScope
  for (const scope of Object.keys(joined)) {
    const found = receiptsIn(
      asRecord(asRecord(joined[scope])?.ephemeral)?.events,
    )
    if (found.length > 0) byScope.set(scope, found)
  }
  return byScope
}

function receiptsIn(events: unknown): Receipt[] {
  if (!Array.isArray(events)) return []

  const receipts: Receipt[] = []
  for (const event of events as readonly unknown[]) {
    const typed = asRecord(event)
    if (typed?.type !== 'm.receipt') continue
    const content = asRecord(typed.content)
    if (content === null) continue

    for (const [upTo, kinds] of Object.entries(content)) {
      // `m.read` only. `m.read.private` is a receipt somebody asked not to
      // publish, and honouring that is the whole point of the setting this
      // sits under.
      const readers = asRecord(asRecord(kinds)?.['m.read'])
      if (readers === null) continue
      for (const reader of Object.keys(readers)) {
        receipts.push({ reader, upTo })
      }
    }
  }
  return receipts
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}
