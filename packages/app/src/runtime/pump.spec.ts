import { describe, expect, it, vi } from 'vitest'

import {
  PumpHttpError,
  drainOutgoingRequests,
  sendOutgoingRequest,
  type CryptoMachine,
  type HttpRequester,
  type OutgoingRequest,
} from './pump'

function fakeHttp(
  respond: (
    method: string,
    path: string,
    queryParams: Record<string, string>,
    body: string | undefined,
  ) => Promise<string>,
): HttpRequester {
  return { authedRequest: respond }
}

function request(kind: string, body: unknown): OutgoingRequest {
  return { id: `id-${kind}`, kind, body: JSON.stringify(body) }
}

describe('sendOutgoingRequest', () => {
  it.each([
    ['keys_upload', 'POST', '/_matrix/client/v3/keys/upload'],
    ['keys_query', 'POST', '/_matrix/client/v3/keys/query'],
    ['keys_claim', 'POST', '/_matrix/client/v3/keys/claim'],
    ['signature_upload', 'POST', '/_matrix/client/v3/keys/signatures/upload'],
    [
      'signing_keys_upload',
      'POST',
      '/_matrix/client/v3/keys/device_signing/upload',
    ],
  ] as const)(
    'routes %s to %s %s, body verbatim',
    async (kind, method, path) => {
      const seen: { method?: string; path?: string; body?: string } = {}
      const http = fakeHttp(async (m, p, _q, b) => {
        seen.method = m
        seen.path = p
        seen.body = b
        return '{}'
      })
      const body = { device_keys: { curve25519: 'x' } }
      await sendOutgoingRequest(http, request(kind, body))
      expect(seen.method).toBe(method)
      expect(seen.path).toBe(path)
      expect(seen.body).toBe(JSON.stringify(body))
    },
  )

  it('routes to_device to sendToDevice with the event type and transaction id in the path, and only messages in the body', async () => {
    const seen: { method?: string; path?: string; body?: string } = {}
    const http = fakeHttp(async (m, p, _q, b) => {
      seen.method = m
      seen.path = p
      seen.body = b
      return '{}'
    })
    await sendOutgoingRequest(
      http,
      request('to_device', {
        event_type: 'm.room.encrypted',
        txn_id: 'txn-1',
        messages: { '@bob:example.org': { DEVICE1: { ciphertext: 'x' } } },
      }),
    )
    expect(seen.method).toBe('PUT')
    expect(seen.path).toBe(
      '/_matrix/client/v3/sendToDevice/m.room.encrypted/txn-1',
    )
    expect(seen.body).toBe(
      JSON.stringify({
        messages: { '@bob:example.org': { DEVICE1: { ciphertext: 'x' } } },
      }),
    )
  })

  it('encodes the event type and transaction id in a to_device path', async () => {
    const seen: { path?: string } = {}
    const http = fakeHttp(async (_m, p) => {
      seen.path = p
      return '{}'
    })
    await sendOutgoingRequest(
      http,
      request('to_device', {
        event_type: 'm.room_key.withheld',
        txn_id: 'txn/with slash',
        messages: {},
      }),
    )
    expect(seen.path).toBe(
      '/_matrix/client/v3/sendToDevice/m.room_key.withheld/txn%2Fwith%20slash',
    )
  })

  it('refuses a to_device request missing its event type or transaction id', async () => {
    const http = fakeHttp(async () => '{}')
    await expect(
      sendOutgoingRequest(http, request('to_device', { messages: {} })),
    ).rejects.toThrow(/event type/)
  })

  it('routes room_message to the room send endpoint, body verbatim', async () => {
    const seen: { method?: string; path?: string; body?: string } = {}
    const http = fakeHttp(async (m, p, _q, b) => {
      seen.method = m
      seen.path = p
      seen.body = b
      return '{"event_id":"$abc"}'
    })
    const body = {
      room_id: '!room:example.org',
      event_type: 'm.room.encrypted',
      txn_id: 'txn-2',
      content: { ciphertext: 'x' },
    }
    await sendOutgoingRequest(http, request('room_message', body))
    expect(seen.method).toBe('PUT')
    expect(seen.path).toBe(
      '/_matrix/client/v3/rooms/!room%3Aexample.org/send/m.room.encrypted/txn-2',
    )
    expect(seen.body).toBe(JSON.stringify(body))
  })

  it('routes room_key_backup with the version in the query string', async () => {
    // This test used to assert the opposite. It named `room_key_backup`
    // as the example of a kind this app refuses to route, and it was right
    // to: nothing here backed keys up, so a request of that kind could only
    // have come from a surface this app did not understand.
    //
    // ADR-0013 changed the decision, not the reasoning. `/room_keys` is
    // Matrix protocol and belongs on the protocol's path; a second place
    // that talks to the homeserver with rules of its own is how two places
    // come to disagree. So the kind is routed, and the rule it used to
    // stand for is asserted below on a kind that really is unknown.
    const seen: {
      method?: string
      path?: string
      query?: Record<string, string>
      body?: string
    } = {}
    const http = fakeHttp(async (m, p, q, b) => {
      seen.method = m
      seen.path = p
      seen.query = q
      seen.body = b
      return '{"etag":"opaque","count":1}'
    })
    const rooms = {
      '!room:example.org': {
        sessions: { 'session-id': { is_verified: true } },
      },
    }

    await sendOutgoingRequest(
      http,
      request('room_key_backup', { version: '947281', rooms }),
    )

    expect(seen.method).toBe('PUT')
    expect(seen.path).toBe('/_matrix/client/v3/room_keys/keys')
    expect(seen.query).toEqual({ version: '947281' })
    // `rooms` alone: the version travels in the body only because the query
    // string needs a value the wire body does not carry, the same way
    // to_device's event type and transaction id do.
    expect(seen.body).toBe(JSON.stringify({ rooms }))
  })

  it('never turns the backup version into a number', async () => {
    // Six digits, which is what Continuwuity 26.7.2 answers with where
    // Synapse answers with a counter from "1". The specification makes the
    // field an opaque string, so a client that parsed it would work against
    // one homeserver and fail against the other. The leading zero is the
    // assertion: a number would lose it.
    const seen: { query?: Record<string, string> } = {}
    const http = fakeHttp(async (_m, _p, q) => {
      seen.query = q
      return '{"etag":"opaque","count":1}'
    })

    await sendOutgoingRequest(
      http,
      request('room_key_backup', { version: '047281', rooms: {} }),
    )

    expect(seen.query).toEqual({ version: '047281' })
  })

  it('refuses a room_key_backup that names no version', async () => {
    // The version belongs in the query string, so a request without one has
    // nowhere to go. Refused here rather than sent to a URL with an empty
    // `?version=`, which a homeserver answers for some other backup or for
    // none.
    const http = fakeHttp(async () => '{}')
    await expect(
      sendOutgoingRequest(http, request('room_key_backup', { rooms: {} })),
    ).rejects.toThrow(/version/)
  })

  it('refuses a request of a kind it cannot route', async () => {
    const http = fakeHttp(async () => '{}')
    await expect(
      sendOutgoingRequest(http, request('m.some.future.kind', {})),
    ).rejects.toThrow(/m\.some\.future\.kind/)
  })

  it('lets the http failure propagate to the caller', async () => {
    const http = fakeHttp(async () => {
      throw new PumpHttpError('refused', 429)
    })
    await expect(
      sendOutgoingRequest(http, request('keys_upload', {})),
    ).rejects.toBeInstanceOf(PumpHttpError)
  })
})

