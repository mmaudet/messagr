import { describe, expect, it } from 'vitest'

import type { TimelineEntry } from '../timeline/mergeTimeline'
import { readReceiptsFor, readUpTo } from './receipts'

const ME = '@me:x'
const HER = '@her:x'

function entry(
  eventId: string,
  claimedSender: string,
  sentAt: number,
): TimelineEntry {
  return { eventId, claimedSender, sentAt, body: 'x' }
}

const TIMELINE = [
  entry('$m1', ME, 100),
  entry('$h1', HER, 150),
  entry('$m2', ME, 200),
  entry('$m3', ME, 300),
]

describe('readUpTo', () => {
  it('marks a message read when somebody’s receipt reaches it', () => {
    expect([...readUpTo(TIMELINE, [{ reader: HER, upTo: '$m2' }], ME)]).toEqual(
      ['$m1', '$m2'],
    )
  })

  it('treats a receipt as a high-water mark, not a single event', () => {
    // Matrix receipts say "read up to and including", so an earlier message
    // of this account's is read too even though no receipt names it.
    const read = readUpTo(TIMELINE, [{ reader: HER, upTo: '$m3' }], ME)
    expect(read.has('$m1')).toBe(true)
    expect(read.has('$m3')).toBe(true)
  })

  it('takes the furthest receipt when there are several', () => {
    const read = readUpTo(
      TIMELINE,
      [
        { reader: HER, upTo: '$m1' },
        { reader: HER, upTo: '$m3' },
      ],
      ME,
    )
    expect(read.size).toBe(3)
  })

  it('marks nothing on this account’s own receipt', () => {
    // Reading one's own messages says nothing, and counting it would show
    // every message as read the moment it was sent.
    expect(readUpTo(TIMELINE, [{ reader: ME, upTo: '$m3' }], ME).size).toBe(0)
  })

  it('never marks somebody else’s message as read by them', () => {
    const read = readUpTo(TIMELINE, [{ reader: HER, upTo: '$m3' }], ME)
    expect(read.has('$h1')).toBe(false)
  })

  it('ignores a receipt pointing at an event this device has not fetched', () => {
    // Not a reason to guess: it resolves when the event does, and until then
    // the message is shown as sent, which it is.
    expect(
      readUpTo(TIMELINE, [{ reader: HER, upTo: '$absent' }], ME).size,
    ).toBe(0)
  })

  it('marks nothing when nobody has read anything', () => {
    expect(readUpTo(TIMELINE, [], ME).size).toBe(0)
  })
})

describe('readReceiptsFor', () => {
  const sync = (events: unknown) => ({
    rooms: { join: { '!a:x': { ephemeral: { events } } } },
  })

  it('reads a receipt out of the ephemeral section', () => {
    expect(
      readReceiptsFor(
        sync([
          {
            type: 'm.receipt',
            content: { $m2: { 'm.read': { [HER]: { ts: 1 } } } },
          },
        ]),
        '!a:x',
      ),
    ).toEqual([{ reader: HER, upTo: '$m2' }])
  })

  it('ignores a private receipt, which is somebody asking not to publish it', () => {
    expect(
      readReceiptsFor(
        sync([
          {
            type: 'm.receipt',
            content: { $m2: { 'm.read.private': { [HER]: { ts: 1 } } } },
          },
        ]),
        '!a:x',
      ),
    ).toEqual([])
  })

  it('ignores anything that is not a receipt', () => {
    expect(
      readReceiptsFor(sync([{ type: 'm.typing', content: {} }]), '!a:x'),
    ).toEqual([])
  })

  it('finds nothing for a conversation that is not in the response', () => {
    expect(readReceiptsFor(sync([]), '!other:x')).toEqual([])
  })

  it('finds nothing rather than throwing on a shape it did not expect', () => {
    expect(readReceiptsFor({}, '!a:x')).toEqual([])
    expect(readReceiptsFor({ rooms: 'nope' }, '!a:x')).toEqual([])
    expect(readReceiptsFor(sync('nope'), '!a:x')).toEqual([])
    expect(readReceiptsFor(sync([null, 7]), '!a:x')).toEqual([])
    expect(
      readReceiptsFor(
        sync([{ type: 'm.receipt', content: { $m: 7 } }]),
        '!a:x',
      ),
    ).toEqual([])
  })
})
