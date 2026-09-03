import { describe, expect, it } from 'vitest'

import {
  fetchJoinedMembers,
  fetchJoinedRooms,
  sendEncryptedEvent,
  tamperCiphertext,
} from './encryptedSend'
import type { HttpRequester } from './pump'

function fakeHttp(
  respond: (method: string, path: string, body: string | undefined) => string,
): HttpRequester & {
  calls: Array<{ method: string; path: string; body?: string }>
} {
  const calls: Array<{ method: string; path: string; body?: string }> = []
  return {
    authedRequest: async (method, path, _queryParams, body) => {
      calls.push({ method, path, body })
      return respond(method, path, body)
    },
    calls,
  }
}

describe('fetchJoinedRooms', () => {
  it('asks the server which rooms this account is in', async () => {
    const http = fakeHttp(() => '{"joined_rooms":["!a:example.org"]}')
    const rooms = await fetchJoinedRooms(http)
    expect(http.calls[0]?.method).toBe('GET')
    expect(http.calls[0]?.path).toBe('/_matrix/client/v3/joined_rooms')
    expect(rooms).toEqual(['!a:example.org'])
  })

  it('is empty rather than undefined when the account is in none', async () => {
    const http = fakeHttp(() => '{}')
    await expect(fetchJoinedRooms(http)).resolves.toEqual([])
  })

  it('keeps only the entries that are actually room ids', async () => {
    const http = fakeHttp(() => '{"joined_rooms":["!a:example.org",7,null]}')
    await expect(fetchJoinedRooms(http)).resolves.toEqual(['!a:example.org'])
  })
})

describe('fetchJoinedMembers', () => {
  it('asks the server who is in the room', async () => {
    const http = fakeHttp(
      () => '{"joined":{"@a:example.org":{},"@b:example.org":{}}}',
    )
    const members = await fetchJoinedMembers(http, '!room:example.org')
    expect(http.calls[0]?.path).toBe(
      '/_matrix/client/v3/rooms/!room%3Aexample.org/joined_members',
    )
    expect(members).toEqual(['@a:example.org', '@b:example.org'])
  })

  it('is empty rather than undefined when the response names nobody', async () => {
    const http = fakeHttp(() => '{}')
    await expect(
      fetchJoinedMembers(http, '!room:example.org'),
    ).resolves.toEqual([])
  })
})

describe('sendEncryptedEvent', () => {
  const CONTENT = '{"algorithm":"m.megolm.v1.aes-sha2","ciphertext":"AwgAEn"}'

  it('sends the content as m.room.encrypted, verbatim, and returns the event id', async () => {
    const http = fakeHttp(() => '{"event_id":"$abc:example.org"}')
    const eventId = await sendEncryptedEvent(
      http,
      '!room:example.org',
      CONTENT,
      'txn-1',
    )
    expect(http.calls[0]?.method).toBe('PUT')
    expect(http.calls[0]?.path).toBe(
      '/_matrix/client/v3/rooms/!room%3Aexample.org/send/m.room.encrypted/txn-1',
    )
    // Verbatim: the crypto machine produced this content, and anything this
    // module reshaped would be something the far side cannot decrypt.
    expect(http.calls[0]?.body).toBe(CONTENT)
    expect(eventId).toBe('$abc:example.org')
  })

  it('refuses a response that names no event id, rather than reporting a send that may not have happened', async () => {
    const http = fakeHttp(() => '{}')
    await expect(
      sendEncryptedEvent(http, '!room:example.org', CONTENT, 'txn-1'),
    ).rejects.toThrow(/event id/)
  })
})

describe('tamperCiphertext', () => {
  const CONTENT = JSON.stringify({
    algorithm: 'm.megolm.v1.aes-sha2',
    ciphertext: 'AwgAEnoriginal',
    session_id: 'session',
  })

  it('changes the ciphertext', () => {
    const tampered = JSON.parse(tamperCiphertext(CONTENT)) as {
      ciphertext: string
    }
    expect(tampered.ciphertext).not.toBe('AwgAEnoriginal')
    expect(tampered.ciphertext).toHaveLength('AwgAEnoriginal'.length)
  })

  it('leaves every other field alone, so the refusal is about the ciphertext and nothing else', () => {
    const tampered = JSON.parse(tamperCiphertext(CONTENT)) as Record<
      string,
      unknown
    >
    expect(tampered.algorithm).toBe('m.megolm.v1.aes-sha2')
    expect(tampered.session_id).toBe('session')
  })

  it('always changes something, whichever character it lands on', () => {
    for (const first of ['A', 'B', 'z', '0', '+']) {
      const content = JSON.stringify({ ciphertext: `${first}rest` })
      const tampered = JSON.parse(tamperCiphertext(content)) as {
        ciphertext: string
      }
      expect(tampered.ciphertext).not.toBe(`${first}rest`)
    }
  })

  it('refuses content carrying no ciphertext at all', () => {
    expect(() => tamperCiphertext('{"algorithm":"x"}')).toThrow(/ciphertext/)
  })
})
