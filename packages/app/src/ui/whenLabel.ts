import { t, type CopyKey } from '../copy'
import type { Stamp } from '../timeline/whenShown'

/**
 * A moment, as a list row says it.
 *
 * `whenShown.ts` decides *which* of the four shapes a moment takes — a time,
 * yesterday, a weekday, a date — and this says it in words. The two are
 * apart because the first is arithmetic worth testing without a catalogue
 * and the second is one line per catalogue with no arithmetic in it.
 *
 * Shared rather than copied: it was written twice the moment a second list
 * needed it, and two copies of a date format are two chances for two lists
 * to disagree about what "yesterday" looks like.
 */
/**
 * A day in the reader's own words, « 24 octobre 2026 ». The day separators of
 * a conversation and the dates of « Être trouvable » say it with this one key.
 */
export function dateLabel(day: number, month: number, year: number): string {
  return t('date_separator', day, t(`month_${month}` as CopyKey), year)
}

/** The time of day a moment falls on, in the telephone's time: « 14:05 ». */
export function timeOf(milliseconds: number): string {
  const moment = new Date(milliseconds)
  return hourLabel(moment.getHours(), moment.getMinutes())
}

/**
 * An hour and its minutes, « 14:05 ». Minutes are padded here rather than in
 * a copy template, because two digits is not a question of language while
 * the separator between them is.
 */
function hourLabel(hours: number, minutes: number): string {
  return t('when_time %1$d %2$d', hours, String(minutes).padStart(2, '0'))
}

/** The day a moment falls on, in the telephone's time, as `dateLabel` says it. */
export function dayOf(milliseconds: number): string {
  const day = new Date(milliseconds)
  return dateLabel(day.getDate(), day.getMonth() + 1, day.getFullYear())
}

export function whenLabel(stamp: Stamp): string {
  switch (stamp.kind) {
    case 'time':
      return hourLabel(stamp.hours, stamp.minutes)
    case 'yesterday':
      return t('yesterday')
    case 'weekday':
      return t(`day_short_${stamp.day}` as CopyKey)
    case 'date':
      return t('when_date %1$d %2$d', stamp.day, stamp.month)
  }
}
