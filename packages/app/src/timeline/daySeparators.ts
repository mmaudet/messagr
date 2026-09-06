import type { TimelineEntry } from './mergeTimeline'

/**
 * Where a conversation changes day.
 *
 * The prototype's screen 21 asks for date separators, and they are the one
 * piece of chrome a person reads without noticing: without them a scroll back
 * through a week is an undifferentiated column, and the answer to "when was
 * that" is a timestamp with no day attached to it.
 *
 * # Local calendar days, like everything else that answers "when"
 *
 * The same rule `whenShown.ts` follows and for the same reason: a separator
 * placed by elapsed hours would break in the middle of a night. Both flatten
 * to local midnight rather than dividing a difference, because a day is not
 * always 86,400,000 milliseconds.
 *
 * # What this does not decide
 *
 * The words. This says *where* a separator goes and *what day* it names; the
 * screen asks `copy` for the rest, so "Aujourd'hui" and the month names stay
 * where every other string lives.
 */

export type DayMark =
  | { readonly kind: 'today' }
  | { readonly kind: 'yesterday' }
  | {
      readonly kind: 'date'
      readonly day: number
      /** 1 to 12, which is what the copy keys are numbered by. */
      readonly month: number
      readonly year: number
    }

/**
 * The separator to draw *before* the entry at each index, keyed by event id.
 *
 * Keyed rather than positional: a screen maps entries and would otherwise have
 * to trust that its index and this one's agree, which they stop doing the
 * moment anything filters.
 */
export function separatorsFor(
  entries: readonly TimelineEntry[],
  now: number,
): ReadonlyMap<string, DayMark> {
  const marks = new Map<string, DayMark>()
  let previous: number | null = null

  for (const entry of entries) {
    // A conversation always opens with a separator: the first thing said has
    // a day too, and starting without one leaves the oldest message as the
    // only one nobody can date.
    if (previous === null || !sameDay(previous, entry.sentAt)) {
      marks.set(entry.eventId, markFor(entry.sentAt, now))
    }
    previous = entry.sentAt
  }
  return marks
}

function markFor(at: number, now: number): DayMark {
  const then = new Date(at)
  const days = calendarDaysBetween(then, new Date(now))
  // Ahead of this device's clock counts as today, which is what `whenShown`
  // does with the same case and for the same reason: a homeserver with a fast
  // clock is not a reason to draw a date in the future.
  if (days <= 0) return { kind: 'today' }
  if (days === 1) return { kind: 'yesterday' }
  return {
    kind: 'date',
    day: then.getDate(),
    month: then.getMonth() + 1,
    year: then.getFullYear(),
  }
}

function sameDay(a: number, b: number): boolean {
  return calendarDaysBetween(new Date(a), new Date(b)) === 0
}

function calendarDaysBetween(then: Date, now: Date): number {
  const from = new Date(then.getFullYear(), then.getMonth(), then.getDate())
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((to.getTime() - from.getTime()) / 86_400_000)
}
