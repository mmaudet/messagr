import type { TimelineEntry } from './mergeTimeline'

/**
 * What is selected, and which actions that selection allows.
 *
 * # A SELECTION IS A SET OF IDENTIFIERS AND NOTHING ELSE
 *
 * Everything else is derived from the timeline, on demand. Holding entries
 * in the selection would be holding a second copy of the conversation, which
 * goes stale the moment a message is decrypted late or redacted -- the same
 * argument ADR-0005 makes about the timeline itself.
 *
 * # ABSENT, NEVER GREYED
 *
 * An action that does not apply to everything selected is not offered. A
 * greyed control is a control that has to be explained, and applying an
 * action to the part of a selection it happens to fit -- destroying three
 * messages of five, silently -- is worse than both.
 *
 * Copying is the one deliberate exception, and #192 writes it down: a
 * photograph contributes nothing to a clipboard, so it is skipped rather
 * than blocking the action; a selection of nothing but photographs has no
 * Copy at all.
 */

/**
 * Adds what is not there, removes what is. One gesture, both directions.
 *
 * SEVERAL AT ONCE, and all in the same direction, because a plate is one
 * thing on screen and several events underneath: it goes in and out as a
 * whole, which is what its single outline promises. The direction is the
 * first one's -- a plate half in and half out is a state nothing can draw.
 */
export function toggle(
  selected: ReadonlySet<string>,
  eventIds: readonly string[],
): ReadonlySet<string> {
  const first = eventIds[0]
  if (first === undefined) return selected
  const adding = !selected.has(first)
  const next = new Set(selected)
  for (const eventId of eventIds) {
    if (adding) next.add(eventId)
    else next.delete(eventId)
  }
  return next
}

/** The selected entries, in the order the conversation reads. */
function chosen(
  selected: ReadonlySet<string>,
  entries: readonly TimelineEntry[],
): readonly TimelineEntry[] {
  return entries.filter(entry => selected.has(entry.eventId))
}

/**
 * Whether "remove for everyone" is offered.
 *
 * Only on this account's own events. Redacting somebody else's message is a
 * moderation power, not a delete button -- and in a one-to-one it exists
 * only by an accident of room defaults that nobody chose (#196).
 *
 * A selected event the timeline does not carry blocks it too: nothing can
 * say whose it is, so nothing offers to destroy it.
 */
export function canRemoveForEveryone(
  selected: ReadonlySet<string>,
  entries: readonly TimelineEntry[],
  selfUserId: string,
): boolean {
  if (selected.size === 0) return false
  const found = chosen(selected, entries)
  if (found.length !== selected.size) return false
  return found.every(entry => entry.claimedSender === selfUserId)
}

/**
 * Whether the selection can be forwarded.
 *
 * Everything readable can: a message this device could not open has nothing
 * to send on, and a removed one has nothing left at all. Unlike Copy, a
 * photograph counts -- forwarding a picture is most of why anybody forwards.
 */
export function canForward(
  selected: ReadonlySet<string>,
  entries: readonly TimelineEntry[],
): boolean {
  const found = chosen(selected, entries)
  if (found.length === 0) return false
  return found.every(
    entry =>
      entry.removed !== true &&
      (entry.image !== undefined || entry.body !== null),
  )
}

/** Whether anything selected has words in it. */
export function canCopy(
  selected: ReadonlySet<string>,
  entries: readonly TimelineEntry[],
): boolean {
  return copyText(selected, entries) !== ''
}

/**
 * What goes into the clipboard: the bodies, in order, one per line.
 *
 * NO NAME AND NO TIME, and that is not a simplification. WhatsApp copies
 * `[10:32] Marie : …`, which cannot be done here: the names in this product
 * are local (ADR-0010 -- *"a given name says who somebody is to you, on the
 * device where you said it"*), and the clipboard is the least controlled
 * destination that exists. A format carrying the name would paste into any
 * application a name neither the homeserver nor the correspondent knows.
 *
 * A photograph contributes nothing -- pasting its file name would be pasting
 * something nobody wrote -- and neither does a message this device could not
 * read.
 */
export function copyText(
  selected: ReadonlySet<string>,
  entries: readonly TimelineEntry[],
): string {
  return chosen(selected, entries)
    .filter(entry => entry.image === undefined && entry.body !== null)
    .map(entry => entry.body)
    .join('\n')
}
