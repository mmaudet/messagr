import { describe, expect, it } from 'vitest'

import type { HttpRequester } from './pump'
import {
  fetchEncryptedEvents,
  receiveAndDecrypt,
  type DecryptingMachine,
} from './receiveDecrypt'

const ROOM = '!room:example.org'
const OTHER = '@bob:example.org'
const SELF = '@alice:example.org'

function syncWith(events: unknown[]): string {
  return JSON.stringify({
    rooms: { join: { [ROOM]: { timeline: { events } } } },
  })
}

function encryptedEvent(sender: string, eventId: string): unknown {
  return {
    type: 'm.room.encrypted',
    event_id: eventId,
    sender,
    origin_server_ts: 1,
    content: { algorithm: 'm.megolm.v1.aes-sha2', ciphertext: 'AwgAEn' },
  }
}

function fakeHttp(responseJson: string): HttpRequester {
  return { authedRequest: async () => responseJson }
}

// The fakes below name only the two envelope fields this module reads. The
// rest are the library's, and inventing values for them here would be
// describing a shape no test depends on, so they are cast rather than filled.
function fakeMachine(
  decrypt: DecryptingMachine['decryptEvent'],
): DecryptingMachine {
  return { decryptEvent: decrypt }
}

describe('fetchEncryptedEvents', () => {
  it('finds the encrypted events another account put in the room', async () => {
    const http = fakeHttp(
      syncWith([encryptedEvent(OTHER, '$1'), encryptedEvent(SELF, '$2')]),
    )
    const events = await fetchEncryptedEvents(http, ROOM, SELF)
    expect(events).toHaveLength(1)
    expect((events[0] as { event_id: string }).event_id).toBe('$1')
  })

  it('ignores everything that is not an encrypted event', async () => {
    const http = fakeHttp(
      syncWith([
        { type: 'm.room.message', sender: OTHER, event_id: '$1' },
        encryptedEvent(OTHER, '$2'),
      ]),
    )
    const events = await fetchEncryptedEvents(http, ROOM, SELF)
    expect(events).toHaveLength(1)
  })

  it('is empty when the room carries nothing, rather than throwing', async () => {
    await expect(
      fetchEncryptedEvents(fakeHttp('{}'), ROOM, SELF),
    ).resolves.toEqual([])
  })
})

describe('receiveAndDecrypt', () => {
  it('reports the plaintext of the first event it can decrypt', async () => {
    const http = fakeHttp(syncWith([encryptedEvent(OTHER, '$1')]))
    const machine = fakeMachine((async () => ({
      ciphertext: new TextEncoder().encode(
        '{"msgtype":"m.text","body":"hello from the other side"}',
      ),
      sender: OTHER,
    })) as never)
    const report = await receiveAndDecrypt(
      { http, machine, decodeUtf8: bytes => new TextDecoder().decode(bytes) },
      ROOM,
      SELF,
    )
    expect(report).toEqual({
      received: true,
      body: 'hello from the other side',
      claimedSender: OTHER,
    })
  })

  it('reports nothing to decrypt when the other account sent nothing', async () => {
    const report = await receiveAndDecrypt(
      {
        http: fakeHttp(syncWith([])),
        machine: fakeMachine(async () => {
          throw new Error('never called')
        }),
        decodeUtf8: () => '',
      },
      ROOM,
      SELF,
    )
    expect(report).toEqual({
      received: false,
      reason: 'no encrypted event from anyone else is in the room',
    })
  })

  it('carries the reason when every event refuses to decrypt', async () => {
    const report = await receiveAndDecrypt(
      {
        http: fakeHttp(syncWith([encryptedEvent(OTHER, '$1')])),
        machine: fakeMachine(async () => {
          throw new Error('no inbound session')
        }),
        decodeUtf8: () => '',
      },
      ROOM,
      SELF,
    )
    expect(report).toEqual({
      received: false,
      reason: 'no inbound session',
    })
  })

  it('keeps trying later events when an earlier one cannot be decrypted', async () => {
    const http = fakeHttp(
      syncWith([encryptedEvent(OTHER, '$1'), encryptedEvent(OTHER, '$2')]),
    )
    const machine = fakeMachine((async (_scope: string, rawEvent: unknown) => {
      if ((rawEvent as { event_id: string }).event_id === '$1') {
        throw new Error('no inbound session')
      }
      return {
        ciphertext: new TextEncoder().encode(
          '{"msgtype":"m.text","body":"the second one"}',
        ),
        sender: OTHER,
      }
    }) as never)
    const report = await receiveAndDecrypt(
      { http, machine, decodeUtf8: bytes => new TextDecoder().decode(bytes) },
      ROOM,
      SELF,
    )
    expect(report.received).toBe(true)
    if (report.received) expect(report.body).toBe('the second one')
  })

  it('refuses a plaintext that names no body rather than showing an empty message', async () => {
    const http = fakeHttp(syncWith([encryptedEvent(OTHER, '$1')]))
    const machine = fakeMachine((async () => ({
      ciphertext: new TextEncoder().encode('{"msgtype":"m.text"}'),
      sender: OTHER,
    })) as never)
    const report = await receiveAndDecrypt(
      { http, machine, decodeUtf8: bytes => new TextDecoder().decode(bytes) },
      ROOM,
      SELF,
    )
    expect(report.received).toBe(false)
  })
})
