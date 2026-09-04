import { describe, expect, it } from 'vitest'

import {
  runOutgoingPumpCycle,
  type CryptoMachineOps,
  type OutgoingPumpDeps,
} from './outgoingPumpCycle'
import type { HttpRequester } from './pump'

function fakeHttp(
  respond: (method: string, path: string, body: string | undefined) => string,
): HttpRequester {
  return {
    authedRequest: async (method, path, _queryParams, body) =>
      respond(method, path, body),
  }
}

function fakeMachine(
  overrides: Partial<CryptoMachineOps> & {
    takeOutgoingRequestsSequence?: Array<
      readonly { id: string; kind: string; body: string }[]
    >
  } = {},
): CryptoMachineOps {
  const { takeOutgoingRequestsSequence, ...rest } = overrides
  const sequence = [...(takeOutgoingRequestsSequence ?? [[], []])]
  return {
    takeOutgoingRequests: async () => sequence.shift() ?? [],
    markRequestSent: async () => undefined,
    markRequestFailed: async () => undefined,
    receiveSyncChanges: async () => undefined,
    getDeviceIdentityKeys: async () => ({
      curve25519: 'curve-key',
      ed25519: 'ed-key',
    }),
    // No identity of its own, which is this application's real state and the
    // one under which 0.4.0 keeps the previous sharing strategy.
    getIdentityStatus: async () => ({
      accountKeysFetched: true,
      identityKnown: false,
      privateKeysHeld: false,
      accountKeysAnswerUnsettled: false,
      identityPublicationPending: false,
    }),
    ...rest,
  }
}

const IDENTITY = { userId: '@alice:example.org', deviceId: 'DEVICE1' }
const SYNC_RESPONSE = '{"next_batch":"tok-1","to_device":{"events":[]}}'
const DEVICE_KEYS_RESPONSE = JSON.stringify({
  device_keys: {
    '@alice:example.org': {
      DEVICE1: {
        keys: {
          'curve25519:DEVICE1': 'curve-key',
          'ed25519:DEVICE1': 'ed-key',
        },
      },
    },
  },
})

describe('runOutgoingPumpCycle', () => {
  it('publishes on the first drain, recovers the sync delta, and verifies what publishing did', async () => {
    const http = fakeHttp((method, path) => {
      if (path === '/_matrix/client/v3/keys/upload') {
        return '{"one_time_key_counts":{"signed_curve25519":50}}'
      }
      if (path === '/_matrix/client/v3/sync') return SYNC_RESPONSE
      if (method === 'POST' && path === '/_matrix/client/v3/keys/query') {
        return DEVICE_KEYS_RESPONSE
      }
      throw new Error(`unexpected request: ${method} ${path}`)
    })
    const machine = fakeMachine({
      takeOutgoingRequestsSequence: [
        [{ id: 'req-1', kind: 'keys_upload', body: '{}' }],
        [],
      ],
    })
    const deps: OutgoingPumpDeps = {
      http,
      machine,
      encryptionSlice: () => ({ next_batch_token: 'tok-1' }),
    }

    const report = await runOutgoingPumpCycle(deps, IDENTITY)

    expect(report.identityKeys).toEqual({
      curve25519: 'curve-key',
      ed25519: 'ed-key',
    })
    expect(report.firstDrain.sentKinds).toEqual(['keys_upload'])
    expect(report.deviceKeysVerified).toBe(true)
    expect(report.oneTimeKeysOnServer).toBe(50)
  })

  it('reports nothing published and nothing verified when the machine has nothing to send and the server confirms no device', async () => {
    const http = fakeHttp((method, path) => {
      if (path === '/_matrix/client/v3/sync') return SYNC_RESPONSE
      if (method === 'POST' && path === '/_matrix/client/v3/keys/query') {
        return '{"device_keys":{}}'
      }
      // A server that holds none, which is different from a question that
      // could not be asked -- the latter answers null.
      if (method === 'POST' && path === '/_matrix/client/v3/keys/upload') {
        return '{"one_time_key_counts":{}}'
      }
      throw new Error(`unexpected request: ${method} ${path}`)
    })
    const machine = fakeMachine()
    const deps: OutgoingPumpDeps = {
      http,
      machine,
      encryptionSlice: () => ({}),
    }

    const report = await runOutgoingPumpCycle(deps, IDENTITY)

    expect(report.firstDrain).toEqual({ sent: 0, failed: 0, sentKinds: [] })
    expect(report.secondDrain).toEqual({ sent: 0, failed: 0, sentKinds: [] })
    expect(report.deviceKeysVerified).toBe(false)
    expect(report.oneTimeKeysOnServer).toBe(0)
  })

  it('feeds the recovered delta to the machine before draining what it queues in response', async () => {
    const order: string[] = []
    const http = fakeHttp((method, path) => {
      if (path === '/_matrix/client/v3/sync') {
        order.push('fetch-sync-delta')
        return SYNC_RESPONSE
      }
      if (path === '/_matrix/client/v3/keys/query' && method === 'POST') {
        return DEVICE_KEYS_RESPONSE
      }
      return '{}'
    })
    const machine = fakeMachine({
      takeOutgoingRequestsSequence: [
        [],
        [{ id: 'req-2', kind: 'keys_query', body: '{}' }],
      ],
      receiveSyncChanges: async () => {
        order.push('receive-sync-changes')
      },
    })
    const originalTake = machine.takeOutgoingRequests
    const trackedMachine: CryptoMachineOps = {
      ...machine,
      takeOutgoingRequests: async () => {
        order.push('take-outgoing-requests')
        return originalTake()
      },
    }
    const deps: OutgoingPumpDeps = {
      http,
      machine: trackedMachine,
      encryptionSlice: () => ({ next_batch_token: 'tok-1' }),
    }

    const report = await runOutgoingPumpCycle(deps, IDENTITY)

    expect(order).toEqual([
      'take-outgoing-requests', // first drain
      'fetch-sync-delta',
      'receive-sync-changes',
      'take-outgoing-requests', // second drain, after the delta is fed in
    ])
    expect(report.secondDrain.sentKinds).toEqual(['keys_query'])
  })
})
