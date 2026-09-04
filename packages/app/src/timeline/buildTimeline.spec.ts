import { describe, expect, it, vi } from 'vitest'

import {
  fetchRoomMessages,
  toTimelineEntries,
  type TimelineMachine,
} from './buildTimeline'

const decodeUtf8 = (bytes: Uint8Array) => new TextDecoder().decode(bytes)
const encode = (text: string) => new TextEncoder().encode(text)

function machine(
  bodies: Record<string, string | Error>,
): TimelineMachine & { scopes: string[] } {
  const scopes: string[] = []
  return {
    scopes,
    decryptEvent: async (scope, rawEvent) => {
      scopes.push(scope)
      const id = (rawEvent as { event_id: string }).event_id
      const answer = bodies[id]
      if (answer === undefined || answer instanceof Error) {
        throw answer ?? new Error('no session')
      }
      // Named `ciphertext` and carrying the plaintext: the library's own
      // naming on this direction, which receiveDecrypt.ts also matches.
      return { ciphertext: encode(JSON.stringify({ body: answer })) }
    },
  }
}

const encrypted = (id: string, ts: number, sender = '@her:messagr.eu') => ({
  type: 'm.room.encrypted',
  event_id: id,
  sender,
  origin_server_ts: ts,
  content: { algorithm: 'm.megolm.v1.aes-sha2', ciphertext: 'x' },
})

describe('fetchRoomMessages', () => {
  it('asks the room for its most recent messages', async () => {
    const seen: string[] = []
    const http = {
      authedRequest: async (_m: string, path: string) => {
        seen.push(path)
        return JSON.stringify({ chunk: [] })
      },
    }
    await fetchRoomMessages(http, '!room:messagr.eu', 40)
    // `!` survives encodeURIComponent -- it is a legal sub-delimiter in a
    // path segment -- while `:` does not. Asserting the encoded form the
    // function actually produces, rather than the one it looked like it
    // would.
    expect(seen[0]).toContain('/rooms/!room%3Amessagr.eu/messages')
  })

  it('gives the chunk back oldest first, whichever way the server walked it', async () => {
    // `dir=b` walks backwards, so the server answers newest first. A caller
    // that forwarded that order would build a conversation upside down.
    const http = {
      authedRequest: async () =>
        JSON.stringify({
          chunk: [encrypted('$c', 3000), encrypted('$b', 2000)],
        }),
    }
    const events = await fetchRoomMessages(http, '!room:messagr.eu', 40)
    expect(events.map(e => (e as { event_id: string }).event_id)).toEqual([
      '$b',
      '$c',
    ])
  })

  it('answers with nothing rather than throwing when the room says nothing', async () => {
    const http = { authedRequest: async () => JSON.stringify({}) }
    await expect(
      fetchRoomMessages(http, '!room:messagr.eu', 40),
    ).resolves.toEqual([])
  })
})

describe('toTimelineEntries', () => {
  it('decrypts what it can and reports what it cannot', async () => {
    const entries = await toTimelineEntries(
      machine({ $a: 'lisible' }),
      decodeUtf8,
      '!room:messagr.eu',
      [encrypted('$a', 1000), encrypted('$b', 2000)],
    )
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({ eventId: '$a', body: 'lisible' })
    expect(entries[1]?.body).toBeNull()
    expect(entries[1]?.reason).toBeTruthy()
  })

  it('keeps the sender the event claims, and calls it claimed', async () => {
    const [entry] = await toTimelineEntries(
      machine({ $a: 'x' }),
      decodeUtf8,
      '!room:messagr.eu',
      [encrypted('$a', 1000, '@lea:messagr.eu')],
    )
    expect(entry?.claimedSender).toBe('@lea:messagr.eu')
  })

  it('reads a message that was never encrypted, rather than pretending it was', async () => {
    // A room can carry an unencrypted event -- an older one, or one a
    // misconfigured client sent. Hiding it would be a gap nobody could see,
    // and decrypting it would fail for the wrong reason.
    const [entry] = await toTimelineEntries(
      machine({}),
      decodeUtf8,
      '!room:messagr.eu',
      [
        {
          type: 'm.room.message',
          event_id: '$p',
          sender: '@her:messagr.eu',
          origin_server_ts: 500,
          content: { msgtype: 'm.text', body: 'en clair' },
        },
      ],
    )
    expect(entry).toMatchObject({ eventId: '$p', body: 'en clair' })
  })

  it('skips an event that is neither a message nor encrypted', async () => {
    // Membership changes, topic edits, receipts. A timeline of everything the
    // room ever recorded is not a conversation.
    const entries = await toTimelineEntries(
      machine({}),
      decodeUtf8,
      '!room:messagr.eu',
      [
        {
          type: 'm.room.member',
          event_id: '$m',
          sender: '@her:messagr.eu',
          origin_server_ts: 400,
          content: { membership: 'join' },
        },
      ],
    )
    expect(entries).toEqual([])
  })

  it('skips an event with no identifier, which nothing could deduplicate', async () => {
    const entries = await toTimelineEntries(
      machine({}),
      decodeUtf8,
      '!room:messagr.eu',
      [{ type: 'm.room.encrypted', sender: '@x:y', origin_server_ts: 1 }],
    )
    expect(entries).toEqual([])
  })

  it('decrypts against the room it was given, not against a scope guessed here', async () => {
    const m = machine({ $a: 'x' })
    await toTimelineEntries(m, decodeUtf8, '!room:messagr.eu', [
      encrypted('$a', 1000),
    ])
    expect(m.scopes).toEqual(['!room:messagr.eu'])
  })

  it('never logs what it decrypted', async () => {
    const spy = vi.spyOn(console, 'log')
    await toTimelineEntries(machine({ $a: 'secret' }), decodeUtf8, '!r:m', [
      encrypted('$a', 1000),
    ])
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})
