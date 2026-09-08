import { describe, expect, it } from 'vitest'

import { keepLastPushkey, readLastPushkey } from './lastPushkey'
import type { SecretStore } from './sessionStore'

function store(held: string | null | Error, refuseWrite = false): SecretStore {
  let value = held
  return {
    read: async () => {
      if (value instanceof Error) throw value
      return value
    },
    write: async (next: string) => {
      if (refuseWrite) throw new Error('the keystore refused')
      value = next
    },
    clear: async () => {
      value = null
    },
  } as unknown as SecretStore
}

describe('the pushkey this device registered', () => {
  it('reads back what was written', async () => {
    const kept = store(null)
    await keepLastPushkey(kept, 'eb8e0400')
    expect(await readLastPushkey(kept)).toBe('eb8e0400')
  })

  it('answers null for a device that never registered one', async () => {
    expect(await readLastPushkey(store(null))).toBeNull()
    expect(await readLastPushkey(store(''))).toBeNull()
  })

  it('answers null rather than throwing when the store will not open', async () => {
    // A device that cannot say what it registered before skips the removal:
    // a ghost left behind is noise, while removing a pusher that might be
    // another device's is silence.
    expect(await readLastPushkey(store(new Error('locked')))).toBeNull()
  })

  it('says so when the key could not be kept', async () => {
    // Survivable: the pusher is registered either way, and the next launch
    // that manages to write it down takes over the pruning.
    expect(await keepLastPushkey(store(null, true), 'eb8e0400')).toBe(false)
  })
})
