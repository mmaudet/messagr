import { describe, expect, it } from 'vitest'

import {
  fetchConversationSummaries,
  listWithoutTheBlocked,
  NOTHING_LEFT_TO_SHOW,
  openAfterTheBlock,
  openConversationOf,
  rowsHeld,
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
            /** Served as it was written, never encrypted (#461). */
            clear?: string
            /** Served as the homeserver serves it once removed. */
            removed?: true
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
          type:
            event.clear === undefined ? 'm.room.encrypted' : 'm.room.message',
          event_id: event.id,
          sender: event.sender,
          origin_server_ts: event.ts,
          ...(event.removed === true
            ? {
                content: {},
                unsigned: { redacted_because: { type: 'm.room.redaction' } },
              }
            : {
                content:
                  event.clear === undefined
                    ? { plain: event.plain }
                    : { msgtype: 'm.text', body: event.clear },
              }),
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

  it('says who is in each conversation, as its membership reads now, and nothing when it cannot be read (#498)', async () => {
    // What tells the screen of a block whether the account it blocks still
    // reads a conversation of more than two: a participant who left does not.
    const summaries = await fetchConversationSummaries(
      fakeHomeserver({
        '!a:x': { members: [ME, '@her:example.org', '@him:example.org'] },
        '!b:x': { members: 'unreadable' },
      }),
      ME,
      NOTHING_READ,
    )
    const bySpace = new Map(summaries.map(one => [one.scope, one]))

    expect(new Set(bySpace.get('!a:x')?.participants)).toEqual(
      new Set([ME, '@her:example.org', '@him:example.org']),
    )
    expect(bySpace.get('!b:x')?.participants).toBeUndefined()
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

  it('draws the list without the conversation with the blocked account, and without its messages in every other row', async () => {
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

    const drawn = listWithoutTheBlocked(summaries, ONLY_BLOCKED.blocked)
    expect(drawn).toHaveLength(1)
    expect(drawn[0]).toMatchObject({
      scope: '!three-of-us:x',
      preview: 'hello',
      previewBy: HER,
      lastAt: 200,
      unread: 1,
    })
  })

  it('keeps in what it derives the conversation with the blocked account, for who is in it and for nothing that was said there (#498)', async () => {
    // What is learnt of it is not lost: a conversation open whose participants
    // were not known when the block arrived closes once its row knows them
    // (`leavesNow`), and a tap on a notification drawn before the block does
    // not open it. Which conversations are drawn is `listWithoutTheBlocked`'s.
    // Nothing decrypted stays with it, this account's own words included.
    const summaries = await fetchConversationSummaries(
      fakeHomeserver({
        '!with-them:x': {
          members: [ME, BLOCKED],
          events: [
            { id: '$1', sender: BLOCKED, ts: 100, plain: 'go away' },
            { id: '$2', sender: ME, ts: 200, plain: 'leave me alone' },
          ],
        },
      }),
      ME,
      NOTHING_READ,
      ONLY_BLOCKED,
    )

    expect(summaries).toHaveLength(1)
    expect(summaries[0]).toEqual({
      scope: '!with-them:x',
      other: BLOCKED,
      others: 1,
      participants: [ME, BLOCKED],
      preview: null,
      reason: NOTHING_LEFT_TO_SHOW,
      lastAt: 0,
      unread: 0,
    })
    expect(
      openAfterTheBlock(
        { scope: '!with-them:x', other: null },
        summaries,
        ONLY_BLOCKED.blocked,
      ),
    ).toBe('leaves')
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

    expect(summaries[0]).toMatchObject({ others: 0, departed: BLOCKED })
    expect(listWithoutTheBlocked(summaries, ONLY_BLOCKED.blocked)).toEqual([])
  })

  it('learns, at a later derivation, that a conversation whose participants could not be read is the one with the blocked account (#498)', async () => {
    const unread = await fetchConversationSummaries(
      fakeHomeserver({
        '!with-them:x': {
          members: 'unreadable',
          events: [{ id: '$1', sender: BLOCKED, ts: 100, plain: 'go away' }],
        },
      }),
      ME,
      NOTHING_READ,
      ONLY_BLOCKED,
    )
    const open = { scope: '!with-them:x', other: null }
    expect(openAfterTheBlock(open, unread, ONLY_BLOCKED.blocked)).toBe(
      'not known',
    )

    const read = await fetchConversationSummaries(
      fakeHomeserver({
        '!with-them:x': {
          members: [ME, BLOCKED],
          events: [{ id: '$1', sender: BLOCKED, ts: 100, plain: 'go away' }],
        },
      }),
      ME,
      NOTHING_READ,
      ONLY_BLOCKED,
    )

    expect(
      openAfterTheBlock(
        open,
        mergeSummaries(unread, read),
        ONLY_BLOCKED.blocked,
      ),
    ).toBe('leaves')
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

  it('holds, once an account is blocked, its conversation for who is in it and for nothing it said, and every other row as it was (#498)', () => {
    // Derived before the block: its opening, what it counts, and the
    // messages it was drawn from, this account's own among them.
    const withThem: ConversationSummary = {
      scope: '!with-them:x',
      other: BLOCKED,
      others: 1,
      participants: [ME, BLOCKED],
      preview: 'leave me alone',
      previewBy: ME,
      lastAt: 200,
      unread: 1,
      window: [
        { sender: BLOCKED, sentAt: 100, body: 'go away', unread: true },
        { sender: ME, sentAt: 200, body: 'leave me alone', unread: false },
      ],
    }
    const withHer: ConversationSummary = {
      scope: '!with-her:x',
      other: HER,
      others: 1,
      preview: 'hello',
      lastAt: 300,
      unread: 0,
    }

    const held = rowsHeld([withThem, withHer], new Set([BLOCKED]))

    expect(held).toEqual([
      {
        scope: '!with-them:x',
        other: BLOCKED,
        others: 1,
        participants: [ME, BLOCKED],
        preview: null,
        reason: NOTHING_LEFT_TO_SHOW,
        lastAt: 0,
        unread: 0,
      },
      withHer,
    ])
    expect(held[1]).toBe(withHer)
    // Held once, held the same: the same rows come back.
    expect(rowsHeld(held, new Set([BLOCKED]))).toBe(held)
    expect(rowsHeld([withThem], new Set())).toEqual([withThem])
  })
})

describe('what a block does to a conversation (#469, #472, #494)', () => {
  // ONE RULE, read by the list, by the conversation open, by the screen
  // that says what blocking will do, and by what is said once it is done:
  // whichever device made the block.
  const BLOCKED = '@bothers:example.org'
  const HER = '@her:example.org'
  const blocked = new Set([BLOCKED])

  function row(
    scope: string,
    other: string | null,
    extra: Partial<ConversationSummary> = {},
  ): ConversationSummary {
    return {
      scope,
      other,
      others: other === null ? 2 : 1,
      preview: null,
      lastAt: 0,
      unread: 0,
      ...extra,
    }
  }

  const rows = [
    row('!with-them:x', BLOCKED),
    row('!three-of-us:x', null),
    row('!alone-now:x', null, { others: 0, departed: BLOCKED }),
    row('!with-her:x', HER),
    // Whose membership could not be read.
    row('!unread:x', null, { others: null }),
    row('!alone-unread:x', null, { others: 0, membershipsUnread: true }),
  ]
  const listed = (drawn: readonly ConversationSummary[]) =>
    drawn.map(one => one.scope)

  it('takes the conversation of two with the blocked account off the list, and off the screen', () => {
    expect(listed(listWithoutTheBlocked(rows, blocked))).not.toContain(
      '!with-them:x',
    )
    expect(
      openAfterTheBlock(
        { scope: '!with-them:x', other: BLOCKED },
        rows,
        blocked,
      ),
    ).toBe('leaves')
    // Its row says so before the conversation has found its other person...
    expect(
      openAfterTheBlock({ scope: '!with-them:x', other: null }, rows, blocked),
    ).toBe('leaves')
    // ...and the conversation says so before the list has a row for it.
    expect(
      openAfterTheBlock({ scope: '!new:x', other: BLOCKED }, rows, blocked),
    ).toBe('leaves')
  })

  it('takes off the one this account is alone in, when the blocked account is who left it', () => {
    expect(listed(listWithoutTheBlocked(rows, blocked))).not.toContain(
      '!alone-now:x',
    )
    expect(
      openAfterTheBlock({ scope: '!alone-now:x', other: null }, rows, blocked),
    ).toBe('leaves')
  })

  it('keeps a conversation of more than two in the list and open', () => {
    // Only the blocked account's messages leave it.
    expect(listed(listWithoutTheBlocked(rows, blocked))).toContain(
      '!three-of-us:x',
    )
    expect(
      openAfterTheBlock(
        { scope: '!three-of-us:x', other: null },
        rows,
        blocked,
      ),
    ).toBe('stays')
  })

  it('keeps every other conversation, and every one while nobody is blocked', () => {
    expect(
      openAfterTheBlock({ scope: '!with-her:x', other: HER }, rows, blocked),
    ).toBe('stays')
    expect(
      openAfterTheBlock({ scope: '!new:x', other: HER }, rows, blocked),
    ).toBe('stays')
    expect(
      openAfterTheBlock(
        { scope: '!with-them:x', other: BLOCKED },
        rows,
        new Set(),
      ),
    ).toBe('stays')
    expect(listWithoutTheBlocked(rows, new Set())).toBe(rows)
  })

  it('says it does not know, and claims nothing, while nothing has said who is in it', () => {
    // Neither a row nor the conversation's own finding.
    expect(
      openAfterTheBlock({ scope: '!new:x', other: null }, rows, blocked),
    ).toBe('not known')
    // A row whose membership could not be read knows no more, and the list
    // keeps a row it cannot say is the one with the blocked account.
    for (const scope of ['!unread:x', '!alone-unread:x']) {
      expect(
        openAfterTheBlock({ scope, other: null }, rows, blocked),
        scope,
      ).toBe('not known')
      expect(listed(listWithoutTheBlocked(rows, blocked))).toContain(scope)
    }
  })

  it('knows the other person only when it was found for the conversation open', () => {
    // Found for the conversation open before this one, and not yet for this
    // one: that person is not this conversation's.
    expect(
      openConversationOf('!with-her:x', { scope: '!with-her:x', other: HER }),
    ).toEqual({ scope: '!with-her:x', other: HER })
    expect(
      openConversationOf('!three-of-us:x', {
        scope: '!with-them:x',
        other: BLOCKED,
      }),
    ).toEqual({ scope: '!three-of-us:x', other: null })
    expect(openConversationOf('!three-of-us:x', null)).toEqual({
      scope: '!three-of-us:x',
      other: null,
    })
  })
})

describe('a last message that is not encrypted (#461)', () => {
  const HER = '@her:example.org'
  const BLOCKED = '@bothers:example.org'

  it('says the mention in place of its opening, and keeps none of its words', async () => {
    const [summary] = await fetchConversationSummaries(
      fakeHomeserver({
        '!a:x': {
          events: [
            { id: '$1', sender: HER, ts: 100, plain: 'the older one' },
            { id: '$2', sender: HER, ts: 200, clear: 'en clair' },
          ],
        },
      }),
      ME,
      NOTHING_READ,
    )

    expect(summary).toMatchObject({
      preview: null,
      previewUnencrypted: true,
      previewBy: HER,
      lastAt: 200,
    })
    expect(summary?.reason).toBeUndefined()
    // What the row says and what the notebook keeps of it: everything but
    // the messages it is drawn again from, which stay in memory.
    expect(JSON.stringify({ ...summary, window: undefined })).not.toContain(
      'en clair',
    )
  })

  it('says the opening of the newest message again once one arrives encrypted', async () => {
    const [summary] = await fetchConversationSummaries(
      fakeHomeserver({
        '!a:x': {
          events: [
            { id: '$1', sender: HER, ts: 100, clear: 'en clair' },
            { id: '$2', sender: HER, ts: 200, plain: 'the newer one' },
          ],
        },
      }),
      ME,
      NOTHING_READ,
    )

    expect(summary?.preview).toBe('the newer one')
    expect(summary?.previewUnencrypted).toBeUndefined()
  })

  it('says it was removed, and no mention, once it is removed for everyone', async () => {
    const [summary] = await fetchConversationSummaries(
      fakeHomeserver({
        '!a:x': {
          events: [
            {
              id: '$1',
              sender: HER,
              ts: 100,
              clear: 'en clair',
              removed: true,
            },
          ],
        },
      }),
      ME,
      NOTHING_READ,
    )

    expect(summary).toMatchObject({
      preview: null,
      reason: 'the last message was removed',
    })
    expect(summary?.previewUnencrypted).toBeUndefined()
  })

  it('drops the mention with the opening when its author is blocked', async () => {
    const derived = await fetchConversationSummaries(
      fakeHomeserver({
        '!three-of-us:x': {
          members: [ME, BLOCKED, HER],
          events: [
            { id: '$1', sender: HER, ts: 100, plain: 'hello' },
            { id: '$2', sender: BLOCKED, ts: 200, clear: 'en clair' },
          ],
        },
      }),
      ME,
      NOTHING_READ,
    )
    // And from a row kept from an earlier launch, which has no messages to
    // be drawn again from.
    const kept: ConversationSummary = {
      scope: '!kept:x',
      other: null,
      others: 2,
      preview: null,
      previewUnencrypted: true,
      previewBy: BLOCKED,
      lastAt: 200,
      unread: 0,
    }

    const drawn = listWithoutTheBlocked([...derived, kept], new Set([BLOCKED]))

    expect(
      drawn.map(row => [row.scope, row.preview, row.previewUnencrypted]),
    ).toEqual([
      ['!kept:x', null, undefined],
      ['!three-of-us:x', 'hello', undefined],
    ])
  })
})
