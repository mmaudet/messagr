import { describe, expect, it } from 'vitest'

import {
  fetchConversationSummaries,
  listWithoutTheBlocked,
  NOTHING_LEFT_TO_SHOW,
  scopesWithTheBlocked,
  type ConversationListDeps,
  type ConversationSummary,
} from './conversationList'
import { mergeSummaries } from './mergeSummaries'
import type { NotShown } from './notShown'
import type { HttpRequester } from './pump'

/**
 * A homeserver with a fixed set of conversations, their members, and their
 * events. Encryption is faked by the shape the bridge actually returns: an
 * event whose content carries a `plain` string decrypts to it, and anything
 * else throws the way a missing key does.
 */
function fakeHomeserver(
  rooms: Record<
    string,
    {
      members?: readonly string[] | 'unreadable'
      /**
       * Everybody who ever had a membership, with its latest state and the
       * one before it: what `/members` answers, `unsigned.prev_content`
       * included (measured on Continuwuity, 26 September 2026).
       */
      memberships?:
        | readonly {
            user: string
            membership: 'join' | 'leave' | 'ban' | 'invite'
            before?: 'join' | 'invite'
            /** Who sent this event; the person themself when absent. */
            by?: string
            /** Who sent the one before it. */
            beforeBy?: string
            ts?: number
          }[]
        | 'unreadable'
      events?:
        | readonly {
            id: string
            sender: string
            ts: number
            plain?: string
          }[]
        | 'unreadable'
    }
  >,
): ConversationListDeps & { readonly asked: readonly string[] } {
  const asked: string[] = []
  const http: HttpRequester = {
    authedRequest: async (_method, path) => {
      if (path.endsWith('/joined_rooms')) {
        return JSON.stringify({ joined_rooms: Object.keys(rooms) })
      }
      const scope = decodeURIComponent(
        path.replace(/^.*\/rooms\//, '').replace(/\/.*$/, ''),
      )
      const room = rooms[scope]
      if (room === undefined) throw new Error(`no such conversation: ${scope}`)

      if (path.endsWith('/members')) {
        asked.push(path)
        if (room.memberships === 'unreadable') {
          throw new Error('memberships refused')
        }
        return JSON.stringify({
          chunk: (room.memberships ?? []).map(m => ({
            type: 'm.room.member',
            state_key: m.user,
            sender: m.by ?? m.user,
            origin_server_ts: m.ts ?? 0,
            content: { membership: m.membership },
            ...(m.before === undefined
              ? {}
              : {
                  unsigned: {
                    prev_content: { membership: m.before },
                    prev_sender: m.beforeBy ?? m.user,
                  },
                }),
          })),
        })
      }
      if (path.endsWith('/joined_members')) {
        if (room.members === 'unreadable') throw new Error('members refused')
        return JSON.stringify({
          joined: Object.fromEntries((room.members ?? []).map(m => [m, {}])),
        })
      }
      if (room.events === 'unreadable') throw new Error('history refused')
      // `dir=b`: newest first on the wire.
      return JSON.stringify({
        chunk: [...(room.events ?? [])].reverse().map(event => ({
          type: 'm.room.encrypted',
          event_id: event.id,
          sender: event.sender,
          origin_server_ts: event.ts,
          content: { plain: event.plain },
        })),
      })
    },
  }

  return {
    asked,
    http,
    machine: {
      decryptEvent: async (_scope, rawEvent) => {
        const plain = (rawEvent as { content?: { plain?: unknown } }).content
          ?.plain
        if (typeof plain !== 'string') throw new Error('no key for this event')
        return {
          eventType: 'm.room.message',
          // The bridge hands back the decrypted *content*, whose `body` is at
          // the top level. Matching `toTimelineEntries`'s own reading.
          ciphertext: new TextEncoder().encode(JSON.stringify({ body: plain })),
        }
      },
    },
    decodeUtf8: bytes => new TextDecoder().decode(bytes),
  }
}

const ME = '@me:example.org'
/** A device that has never opened any of them, which is a first launch. */
const NOTHING_READ = new Map<string, number>()

describe('fetchConversationSummaries', () => {
  it('lists every conversation this account is in', async () => {
    const summaries = await fetchConversationSummaries(
      fakeHomeserver({ '!a:x': {}, '!b:x': {} }),
      ME,
      NOTHING_READ,
    )
    expect(summaries.map(s => s.scope).sort()).toEqual(['!a:x', '!b:x'])
  })

  it('names the other participant of a direct conversation', async () => {
    const summaries = await fetchConversationSummaries(
      fakeHomeserver({ '!a:x': { members: [ME, '@her:example.org'] } }),
      ME,
      NOTHING_READ,
    )
    expect(summaries[0]?.other).toBe('@her:example.org')
  })

  it('names nobody when there is more than one other participant', async () => {
    const summaries = await fetchConversationSummaries(
      fakeHomeserver({
        '!a:x': { members: [ME, '@her:example.org', '@him:example.org'] },
      }),
      ME,
      NOTHING_READ,
    )
    expect(summaries[0]?.other).toBeNull()
  })

  it('carries the opening of the last readable message', async () => {
    const summaries = await fetchConversationSummaries(
      fakeHomeserver({
        '!a:x': {
          events: [
            { id: '$1', sender: ME, ts: 100, plain: 'the older one' },
            { id: '$2', sender: ME, ts: 200, plain: 'the newer one' },
          ],
        },
      }),
      ME,
      NOTHING_READ,
    )
    expect(summaries[0]?.preview).toBe('the newer one')
    expect(summaries[0]?.lastAt).toBe(200)
  })

  it('does not truncate, because how many words fit is the screen’s question', async () => {
    const long = 'a'.repeat(500)
    const summaries = await fetchConversationSummaries(
      fakeHomeserver({
        '!a:x': { events: [{ id: '$1', sender: ME, ts: 1, plain: long }] },
      }),
      ME,
      NOTHING_READ,
    )
    expect(summaries[0]?.preview).toBe(long)
  })

  it('falls back to an older message when the newest cannot be read', async () => {
    const summaries = await fetchConversationSummaries(
      fakeHomeserver({
        '!a:x': {
          events: [
            { id: '$1', sender: ME, ts: 100, plain: 'readable' },
            { id: '$2', sender: ME, ts: 200 },
          ],
        },
      }),
      ME,
      NOTHING_READ,
    )
    expect(summaries[0]?.preview).toBe('readable')
    // The timestamp is still the newest event's: the conversation moved then,
    // whether or not this device could read what was said.
    expect(summaries[0]?.lastAt).toBe(200)
  })

  it('says nothing has been said, rather than showing an empty conversation as unreadable', async () => {
    const summaries = await fetchConversationSummaries(
      fakeHomeserver({ '!a:x': { events: [] } }),
      ME,
      NOTHING_READ,
    )
    expect(summaries[0]?.preview).toBeNull()
    expect(summaries[0]?.reason).toBe('nothing has been said yet')
    expect(summaries[0]?.lastAt).toBe(0)
  })

  it('says the last message could not be read, which is the opposite claim', async () => {
    const summaries = await fetchConversationSummaries(
      fakeHomeserver({
        '!a:x': { events: [{ id: '$1', sender: ME, ts: 100 }] },
      }),
      ME,
      NOTHING_READ,
    )
    expect(summaries[0]?.preview).toBeNull()
    expect(summaries[0]?.reason).not.toBe('nothing has been said yet')
  })

  it('orders the most recently active first', async () => {
    const summaries = await fetchConversationSummaries(
      fakeHomeserver({
        '!quiet:x': { events: [{ id: '$1', sender: ME, ts: 100, plain: 'x' }] },
        '!loud:x': { events: [{ id: '$2', sender: ME, ts: 900, plain: 'y' }] },
        '!empty:x': { events: [] },
      }),
      ME,
      NOTHING_READ,
    )
    expect(summaries.map(s => s.scope)).toEqual([
      '!loud:x',
      '!quiet:x',
      '!empty:x',
    ])
  })

  it('breaks a tie the same way twice, so nothing appears to move on its own', async () => {
    const rooms = {
      '!b:x': { events: [{ id: '$1', sender: ME, ts: 500, plain: 'x' }] },
      '!a:x': { events: [{ id: '$2', sender: ME, ts: 500, plain: 'y' }] },
    }
    const once = await fetchConversationSummaries(
      fakeHomeserver(rooms),
      ME,
      NOTHING_READ,
    )
    const twice = await fetchConversationSummaries(
      fakeHomeserver(rooms),
      ME,
      NOTHING_READ,
    )
    expect(once.map(s => s.scope)).toEqual(['!a:x', '!b:x'])
    expect(twice.map(s => s.scope)).toEqual(once.map(s => s.scope))
  })

  it('keeps the other rows when one conversation refuses its history', async () => {
    const summaries = await fetchConversationSummaries(
      fakeHomeserver({
        '!broken:x': { events: 'unreadable' },
        '!fine:x': {
          events: [{ id: '$1', sender: ME, ts: 100, plain: 'here' }],
        },
      }),
      ME,
      NOTHING_READ,
    )
    expect(summaries).toHaveLength(2)
    expect(summaries.find(s => s.scope === '!fine:x')?.preview).toBe('here')
    expect(summaries.find(s => s.scope === '!broken:x')?.reason).toContain(
      'history refused',
    )
  })

  it('still lists a conversation whose membership could not be read', async () => {
    const summaries = await fetchConversationSummaries(
      fakeHomeserver({
        '!a:x': {
          members: 'unreadable',
          events: [{ id: '$1', sender: ME, ts: 100, plain: 'here' }],
        },
      }),
      ME,
      NOTHING_READ,
    )
    expect(summaries[0]?.other).toBeNull()
    expect(summaries[0]?.preview).toBe('here')
  })

  it('is an empty list, not a failure, for an account in no conversation', async () => {
    expect(
      await fetchConversationSummaries(fakeHomeserver({}), ME, NOTHING_READ),
    ).toEqual([])
  })

  it('counts what arrived since this device last looked', async () => {
    const summaries = await fetchConversationSummaries(
      fakeHomeserver({
        '!a:x': {
          events: [
            { id: '$1', sender: '@her:example.org', ts: 100, plain: 'one' },
            { id: '$2', sender: '@her:example.org', ts: 200, plain: 'two' },
            { id: '$3', sender: '@her:example.org', ts: 300, plain: 'three' },
          ],
        },
      }),
      ME,
      new Map([['!a:x', 100]]),
    )
    expect(summaries[0]?.unread).toBe(2)
  })

  it('counts a message it cannot read, because it still arrived', async () => {
    // The row will say it cannot be read. The badge says something is there
    // to read, which is true and is the more useful of the two.
    const summaries = await fetchConversationSummaries(
      fakeHomeserver({
        '!a:x': { events: [{ id: '$1', sender: '@her:example.org', ts: 300 }] },
      }),
      ME,
      NOTHING_READ,
    )
    expect(summaries[0]?.unread).toBe(1)
    expect(summaries[0]?.preview).toBeNull()
  })

  it('shows nothing unread on a conversation only this account has spoken in', async () => {
    const summaries = await fetchConversationSummaries(
      fakeHomeserver({
        '!a:x': { events: [{ id: '$1', sender: ME, ts: 300, plain: 'hello' }] },
      }),
      ME,
      NOTHING_READ,
    )
    expect(summaries[0]?.unread).toBe(0)
  })

  it('counts nothing on a conversation whose history refused', async () => {
    const summaries = await fetchConversationSummaries(
      fakeHomeserver({ '!a:x': { events: 'unreadable' } }),
      ME,
      NOTHING_READ,
    )
    expect(summaries[0]?.unread).toBe(0)
  })
})

describe('a participant who was here and is not any more (#388)', () => {
  const HER = '@her:example.org'

  it('names the one participant who was here and left, rather than nobody', async () => {
    // Deleted, evicted or gone: the conversation had two people, and the list
    // still has to say who the other one was.
    for (const membership of ['leave', 'ban'] as const) {
      const [summary] = await fetchConversationSummaries(
        fakeHomeserver({
          '!a:x': {
            members: [ME],
            memberships: [
              { user: ME, membership: 'join' },
              { user: HER, membership, before: 'join' },
            ],
          },
        }),
        ME,
        NOTHING_READ,
      )
      expect(summary?.others).toBe(0)
      expect(summary?.departed).toBe(HER)
    }
  })

  it('does not take somebody who was only invited for somebody who left', async () => {
    // An invitation nobody took up ends the same way, in a leave: the one
    // before it says whether they were ever in.
    const [summary] = await fetchConversationSummaries(
      fakeHomeserver({
        '!a:x': {
          members: [ME],
          memberships: [
            { user: ME, membership: 'join' },
            { user: HER, membership: 'leave', before: 'invite' },
          ],
        },
      }),
      ME,
      NOTHING_READ,
    )
    expect(summary?.departed).toBeUndefined()
  })

  // THE ACCOUNT THE SERVICE DREW, WHEN THE LINK WAS OPENED BY SOMEBODY WHO
  // ALREADY HAD ONE. It joins, invites that person's account, then leaves and
  // is deactivated (`claim.rs`): a leave after a join, like a departure, from
  // an account nobody here ever talked to.
  const DRAWN = '@drawn:example.org'

  it('does not take the drawn account for a participant while the person it let in is invited', async () => {
    const [summary] = await fetchConversationSummaries(
      fakeHomeserver({
        '!a:x': {
          members: [ME],
          memberships: [
            { user: ME, membership: 'join' },
            { user: DRAWN, membership: 'leave', before: 'join', ts: 1 },
            { user: HER, membership: 'invite', by: DRAWN, ts: 1 },
          ],
        },
      }),
      ME,
      NOTHING_READ,
    )
    expect(summary?.departed).toBeUndefined()
  })

  it('does not take it for one either when that person declined', async () => {
    const [summary] = await fetchConversationSummaries(
      fakeHomeserver({
        '!a:x': {
          members: [ME],
          memberships: [
            { user: ME, membership: 'join' },
            { user: DRAWN, membership: 'leave', before: 'join', ts: 1 },
            {
              user: HER,
              membership: 'leave',
              before: 'invite',
              beforeBy: DRAWN,
              ts: 2,
            },
          ],
        },
      }),
      ME,
      NOTHING_READ,
    )
    expect(summary?.departed).toBeUndefined()
  })

  it('names the person who came in through it, once they have left too', async () => {
    // Their invitation is two events back by then, and `/members` shows only
    // the last one and the one before: the drawn account left first, so the
    // most recent departure is theirs.
    const [summary] = await fetchConversationSummaries(
      fakeHomeserver({
        '!a:x': {
          members: [ME],
          memberships: [
            { user: ME, membership: 'join' },
            { user: DRAWN, membership: 'leave', before: 'join', ts: 1 },
            { user: HER, membership: 'leave', before: 'join', ts: 2 },
          ],
        },
      }),
      ME,
      NOTHING_READ,
    )
    expect(summary?.departed).toBe(HER)
  })

  it('says it could not read who was here, rather than that nobody ever came', async () => {
    const [summary] = await fetchConversationSummaries(
      fakeHomeserver({ '!a:x': { members: [ME], memberships: 'unreadable' } }),
      ME,
      NOTHING_READ,
    )
    expect(summary?.departed).toBeUndefined()
    expect(summary?.membershipsUnread).toBe(true)
  })

  it('asks who was here only when nobody else is left', async () => {
    // One more request per conversation, and only for the ones that need it.
    const homeserver = fakeHomeserver({
      '!a:x': { members: [ME, HER] },
      '!b:x': {
        members: [ME],
        memberships: [{ user: HER, membership: 'leave', before: 'join' }],
      },
    })
    await fetchConversationSummaries(homeserver, ME, NOTHING_READ)
    expect(homeserver.asked).toEqual([
      `/_matrix/client/v3/rooms/${encodeURIComponent('!b:x')}/members`,
    ])
  })
})

describe('the conversations with a blocked account (#469)', () => {
  // Derived from the ignored list, which every device of the account syncs:
  // the homeserver holds back what that account sends from then on, and this
  // is what takes off the rows what was already received.
  const BLOCKED = '@bothers:example.org'
  const HER = '@her:example.org'
  const ONLY_BLOCKED: NotShown = {
    hidden: new Set(),
    blocked: new Set([BLOCKED]),
  }

  /** A conversation of three, the blocked account's messages the newest. */
  const threeOfUs = {
    members: [ME, BLOCKED, HER],
    events: [
      { id: '$2', sender: HER, ts: 200, plain: 'hello' },
      { id: '$3', sender: BLOCKED, ts: 300, plain: 'go away' },
      { id: '$4', sender: BLOCKED, ts: 400, plain: 'again' },
    ],
  }

  it('leaves out the conversation with the blocked account, and its messages from every other row', async () => {
    const summaries = await fetchConversationSummaries(
      fakeHomeserver({
        '!with-them:x': {
          members: [ME, BLOCKED],
          events: [{ id: '$1', sender: BLOCKED, ts: 100, plain: 'go away' }],
        },
        '!three-of-us:x': threeOfUs,
      }),
      ME,
      new Map([['!three-of-us:x', 100]]),
      ONLY_BLOCKED,
    )

    expect(summaries).toHaveLength(1)
    expect(summaries[0]).toMatchObject({
      scope: '!three-of-us:x',
      preview: 'hello',
      previewBy: HER,
      lastAt: 200,
      unread: 1,
    })
  })

  it('keeps the conversation out once the blocked account has left it', async () => {
    const summaries = await fetchConversationSummaries(
      fakeHomeserver({
        '!with-them:x': {
          members: [ME],
          memberships: [{ user: BLOCKED, membership: 'leave', before: 'join' }],
        },
      }),
      ME,
      NOTHING_READ,
      ONLY_BLOCKED,
    )

    expect(summaries).toEqual([])
  })

  it('redraws a row of three in the same draw as the block, with nothing asked again', async () => {
    // Derived before the block: the blocked account's message is the
    // opening, and two of the three unread messages are its own.
    const rows = await fetchConversationSummaries(
      fakeHomeserver({ '!three-of-us:x': threeOfUs }),
      ME,
      new Map([['!three-of-us:x', 100]]),
    )
    expect(rows[0]).toMatchObject({ preview: 'again', unread: 3, lastAt: 400 })

    const [drawn] = listWithoutTheBlocked(rows, new Set([BLOCKED]))

    expect(drawn).toMatchObject({
      scope: '!three-of-us:x',
      preview: 'hello',
      previewBy: HER,
      lastAt: 200,
      unread: 1,
    })
  })

  it('says nothing is left to show, and not that nothing was said, when only the blocked account spoke', async () => {
    const [summary] = await fetchConversationSummaries(
      fakeHomeserver({
        '!three-of-us:x': {
          members: [ME, BLOCKED, HER],
          events: [{ id: '$3', sender: BLOCKED, ts: 300, plain: 'go away' }],
        },
      }),
      ME,
      NOTHING_READ,
      ONLY_BLOCKED,
    )

    expect(summary).toMatchObject({
      preview: null,
      reason: NOTHING_LEFT_TO_SHOW,
      unread: 0,
    })
  })

  it('takes a row with nothing left to show over the one before it, which the blocked account wrote', async () => {
    // A row with nothing left to show is not a derivation that failed: the
    // one before it must not come back with the blocked account's words and
    // count, on this launch or the next.
    const before: ConversationSummary = {
      scope: '!three-of-us:x',
      other: null,
      others: 2,
      preview: 'go away',
      previewBy: BLOCKED,
      lastAt: 300,
      unread: 1,
    }
    const derived = await fetchConversationSummaries(
      fakeHomeserver({
        '!three-of-us:x': {
          members: [ME, BLOCKED, HER],
          events: [{ id: '$3', sender: BLOCKED, ts: 300, plain: 'go away' }],
        },
      }),
      ME,
      NOTHING_READ,
      ONLY_BLOCKED,
    )

    const [merged] = mergeSummaries([before], derived)

    expect(merged).toMatchObject({ preview: null, unread: 0 })
  })

  it('drops the opening the blocked account wrote from a row kept from an earlier launch', () => {
    // A row read from the notebook carries no messages to redraw from: its
    // opening goes, and what it says of the others waits for the next
    // derivation.
    const kept: ConversationSummary = {
      scope: '!three-of-us:x',
      other: null,
      others: 2,
      preview: 'go away',
      previewBy: BLOCKED,
      lastAt: 300,
      unread: 1,
    }

    const [drawn] = listWithoutTheBlocked([kept], new Set([BLOCKED]))

    expect(drawn).toMatchObject({
      preview: null,
      reason: NOTHING_LEFT_TO_SHOW,
    })
    expect(drawn?.previewBy).toBeUndefined()
  })

  it('names the conversations with the blocked account, whoever is in them now', () => {
    const rows: ConversationSummary[] = [
      {
        scope: '!a:x',
        other: BLOCKED,
        others: 1,
        preview: null,
        lastAt: 0,
        unread: 0,
      },
      {
        scope: '!b:x',
        other: null,
        others: 0,
        departed: BLOCKED,
        preview: null,
        lastAt: 0,
        unread: 0,
      },
      {
        scope: '!c:x',
        other: HER,
        others: 1,
        preview: null,
        lastAt: 0,
        unread: 0,
      },
      {
        scope: '!d:x',
        other: null,
        others: 2,
        preview: null,
        lastAt: 0,
        unread: 0,
      },
    ]

    expect(scopesWithTheBlocked(rows, new Set([BLOCKED]))).toEqual([
      '!a:x',
      '!b:x',
    ])
  })
})
