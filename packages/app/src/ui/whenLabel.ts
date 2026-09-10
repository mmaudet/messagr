import { t, type CopyKey } from '../copy'
import type { Stamp } from '../timeline/whenShown'

/**
 * A moment, as a list row says it.
 *
 * `whenShown.ts` decides *which* of the four shapes a moment takes — a time,
 * yesterday, a weekday, a date — and this says it in words. The two are
 * apart because the first is arithmetic worth testing without a catalogue
 * and the second is six catalogues with no arithmetic in them.
 *
 * Shared rather than copied: it was written twice the moment a second list
 * needed it, and two copies of a date format are two chances for two lists
 * to disagree about what "yesterday" looks like.
 */
export function whenLabel(stamp: Stamp): string {
  switch (stamp.kind) {
    case 'time':
      return t(
        'when_time %1$d %2$d',
        stamp.hours,
        String(stamp.minutes).padStart(2, '0'),
      )
    case 'yesterday':
      return t('yesterday')
    case 'weekday':
      return t(`day_short_${stamp.day}` as CopyKey)
    case 'date':
      return t('when_date %1$d %2$d', stamp.day, stamp.month)
  }
}
