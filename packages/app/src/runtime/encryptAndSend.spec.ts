import { describe, expect, it, vi } from 'vitest'

import {
  encryptAndSendOneMessage,
  type EncryptAndSendDeps,
  type EncryptingMachine,
} from './encryptAndSend'
import type { HttpRequester } from './pump'

const IDENTITY = { userId: '@alice:example.org', deviceId: 'ALICEDEVICE' }
const ROOM = '!room:example.org'
const CONTENT =
  '{"algorithm":"m.megolm.v1.aes-sha2","ciphertext":"AwgAEnoriginal"}'

function encode(text: string): Uint8Array {
  return Uint8Array.from(text, character => character.charCodeAt(0))
}

function decode(bytes: Uint8Array): string {
  return String.fromCharCode(...bytes)
}

function fakeHttp(
  overrides: Record<string, string> = {},
): HttpRequester & { calls: Array<{ method: string; path: string }> } {
  const calls: Array<{ method: string; path: string }> = []
  const responses: Record<string, string> = {
    '/_matrix/client/v3/joined_rooms': `{"joined_rooms":["${ROOM}"]}`,
    [`/_matrix/client/v3/rooms/${encodeURIComponent(ROOM)}/joined_members`]:
      '{"joined":{"@alice:example.org":{},"@bob:example.org":{}}}',
    ...overrides,
  }
  return {
    authedRequest: async (method, path) => {
      calls.push({ method, path })
      const exact = responses[path]
      if (exact !== undefined) return exact
      if (path.includes('/send/m.room.encrypted/')) {
        return '{"event_id":"$sent:example.org"}'
      }
      return '{}'
    },
    calls,
  }
}

function fakeMachine(
  overrides: Partial<EncryptingMachine> = {},
): EncryptingMachine {
  return {
    takeOutgoingRequests: async () => [],
    markRequestSent: async () => undefined,
    markRequestFailed: async () => undefined,
    shareScopeKey: async () => undefined,
    encryptEvent: async () => ({ ciphertext: encode(CONTENT) }) as never,
    // Refuses whatever it is handed, which is what a machine does with a
    // ciphertext that no longer authenticates.
    decryptEvent: async () => {
      throw new Error('unable to decrypt')
    },
    ...overrides,
  }
}

function deps(
  http: HttpRequester,
  machine: EncryptingMachine,
): EncryptAndSendDeps {
  return { http, machine, decodeUtf8: decode, newTransactionId: () => 'txn-1' }
}

