import { describe, expect, it } from 'vitest'

import type { TimelineEntry } from '../timeline/mergeTimeline'
import { countUnread } from './unread'

const ME = '@me:messagr.eu'
const THEM = '@them:messagr.eu'

const said = (
  eventId: string,
  sentAt: number,
  claimedSender: string,
): TimelineEntry =>
  ({
    eventId,
    sentAt,
    claimedSender,
    body: 'something',
    reason: undefined,
  }) as unknown as TimelineEntry

describe('countUnread', () => {
  it('counts what arrived after the mark', () => {
    const entries = [
      said('$a', 100, THEM),
      said('$b', 200, THEM),
      said('$c', 300, THEM),
    ]
    expect(countUnread(entries, 150, ME)).toBe(2)
  })

  it('does not count this account talking to itself', () => {
    // Sending is not receiving. A count that included what this device sent
    // would show a badge on every conversation the moment somebody used it.
    const entries = [said('$a', 200, ME), said('$b', 300, THEM)]
    expect(countUnread(entries, 100, ME)).toBe(1)
  })

  it('counts everything when the conversation has never been opened', () => {
    const entries = [said('$a', 100, THEM), said('$b', 200, THEM)]
    expect(countUnread(entries, 0, ME)).toBe(2)
  })

  it('is nothing once the mark has caught up', () => {
    const entries = [said('$a', 100, THEM), said('$b', 200, THEM)]
    expect(countUnread(entries, 200, ME)).toBe(0)
  })

  it('treats the mark as inclusive', () => {
    // The mark is the newest event that was *read*, not the oldest unread.
    // An exclusive reading leaves every conversation permanently showing one.
    expect(countUnread([said('$a', 200, THEM)], 200, ME)).toBe(0)
  })

  it('ignores what this device cannot read, because it cannot preview it', () => {
    // A message held for a key this device does not have is still a message
    // that arrived, and it counts. Only a row's *preview* needs to be
    // readable; a count does not.
    const entries = [
      { ...said('$a', 300, THEM), body: null } as unknown as TimelineEntry,
    ]
    expect(countUnread(entries, 100, ME)).toBe(1)
  })
})
