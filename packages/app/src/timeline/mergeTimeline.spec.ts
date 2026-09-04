import { describe, expect, it } from 'vitest'

import { mergeTimeline, type TimelineEntry } from './mergeTimeline'

function entry(over: Partial<TimelineEntry> = {}): TimelineEntry {
  return {
    eventId: '$a',
    claimedSender: '@someone:messagr.eu',
    sentAt: 1000,
    body: 'bonjour',
    ...over,
  }
}

describe('mergeTimeline', () => {
  it('puts messages in the order they were sent', () => {
    const merged = mergeTimeline(
      [],
      [
        entry({ eventId: '$c', sentAt: 3000 }),
        entry({ eventId: '$a', sentAt: 1000 }),
        entry({ eventId: '$b', sentAt: 2000 }),
      ],
    )
    expect(merged.map(m => m.eventId)).toEqual(['$a', '$b', '$c'])
  })

  it('never shows the same message twice', () => {
    // The same event arrives again on every later sync, because a sync
    // returns a window rather than only what is new to this application.
    const first = mergeTimeline([], [entry({ eventId: '$a' })])
    const again = mergeTimeline(first, [entry({ eventId: '$a' })])
    expect(again).toHaveLength(1)
  })

  it('orders two messages sent in the same millisecond by their identifier', () => {
    // Timestamps collide, and a comparison that returned zero would leave the
    // order to whatever the sort happened to do -- which is a conversation
    // that reshuffles itself between launches.
    const merged = mergeTimeline(
      [],
      [
        entry({ eventId: '$z', sentAt: 1000 }),
        entry({ eventId: '$a', sentAt: 1000 }),
      ],
    )
    expect(merged.map(m => m.eventId)).toEqual(['$a', '$z'])
  })

  it('lets a message that finally decrypted replace the one that could not', () => {
    // A room key can arrive after the message it unlocks. The entry is the
    // same event, so it must not appear twice, and the readable version is
    // the one worth keeping.
    const held = mergeTimeline(
      [],
      [entry({ eventId: '$a', body: null, reason: 'no room key yet' })],
    )
    const opened = mergeTimeline(held, [
      entry({ eventId: '$a', body: 'salut' }),
    ])
    expect(opened).toHaveLength(1)
    expect(opened[0]?.body).toBe('salut')
  })

  it('does not let an unreadable copy replace one already readable', () => {
    // The reverse of the case above, and it happens: a later round can offer
    // the same event before its key is loaded again. Losing a message that
    // had been read once would be worse than never reading it.
    const read = mergeTimeline([], [entry({ eventId: '$a', body: 'salut' })])
    const after = mergeTimeline(read, [
      entry({ eventId: '$a', body: null, reason: 'no room key yet' }),
    ])
    expect(after[0]?.body).toBe('salut')
  })

  it('keeps what could not be decrypted rather than hiding it', () => {
    // A gap a person can see is a gap they can act on -- reopen the
    // application, ask the sender again. A gap silently closed is one they
    // will never know cost them something.
    const merged = mergeTimeline(
      [],
      [entry({ eventId: '$a', body: null, reason: 'no room key' })],
    )
    expect(merged).toHaveLength(1)
    expect(merged[0]?.body).toBeNull()
  })

  it('leaves the list it was given untouched', () => {
    const before = mergeTimeline([], [entry({ eventId: '$a' })])
    const copy = [...before]
    mergeTimeline(before, [entry({ eventId: '$b', sentAt: 2000 })])
    expect(before).toEqual(copy)
  })

  it('merges nothing into nothing without complaining', () => {
    expect(mergeTimeline([], [])).toEqual([])
  })
})
