import { describe, expect, it } from 'vitest'

import {
  fetchConversationSummaries,
  type ConversationListDeps,
} from './conversationList'
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
