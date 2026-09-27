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
    // NO LINK SPENT, SO NO INVITATION EXPECTED, which is the resting state of
    // a device nobody has just invited anywhere. Every test below that expects
    // a door to open says how many links were spent for it.
    awaited: () => 0,
    // AND NO INVITATION DELIVERED INSIDE THE APPLICATION JOINED (#404), for
    // the same reason.
    awaitedDeliveries: () => [],
    ...over,
  }
}

describe('enterInvitations', () => {
  it('walks through the door the link it spent held open', async () => {
    const entered = await enterInvitations(
      entering({ invitedRooms: async () => from('!a:x'), awaited: () => 1 }),
    )
    expect(entered.joined).toEqual(['!a:x'])
    expect(entered.refused).toEqual([])
    expect(entered.waiting).toEqual([])
  })

  it('walks through one door per link spent', async () => {
    const entered = await enterInvitations(
      entering({
        invitedRooms: async () => from('!a:x', '!b:x'),
        awaited: () => 2,
      }),
    )
    expect(entered.joined).toEqual(['!a:x', '!b:x'])
  })

  it('leaves an invitation no link was spent for waiting', async () => {
    // Nothing is entered and nothing is declined: it stands exactly as it
    // arrived, for the screen of §13.3 to put to the person.
    const asked: string[] = []
    const entered = await enterInvitations(
      entering({
        invitedRooms: async () => [{ scope: '!a:x', from: '@her:x' }],
        join: async (_h, roomId) => {
          asked.push(roomId)
          return roomId
        },
        decline: async (_h, roomId) => {
          asked.push(roomId)
        },
      }),
    )
    expect(entered.joined).toEqual([])
    expect(entered.collapsed).toEqual([])
    expect(entered.waiting).toEqual([{ scope: '!a:x', from: '@her:x' }])
    expect(asked).toEqual([])
  })

  it('leaves the invitations beyond the one it waited for waiting', async () => {
    const entered = await enterInvitations(
      entering({
        invitedRooms: async () => from('!expected:x', '!other:x'),
        awaited: () => 1,
      }),
    )
    expect(entered.joined).toEqual(['!expected:x'])
    expect(entered.waiting).toEqual([{ scope: '!other:x', from: null }])
  })

  it('asks nothing at all about an invitation it is not waiting for', async () => {
    // A tick with nothing to enter has nothing to decide, and who this
    // account already talks to costs a call per conversation to find out.
    const entered = await enterInvitations(
      entering({
        invitedRooms: async () => from('!a:x'),
        alreadyWith: async () => {
          throw new Error('this tick had nothing to decide')
        },
      }),
    )
    expect(entered.waiting).toEqual([{ scope: '!a:x', from: null }])
    expect(entered.refused).toEqual([])
  })

  it('does nothing at all when nobody invited anybody', async () => {
    // The ordinary case, and it must be silent: this runs on every sync tick.
    const asked: string[] = []
    const entered = await enterInvitations(
      entering({
        awaited: () => 1,
        join: async (_h, roomId) => {
          asked.push(roomId)
          return roomId
        },
      }),
    )
    expect(entered).toEqual({
      joined: [],
      doors: 0,
      delivered: [],
      refused: [],
      collapsed: [],
      waiting: [],
    })
    expect(asked).toEqual([])
  })

  it('does not let one room that will not open cost the others', async () => {
    // A conversation the issuer has already left, a homeserver that says no.
    // Being kept out of the next room by the last one is how somebody ends up
    // on the threshold of a conversation they were invited to.
    const entered = await enterInvitations(
      entering({
        invitedRooms: async () => from('!closed:x', '!open:x'),
        awaited: () => 2,
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
        awaited: () => 1,
        invitedRooms: async () => {
          throw new Error('the homeserver refused')
        },
      }),
    )
    expect(entered.joined).toEqual([])
    expect(entered.waiting).toEqual([])
    expect(entered.refused[0]?.reason).toBe('the homeserver refused')
  })

  it('declines an invitation from somebody there is already a conversation with', async () => {
    // Two people in contact can each issue the other a link, and nothing at
    // the issuing end can know who will open one. This end can.
    const declined: string[] = []
    const entered = await enterInvitations(
      entering({
        invitedRooms: async () => [{ scope: '!second:x', from: '@her:x' }],
        awaited: () => 1,
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

  it('counts a conversation it declined as the invitation it waited for', async () => {
    // The link was spent, the invitation it opened arrived, and it was
    // answered -- by a refusal, because a conversation with that person is
    // already there. Nothing is owed after it, so the next invitation waits.
    const entered = await enterInvitations(
      entering({
        invitedRooms: async () => [
          { scope: '!second:x', from: '@her:x' },
          { scope: '!other:x', from: '@him:x' },
        ],
        awaited: () => 1,
        alreadyWith: async () => new Set(['@her:x']),
      }),
    )
    expect(entered.collapsed).toEqual([{ scope: '!second:x', from: '@her:x' }])
    expect(entered.joined).toEqual([])
    expect(entered.waiting).toEqual([{ scope: '!other:x', from: '@him:x' }])
  })

  it('enters an invitation from somebody new, whoever else is known', async () => {
    const entered = await enterInvitations(
      entering({
        invitedRooms: async () => [{ scope: '!first:x', from: '@him:x' }],
        awaited: () => 1,
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
        awaited: () => 1,
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
        awaited: () => 1,
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
        awaited: () => 1,
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
        awaited: () => 1,
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
        awaited: () => 1,
        join: async () => '!real:x',
      }),
    )
    expect(entered.joined).toEqual(['!real:x'])
  })
})

describe('the room invite of an invitation delivered inside the application (#404)', () => {
  const ALICE = { id: 'inv-alice', inviter: '@alice:x' }

  it('is entered when it comes from the inviter of an invitation joined, spends no link, and answers that invitation', async () => {
    const entered = await enterInvitations(
      entering({
        invitedRooms: async () => [
          { scope: '!alice:x', from: '@alice:x' },
          { scope: '!stranger:x', from: '@carol:x' },
        ],
        awaitedDeliveries: () => [ALICE],
      }),
    )

    expect(entered.joined).toEqual(['!alice:x'])
    expect(entered.doors).toBe(0)
    expect(entered.delivered).toEqual(['inv-alice'])
    expect(entered.waiting).toEqual([
      { scope: '!stranger:x', from: '@carol:x' },
    ])
  })

  it('answers one invitation per room: a second room from the same inviter waits', async () => {
    const entered = await enterInvitations(
      entering({
        invitedRooms: async () => [
          { scope: '!first:x', from: '@alice:x' },
          { scope: '!second:x', from: '@alice:x' },
        ],
        awaitedDeliveries: () => [ALICE],
      }),
    )

    expect(entered.joined).toEqual(['!first:x'])
    expect(entered.delivered).toEqual(['inv-alice'])
    expect(entered.waiting).toEqual([{ scope: '!second:x', from: '@alice:x' }])
  })

  it('answers two invitations from the same inviter with two rooms, the oldest first', async () => {
    const entered = await enterInvitations(
      entering({
        invitedRooms: async () => [
          { scope: '!first:x', from: '@alice:x' },
          { scope: '!second:x', from: '@alice:x' },
        ],
        awaitedDeliveries: () => [
          ALICE,
          { id: 'inv-alice-later', inviter: '@alice:x' },
        ],
      }),
    )

    expect(entered.joined).toEqual(['!first:x', '!second:x'])
    expect(entered.delivered).toEqual(['inv-alice', 'inv-alice-later'])
  })

  it('answers nothing when the room would not open, so the next tick tries again', async () => {
    const entered = await enterInvitations(
      entering({
        invitedRooms: async () => [{ scope: '!alice:x', from: '@alice:x' }],
        awaitedDeliveries: () => [ALICE],
        join: async () => {
          throw new Error('M_FORBIDDEN')
        },
      }),
    )

    expect(entered.delivered).toEqual([])
    expect(entered.refused).toEqual([
      { scope: '!alice:x', reason: 'M_FORBIDDEN' },
    ])
  })

  it('leaves the doors of links spent to the invitations they are owed', async () => {
    const entered = await enterInvitations(
      entering({
        invitedRooms: async () => [
          { scope: '!alice:x', from: '@alice:x' },
          { scope: '!link:x', from: null },
        ],
        awaited: () => 1,
        awaitedDeliveries: () => [ALICE],
      }),
    )

    expect(entered.joined).toEqual(['!alice:x', '!link:x'])
    expect(entered.doors).toBe(1)
    expect(entered.delivered).toEqual(['inv-alice'])
  })

  it("declines it for somebody already in a conversation here, as a link's, and that answers the invitation", async () => {
    const declined: string[] = []
    const entered = await enterInvitations(
      entering({
        invitedRooms: async () => [{ scope: '!alice:x', from: '@alice:x' }],
        awaitedDeliveries: () => [ALICE],
        alreadyWith: async () => new Set(['@alice:x']),
        decline: async (_http, scope) => {
          declined.push(scope)
        },
      }),
    )

    expect(declined).toEqual(['!alice:x'])
    expect(entered.collapsed).toEqual([{ scope: '!alice:x', from: '@alice:x' }])
    expect(entered.doors).toBe(0)
    expect(entered.delivered).toEqual(['inv-alice'])
  })
})
