import { describe, expect, it, vi } from 'vitest'

import type { SecretStore } from './sessionStore'
import { readSyncCursor, writeSyncCursor } from './syncCursor'

function fakeStore(held: string | null): SecretStore & { held: string | null } {
  const store = {
    held,
    read: async () => store.held,
    write: async (value: string) => {
      store.held = value
    },
  }
  return store
}

describe('readSyncCursor', () => {
  it('reads back what a previous launch wrote', async () => {
    const store = fakeStore(null)
    await writeSyncCursor(store, 's_42')
    expect(await readSyncCursor(store)).toBe('s_42')
  })

  it('is null when nothing has been stored yet', async () => {
    expect(await readSyncCursor(fakeStore(null))).toBeNull()
  })

  it('is null rather than empty for a store holding an empty string', async () => {
    expect(await readSyncCursor(fakeStore(''))).toBeNull()
  })

  it('is null when the keystore refuses, so a locked device syncs from the beginning', async () => {
    const store: SecretStore = {
      read: async () => {
        throw new Error('keystore locked')
      },
      write: async () => {},
    }
    expect(await readSyncCursor(store)).toBeNull()
  })
})

describe('writeSyncCursor', () => {
  it('reports the write it made', async () => {
    const store = fakeStore(null)
    expect(await writeSyncCursor(store, 's_1')).toBe(true)
    expect(store.held).toBe('s_1')
  })

  it('reports a refused write rather than throwing it at the loop', async () => {
    const write = vi.fn(async () => {
      throw new Error('keystore refused')
    })
    expect(
      await writeSyncCursor({ read: async () => null, write }, 's_1'),
    ).toBe(false)
  })
})