describe('encryptAndSendOneMessage', () => {
  it('shares the room key, sends the encrypted event, and reports the event id', async () => {
    const http = fakeHttp()
    const report = await encryptAndSendOneMessage(
      deps(http, fakeMachine()),
      IDENTITY,
    )
    expect(report).toEqual({
      sent: true,
      roomId: ROOM,
      eventId: '$sent:example.org',
      intactDecrypted: false,
      tamper: 'refused',
    })
    expect(http.calls.map(call => call.path)).toContain(
      `/_matrix/client/v3/rooms/${encodeURIComponent(ROOM)}/send/m.room.encrypted/txn-1`,
    )
  })

  it('shares the key with everyone in the room, not only this account', async () => {
    const shared: Array<readonly string[]> = []
    const machine = fakeMachine({
      shareScopeKey: async (_scope, userIds) => {
        shared.push(userIds)
      },
    })
    await encryptAndSendOneMessage(deps(fakeHttp(), machine), IDENTITY)
    expect(shared).toEqual([['@alice:example.org', '@bob:example.org']])
  })

  it('drains the room key before encrypting, or the far side never gets it', async () => {
    const order: string[] = []
    const machine = fakeMachine({
      shareScopeKey: async () => {
        order.push('share')
      },
      takeOutgoingRequests: async () => {
        order.push('drain')
        return []
      },
      encryptEvent: async () => {
        order.push('encrypt')
        return { ciphertext: encode(CONTENT) } as never
      },
    })
    await encryptAndSendOneMessage(deps(fakeHttp(), machine), IDENTITY)
    expect(order).toEqual(['share', 'drain', 'encrypt'])
  })

  it('does not send when the room key itself could not be delivered', async () => {
    const machine = fakeMachine({
      takeOutgoingRequests: async () => [
        { id: 'r1', kind: 'to_device', body: '{}' },
      ],
    })
    // The body names no event type, so the request cannot be routed and the
    // drain reports it failed.
    const report = await encryptAndSendOneMessage(
      deps(fakeHttp(), machine),
      IDENTITY,
    )
    expect(report.sent).toBe(false)
    if (!report.sent) expect(report.reason).toMatch(/room key/)
  })

  it('reports the tampered ciphertext being accepted, rather than hiding it', async () => {
    const machine = fakeMachine({ decryptEvent: async () => ({}) })
    const report = await encryptAndSendOneMessage(
      deps(fakeHttp(), machine),
      IDENTITY,
    )
    expect(report.sent).toBe(true)
    if (report.sent) expect(report.tamper).toBe('accepted')
  })

  it('reports the intact ciphertext as the control, separately from the tampered one', async () => {
    // The machine decrypts what it recognises and refuses what it does not,
    // which is the only combination that says anything about the tampering.
    const machine = fakeMachine({
      decryptEvent: async (_scope, rawEvent) => {
        const content = (rawEvent as { content: { ciphertext: string } })
          .content
        if (content.ciphertext !== 'AwgAEnoriginal') {
          throw new Error('unable to decrypt')
        }
        return {}
      },
    })
    const report = await encryptAndSendOneMessage(
      deps(fakeHttp(), machine),
      IDENTITY,
    )
    expect(report.sent).toBe(true)
    if (report.sent) {
      expect(report.intactDecrypted).toBe(true)
      expect(report.tamper).toBe('refused')
    }
  })

  it('joins a room it has only been invited to, rather than reporting nothing to send to', async () => {
    const http = fakeHttp({
      '/_matrix/client/v3/joined_rooms': '{}',
      '/_matrix/client/v3/sync': `{"rooms":{"invite":{"${ROOM}":{}}}}`,
      [`/_matrix/client/v3/join/${encodeURIComponent(ROOM)}`]: `{"room_id":"${ROOM}"}`,
    })
    const report = await encryptAndSendOneMessage(
      deps(http, fakeMachine()),
      IDENTITY,
    )
    expect(report.sent).toBe(true)
    expect(http.calls.map(call => call.path)).toContain(
      `/_matrix/client/v3/join/${encodeURIComponent(ROOM)}`,
    )
  })

  it('offers the machine both copies locally, never sending either anywhere', async () => {
    const decryptEvent = vi.fn(async () => {
      throw new Error('unable to decrypt')
    })
    const http = fakeHttp()
    await encryptAndSendOneMessage(
      deps(http, fakeMachine({ decryptEvent })),
      IDENTITY,
    )
    // Twice: the intact control, then the tampered copy. Neither leaves the
    // device, and the single PUT is the real message.
    expect(decryptEvent).toHaveBeenCalledTimes(2)
    const sends = http.calls.filter(call => call.method === 'PUT')
    expect(sends).toHaveLength(1)
  })

  it('reports having no room to send to rather than inventing one', async () => {
    const http = fakeHttp({ '/_matrix/client/v3/joined_rooms': '{}' })
    const report = await encryptAndSendOneMessage(
      deps(http, fakeMachine()),
      IDENTITY,
    )
    expect(report).toEqual({
      sent: false,
      reason: 'this account is in no room, joined or invited',
    })
  })

  it('carries the reason when encryption itself fails', async () => {
    const machine = fakeMachine({
      encryptEvent: async () => {
        throw new Error('no session')
      },
    })
    const report = await encryptAndSendOneMessage(
      deps(fakeHttp(), machine),
      IDENTITY,
    )
    expect(report).toEqual({ sent: false, reason: 'no session' })
  })
})
