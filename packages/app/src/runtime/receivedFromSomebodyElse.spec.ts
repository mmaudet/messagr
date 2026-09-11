import { describe, expect, it } from 'vitest'

import type { TimelineEntry } from '../timeline/mergeTimeline'
import { receivedFromSomebodyElse } from './receivedFromSomebodyElse'

const ME = '@alice:example.org'
const THEM = '@bob:example.org'

function entry(over: Partial<TimelineEntry> = {}): TimelineEntry {
  return {
    eventId: `$${Math.random()}`,
    claimedSender: THEM,
    sentAt: 1_757_000_000_000,
    body: 'bonjour',
    ...over,
  }
}

describe('whether this device has ever read a message somebody else sent', () => {
  it('says no on a conversation nobody has written in', () => {
    expect(receivedFromSomebodyElse([], ME)).toBe(false)
  })

  it('says yes for a readable message from somebody else', () => {
    expect(receivedFromSomebodyElse([entry()], ME)).toBe(true)
  })

  it('does not count what this account sent', () => {
    // The distinction the whole trigger rests on: sending proves the account
    // works, receiving is the first time this device holds a key nobody else
    // has.
    expect(receivedFromSomebodyElse([entry({ claimedSender: ME })], ME)).toBe(
      false,
    )
  })

  it('does not count a message this device could not read', () => {
    // It proves the opposite of what is being asked -- the key is somewhere
    // else -- so a device holding only these has nothing a backup would save.
    expect(
      receivedFromSomebodyElse(
        [entry({ body: null, reason: 'missing_key' })],
        ME,
      ),
    ).toBe(false)
  })

  it('counts a photograph that came out with no text beside it', () => {
    expect(
      receivedFromSomebodyElse(
        [
          entry({
            body: null,
            image: {
              url: 'mxc://example.org/abc',
              secret: '{}',
              mimeType: 'image/jpeg',
              width: 800,
              height: 600,
              thumbnail: null,
            },
          }),
        ],
        ME,
      ),
    ).toBe(true)
  })

  it('finds the one readable message among many that are not', () => {
    // A device that recovered a single key out of a long silence has
    // something to lose, and the answer must not depend on where in the
    // conversation it happens to be.
    const mostlyLost = [
      entry({ body: null }),
      entry({ body: null }),
      entry({ body: 'enfin' }),
      entry({ body: null }),
    ]

    expect(receivedFromSomebodyElse(mostlyLost, ME)).toBe(true)
  })

  it('is not fooled by this account being the only readable sender', () => {
    const mine = [
      entry({ claimedSender: ME, body: 'écrit par moi' }),
      entry({ claimedSender: THEM, body: null }),
    ]

    expect(receivedFromSomebodyElse(mine, ME)).toBe(false)
  })
})
