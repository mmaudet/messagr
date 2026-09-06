import { describe, expect, it } from 'vitest'

import { stampFor } from './whenShown'

/** Local time throughout, because that is what a person reads. */
const at = (
  year: number,
  month: number,
  day: number,
  hours = 12,
  minutes = 0,
) => new Date(year, month - 1, day, hours, minutes).getTime()

const NOW = at(2026, 9, 6, 14, 30)

describe('stampFor', () => {
  it('shows the time for something sent today', () => {
    expect(stampFor(at(2026, 9, 6, 9, 38), NOW)).toEqual({
      kind: 'time',
      hours: 9,
      minutes: 38,
    })
  })

  it('says yesterday for the previous calendar day', () => {
    expect(stampFor(at(2026, 9, 5, 23, 59), NOW)).toEqual({ kind: 'yesterday' })
  })

  it('says yesterday by the calendar, not by twenty-four hours', () => {
    // Sent at one in the morning yesterday, read at half past two this
    // afternoon: nearly two days of elapsed time, and still "yesterday" to
    // anybody reading a calendar. A rule written in milliseconds gets this
    // backwards.
    expect(stampFor(at(2026, 9, 5, 1, 0), NOW)).toEqual({ kind: 'yesterday' })
  })

  it('shows the time for something sent minutes ago', () => {
    const stamp = stampFor(at(2026, 9, 6, 14, 25), NOW)
    expect(stamp.kind).toBe('time')
  })

  it('names the weekday within the week', () => {
    // 2026-09-01 is a Tuesday; getDay() numbers Sunday as 0.
    expect(stampFor(at(2026, 9, 1), NOW)).toEqual({ kind: 'weekday', day: 2 })
  })

  it('falls back to a date once a weekday would be ambiguous', () => {
    // Seven days back is the same weekday as today, which names two days.
    expect(stampFor(at(2026, 8, 30), NOW)).toEqual({
      kind: 'date',
      day: 30,
      month: 8,
      year: 2026,
    })
  })

  it('numbers months from one, which is what the copy keys are numbered by', () => {
    const stamp = stampFor(at(2026, 1, 15), NOW)
    expect(stamp).toEqual({ kind: 'date', day: 15, month: 1, year: 2026 })
  })

  it('shows a time rather than a date for something dated in the future', () => {
    // A homeserver with a fast clock, or a device with a slow one. Neither is
    // a reason to draw "in 3 days" on a row, and today is the least wrong
    // thing to say about a message that has already arrived.
    expect(stampFor(at(2026, 9, 8, 10, 0), NOW).kind).toBe('time')
  })

  it('crosses a year without becoming a weekday', () => {
    expect(stampFor(at(2025, 12, 31), NOW).kind).toBe('date')
  })
})
