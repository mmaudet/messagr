import { describe, expect, it } from 'vitest'

import { enterInvitations, type Entering } from './enterInvitations'
import type { HttpRequester } from './pump'

const http = {} as HttpRequester

function entering(over: Partial<Entering> = {}): Entering {
  return {
    http,
    invitedRooms: async () => [],
    join: async (_http, roomId) => roomId,
    ...over,
  }
}

describe('enterInvitations', () => {
  it('walks through every door that was held open', async () => {
    const entered = await enterInvitations(
      entering({ invitedRooms: async () => ['!a:x', '!b:x'] }),
    )
    expect(entered.joined).toEqual(['!a:x', '!b:x'])
    expect(entered.refused).toEqual([])
  })

  it('does nothing at all when nobody invited anybody', async () => {
    // The ordinary case, and it must be silent: this runs on every sync tick.
    const asked: string[] = []
    const entered = await enterInvitations(
      entering({
        join: async (_h, roomId) => {
          asked.push(roomId)
          return roomId
        },
      }),
    )
    expect(entered).toEqual({ joined: [], refused: [] })
    expect(asked).toEqual([])
  })

  it('does not let one room that will not open cost the others', async () => {
    // A conversation the issuer has already left, a homeserver that says no.
    // Being kept out of the next room by the last one is how somebody ends up
    // on the threshold of a conversation they were invited to.
    const entered = await enterInvitations(
      entering({
        invitedRooms: async () => ['!closed:x', '!open:x'],
        join: async (_h, roomId) => {
          if (roomId === '!closed:x') throw new Error('forbidden')
          return roomId
        },
      }),
    )
    expect(entered.joined).toEqual(['!open:x'])
    expect(entered.refused).toEqual([
      { scope: '!closed:x', reason: 'forbidden' },
    ])
  })

  it('reports a sync it could not read rather than throwing', async () => {
    // It runs on a launch and on a sync tick, and neither is a place where a
    // request that failed should take anything else down.
    const entered = await enterInvitations(
      entering({
        invitedRooms: async () => {
          throw new Error('the homeserver refused')
        },
      }),
    )
    expect(entered.joined).toEqual([])
    expect(entered.refused[0]?.reason).toBe('the homeserver refused')
  })

  it('answers what the homeserver called the room, not what it was asked', async () => {
    // `/join` answers a `room_id`, and an alias is a legitimate thing to be
    // invited by. The identifier a conversation list keys on is the one that
    // came back.
    const entered = await enterInvitations(
      entering({
        invitedRooms: async () => ['#alias:x'],
        join: async () => '!real:x',
      }),
    )
    expect(entered.joined).toEqual(['!real:x'])
  })
})
