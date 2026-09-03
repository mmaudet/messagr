import { describe, expect, it, vi } from 'vitest'

import { fetchSessionSyncStatus, type SyncClient } from './sessionSync'

type SyncHandler = (state: string, prevState: string | null) => void

function fakeClient(
  overrides: Partial<SyncClient> & { emit?: (h: SyncHandler) => void } = {},
): SyncClient {
  const { emit, ...rest } = overrides
  return {
    isLoggedIn: () => true,
    getCrypto: () => undefined,
    startClient: async () => undefined,
    stopClient: () => undefined,
    getRooms: () => [{}, {}, {}],
    once: (_event, handler) => {
      emit?.(handler)
    },
    ...rest,
  }
}

describe('fetchSessionSyncStatus', () => {
  it('refuses a client that carries no restored session', async () => {
    const status = await fetchSessionSyncStatus(
      fakeClient({ isLoggedIn: () => false }),
    )
    expect(status).toEqual({
      synced: false,
      reason: 'the client is not carrying a restored session',
    })
  })

  it('refuses a client that initialised its own crypto backend', async () => {
    const status = await fetchSessionSyncStatus(
      fakeClient({ getCrypto: () => ({ name: 'rust-crypto' }) }),
    )
    expect(status).toEqual({
      synced: false,
      reason: 'the transport initialised its own crypto backend',
    })
  })

  it('reports the room count once PREPARED fires, and stops the loop', async () => {
    const stopClient = vi.fn()
    const client = fakeClient({
      emit: handler => handler('PREPARED', null),
      stopClient,
    })
    const status = await fetchSessionSyncStatus(client)
    expect(status.synced).toBe(true)
    if (status.synced) {
      expect(status.roomCount).toBe(3)
      expect(status.durationMs).toBeGreaterThanOrEqual(0)
    }
    // /sync is long-polling: a second poll opens the moment the first lands,
    // and nothing above reads it. Left running it would be a leak, not a
    // feature the app has any use for yet.
    expect(stopClient).toHaveBeenCalledOnce()
  })

  it('accepts SYNCING as well as PREPARED', async () => {
    const client = fakeClient({
      emit: handler => handler('SYNCING', 'PREPARED'),
    })
    const status = await fetchSessionSyncStatus(client)
    expect(status.synced).toBe(true)
  })

  it('refuses a sync that lands in ERROR, and stops the loop it started', async () => {
    const stopClient = vi.fn()
    const client = fakeClient({
      emit: handler => handler('ERROR', null),
      stopClient,
    })
    const status = await fetchSessionSyncStatus(client)
    expect(status).toEqual({
      synced: false,
      reason: 'sync entered state ERROR',
    })
    expect(stopClient).toHaveBeenCalledOnce()
  })

  it('carries the reason when startClient itself throws, without stopping a loop that never started', async () => {
    const stopClient = vi.fn()
    const client = fakeClient({
      startClient: async () => {
        throw new Error('network unreachable')
      },
      stopClient,
    })
    const status = await fetchSessionSyncStatus(client)
    expect(status).toEqual({ synced: false, reason: 'network unreachable' })
    expect(stopClient).not.toHaveBeenCalled()
  })

  it('times out rather than waiting forever for a sync that never fires, and stops the loop', async () => {
    const stopClient = vi.fn()
    const client = fakeClient({ once: () => undefined, stopClient })
    const status = await fetchSessionSyncStatus(client, 10)
    expect(status.synced).toBe(false)
    if (!status.synced) {
      expect(status.reason).toContain('10ms')
    }
    expect(stopClient).toHaveBeenCalledOnce()
  })
})
