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
): ConversationListDeps {
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