describe('drainOutgoingRequests', () => {
  function fakeMachine(requests: readonly OutgoingRequest[]): CryptoMachine & {
    sentIds: string[]
    failedIds: Array<{ id: string; status: number }>
  } {
    const sentIds: string[] = []
    const failedIds: Array<{ id: string; status: number }> = []
    return {
      takeOutgoingRequests: async () => requests,
      markRequestSent: async (id: string) => {
        sentIds.push(id)
      },
      markRequestFailed: async (id: string, status: number) => {
        failedIds.push({ id, status })
      },
      sentIds,
      failedIds,
    }
  }

  it('sends every request the machine hands out and marks each sent', async () => {
    const requests = [request('keys_upload', {}), request('keys_query', {})]
    const machine = fakeMachine(requests)
    const http = fakeHttp(async () => '{}')
    const result = await drainOutgoingRequests(http, machine)
    expect(result).toEqual({
      sent: 2,
      failed: 0,
      sentKinds: ['keys_upload', 'keys_query'],
      failures: [],
    })
    expect(machine.sentIds).toEqual(['id-keys_upload', 'id-keys_query'])
  })

  it('marks a refused request failed with the status it carried, and keeps draining', async () => {
    const requests = [request('keys_upload', {}), request('keys_query', {})]
    const machine = fakeMachine(requests)
    let calls = 0
    const http = fakeHttp(async () => {
      calls += 1
      if (calls === 1) throw new PumpHttpError('refused', 429)
      return '{}'
    })
    const result = await drainOutgoingRequests(http, machine)
    expect(result).toEqual({
      sent: 1,
      failed: 1,
      sentKinds: ['keys_query'],
      // Named, not just counted: a caller has to be able to say which
      // request a drain lost and what refused it.
      failures: [{ kind: 'keys_upload', status: 429 }],
    })
    expect(machine.failedIds).toEqual([{ id: 'id-keys_upload', status: 429 }])
    expect(machine.sentIds).toEqual(['id-keys_query'])
  })

  it('reports a failure that was not HTTP with a zero status rather than inventing one', async () => {
    // A transport that threw something other than a refusal carries no
    // status, and reporting a plausible-looking one would be a fact nobody
    // established.
    const machine = fakeMachine([request('keys_upload', {})])
    const http = fakeHttp(async () => {
      throw new Error('the socket went away')
    })
    const result = await drainOutgoingRequests(http, machine)
    expect(result.failures).toEqual([{ kind: 'keys_upload', status: 0 }])
  })

  it('lists only the kinds that actually succeeded, in send order', async () => {
    const requests = [
      request('keys_query', {}),
      request('keys_upload', {}),
      request('keys_claim', {}),
    ]
    const machine = fakeMachine(requests)
    let calls = 0
    const http = fakeHttp(async () => {
      calls += 1
      if (calls === 2) throw new PumpHttpError('refused', 500)
      return '{}'
    })
    const result = await drainOutgoingRequests(http, machine)
    expect(result.sentKinds).toEqual(['keys_query', 'keys_claim'])
  })

  it('reports status 0 for a failure that carries none, such as a dropped connection', async () => {
    const machine = fakeMachine([request('keys_upload', {})])
    const http = fakeHttp(async () => {
      throw new Error('network unreachable')
    })
    await drainOutgoingRequests(http, machine)
    expect(machine.failedIds).toEqual([{ id: 'id-keys_upload', status: 0 }])
  })

  it('sends requests in the order they were handed out, not concurrently', async () => {
    const requests = [
      request('keys_upload', {}),
      request('keys_query', {}),
      request('keys_claim', {}),
    ]
    const machine = fakeMachine(requests)
    const order: string[] = []
    const http = fakeHttp(async (_m, path) => {
      order.push(path)
      // A concurrent implementation would let a faster later request finish
      // before an earlier, artificially slowed one.
      if (path.endsWith('upload')) await new Promise(r => setTimeout(r, 5))
      return '{}'
    })
    await drainOutgoingRequests(http, machine)
    expect(order).toEqual([
      '/_matrix/client/v3/keys/upload',
      '/_matrix/client/v3/keys/query',
      '/_matrix/client/v3/keys/claim',
    ])
  })

  it('does nothing when the machine has nothing outstanding', async () => {
    const machine = fakeMachine([])
    const http = fakeHttp(vi.fn())
    const result = await drainOutgoingRequests(http, machine)
    expect(result).toEqual({
      sent: 0,
      failed: 0,
      sentKinds: [],
      failures: [],
    })
  })
})
