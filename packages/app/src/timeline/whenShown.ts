/**
 * When a conversation last moved, in the form a list row shows it.
 *
 * The mockup draws four: `09:38` today, `hier`, `lun.` within the week, and a
 * date beyond that. They are four rather than one because a row has room for
 * about five characters and a person reading a list is asking a different
 * question at each distance — *what time*, *which day*, *how long ago*.
 *
 * # Calendar days, not elapsed hours
 *
 * "Yesterday" at one in the morning means the day before, not
 * twenty-four hours ago. A rule written in milliseconds would show `hier` for
 * something sent this morning and a time for something sent last night, which
 * is exactly backwards. So the comparison is on local calendar days
 * throughout — and local, because a person reads their own clock and not
 * UTC's.
 *
 * # What this does not decide
 *
 * The words. This says *which* of the four to show and with what numbers; the
 * screen asks `copy` for the rest, so the day names and the date order stay
 * where every other string lives.
 */

export type Stamp =
  | { readonly kind: 'time'; readonly hours: number; readonly minutes: number }
  | { readonly kind: 'yesterday' }
  /** `day` is `Date.getDay()`: 0 is Sunday. */
  | { readonly kind: 'weekday'; readonly day: number }
  | {
      readonly kind: 'date'
      readonly day: number
      /** 1 to 12, which is what the copy keys are numbered by. */
      readonly month: number
      readonly year: number
    }

/** How many days back a weekday name still identifies a day unambiguously. */
const WITHIN_THE_WEEK = 7

export function stampFor(at: number, now: number): Stamp {
  const then = new Date(at)
  const today = new Date(now)

  const days = calendarDaysBetween(then, today)

  if (days <= 0) {
    return {
      kind: 'time',
      hours: then.getHours(),
      minutes: then.getMinutes(),
    }
  }
  if (days === 1) return { kind: 'yesterday' }
  if (days < WITHIN_THE_WEEK) return { kind: 'weekday', day: then.getDay() }

  return {
    kind: 'date',
    day: then.getDate(),
    month: then.getMonth() + 1,
    year: then.getFullYear(),
  }
}

/**
 * Whole local days from `then` to `now`, ignoring the time of day.
 *
 * Built by flattening both to midnight rather than by dividing a difference:
 * a day is not always 86,400,000 milliseconds — twice a year it is an hour
 * longer or shorter — and a division would put the wrong label on everything
 * sent near midnight on those two days.
 */
function calendarDaysBetween(then: Date, now: Date): number {
  const a = new Date(then.getFullYear(), then.getMonth(), then.getDate())
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((b.getTime() - a.getTime()) / 86_400_000)
}
