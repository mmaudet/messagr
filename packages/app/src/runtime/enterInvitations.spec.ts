import { describe, expect, it } from 'vitest'

import { enterInvitations, type Entering } from './enterInvitations'
import type { HttpRequester } from './pump'

const http = {} as HttpRequester

/** An invitation from nobody in particular, which is most of them. */
const from = (...scopes: string[]) =>
  scopes.map(scope => ({ scope, from: null }))

function entering(over: Partial<Entering> = {}): Entering {
  return {
    http,
    invitedRooms: async () => [],
    join: async (_http, roomId) => roomId,
    alreadyWith: async () => new Set(),
    decline: async () => undefined,
    ...over,
  }
}

describe('enterInvitations', () => {
  it('walks through every door that was held open', async () => {
    const entered = await enterInvitations(
      entering({ invitedRooms: async () => from('!a:x', '!b:x') }),
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
    expect(entered).toEqual({ joined: [], refused: [], collapsed: [] })
    expect(asked).toEqual([])
  })

  it('does not let one room that will not open cost the others', async () => {
    // A conversation the issuer has already left, a homeserver that says no.
    // Being kept out of the next room by the last one is how somebody ends up
    // on the threshold of a conversation they were invited to.
    const entered = await enterInvitations(
      entering({
        invitedRooms: async () => from('!closed:x', '!open:x'),
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

  it('declines an invitation from somebody there is already a conversation with', async () => {
    // Two people in contact can each issue the other a link, and nothing at
    // the issuing end can know who will open one. This end can.
    const declined: string[] = []
    const entered = await enterInvitations(
      entering({
        invitedRooms: async () => [{ scope: '!second:x', from: '@her:x' }],
        alreadyWith: async () => new Set(['@her:x']),
        decline: async (_h, roomId) => {
          declined.push(roomId)
        },
      }),
    )
    expect(entered.joined).toEqual([])
    expect(entered.collapsed).toEqual([{ scope: '!second:x', from: '@her:x' }])
    expect(declined).toEqual(['!second:x'])
  })

  it('enters an invitation from somebody new, whoever else is known', async () => {
    const entered = await enterInvitations(
      entering({
        invitedRooms: async () => [{ scope: '!first:x', from: '@him:x' }],
        alreadyWith: async () => new Set(['@her:x']),
      }),
    )
    expect(entered.joined).toEqual(['!first:x'])
    expect(entered.collapsed).toEqual([])
  })

  it('enters when it cannot tell who issued the invitation', async () => {
    // The stripped state need not carry the creation event. A door that will
    // not open is worse than a conversation too many.
    const entered = await enterInvitations(
      entering({
        invitedRooms: async () => from('!unknown:x'),
        alreadyWith: async () => new Set(['@her:x']),
      }),
    )
    expect(entered.joined).toEqual(['!unknown:x'])
  })

  it('enters when it cannot find out who it already talks to', async () => {
    // Same reasoning, and this is the failure that would otherwise lock
    // somebody out of every conversation at once.
    const entered = await enterInvitations(
      entering({
        invitedRooms: async () => [{ scope: '!a:x', from: '@her:x' }],
        alreadyWith: async () => {
          throw new Error('the homeserver refused')
        },
      }),
    )
    expect(entered.joined).toEqual(['!a:x'])
    expect(entered.collapsed).toEqual([])
  })

  it('asks who it already talks to only when there is an invitation', async () => {
    // It runs on every sync tick, and the question costs a call per
    // conversation.
    let asked = 0
    await enterInvitations(
      entering({
        alreadyWith: async () => {
          asked += 1
          return new Set()
        },
      }),
    )
    expect(asked).toBe(0)
  })

  it('leaves the invitation standing when the refusal will not send', async () => {
    const entered = await enterInvitations(
      entering({
        invitedRooms: async () => [{ scope: '!second:x', from: '@her:x' }],
        alreadyWith: async () => new Set(['@her:x']),
        decline: async () => {
          throw new Error('the homeserver refused')
        },
      }),
    )
    expect(entered.collapsed).toEqual([])
    expect(entered.refused).toEqual([
      { scope: '!second:x', reason: 'the homeserver refused' },
    ])
  })

  it('answers what the homeserver called the room, not what it was asked', async () => {
    // `/join` answers a `room_id`, and an alias is a legitimate thing to be
    // invited by. The identifier a conversation list keys on is the one that
    // came back.
    const entered = await enterInvitations(
      entering({
        invitedRooms: async () => from('#alias:x'),
        join: async () => '!real:x',
      }),
    )
    expect(entered.joined).toEqual(['!real:x'])
  })
})
