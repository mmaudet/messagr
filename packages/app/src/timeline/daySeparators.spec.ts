import { describe, expect, it } from 'vitest'

import { separatorsFor } from './daySeparators'
import type { TimelineEntry } from './mergeTimeline'

const at = (y: number, m: number, d: number, h = 12, min = 0) =>
  new Date(y, m - 1, d, h, min).getTime()

const NOW = at(2026, 9, 6, 14, 30)

const said = (id: string, sentAt: number): TimelineEntry =>
  ({ eventId: id, sentAt, claimedSender: '@her:x', body: 'x' }) as TimelineEntry

describe('separatorsFor', () => {
  it('opens the conversation with one', () => {
    // The first thing said has a day too. Without this the oldest message is
    // the only one nobody can date.
    const marks = separatorsFor([said('$a', at(2026, 9, 6, 9))], NOW)
    expect(marks.get('$a')).toEqual({ kind: 'today' })
  })

  it('draws one only where the day changes', () => {
    const marks = separatorsFor(
      [
        said('$a', at(2026, 9, 5, 9)),
        said('$b', at(2026, 9, 5, 23, 59)),
        said('$c', at(2026, 9, 6, 0, 1)),
      ],
      NOW,
    )
    expect([...marks.keys()]).toEqual(['$a', '$c'])
  })

  it('changes day at midnight, not after twenty-four hours', () => {
    // One minute apart, and a different day. A rule written in elapsed hours
    // would put both under one separator.
    const marks = separatorsFor(
      [said('$a', at(2026, 9, 5, 23, 59)), said('$b', at(2026, 9, 6, 0, 0))],
      NOW,
    )
    expect(marks.size).toBe(2)
  })

  it('names yesterday by the calendar', () => {
    const marks = separatorsFor([said('$a', at(2026, 9, 5, 1, 0))], NOW)
    expect(marks.get('$a')).toEqual({ kind: 'yesterday' })
  })

  it('names a full date beyond that, months numbered from one', () => {
    const marks = separatorsFor([said('$a', at(2026, 1, 15))], NOW)
    expect(marks.get('$a')).toEqual({
      kind: 'date',
      day: 15,
      month: 1,
      year: 2026,
    })
  })

  it('does not draw a date in the future for a fast homeserver clock', () => {
    const marks = separatorsFor([said('$a', at(2026, 9, 8))], NOW)
    expect(marks.get('$a')).toEqual({ kind: 'today' })
  })

  it('is empty for a conversation with nothing in it', () => {
    expect(separatorsFor([], NOW).size).toBe(0)
  })

  it('keys by event id, so a screen that filters cannot mismatch', () => {
    const marks = separatorsFor(
      [said('$a', at(2026, 9, 4)), said('$b', at(2026, 9, 6))],
      NOW,
    )
    expect(marks.has('$a')).toBe(true)
    expect(marks.has('$b')).toBe(true)
  })
})
