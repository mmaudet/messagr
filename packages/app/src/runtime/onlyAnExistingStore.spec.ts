import { describe, expect, it } from 'vitest'

import { onlyAnExistingStore } from './onlyAnExistingStore'
import type { SecretStore } from './sessionStore'
import { openStorePassphrase } from './storePassphrase'

/** The keystore entry for a store's passphrase, empty to begin with. */
function entry(): SecretStore {
  let held: string | null = null
  return {
    read: async () => held,
    write: async value => {
      held = value
    },
  }
}

/** Randomness that never draws the same bytes twice, so two mints differ. */
function draws() {
  let drawn = 0
  return (byteLength: number) => {
    drawn += 1
    return new Uint8Array(byteLength).fill(drawn)
  }
}

describe('onlyAnExistingStore', () => {
  it('leaves the first creation to the launch, so one passphrase is minted', async () => {
    // Found in review on 14 September 2026. Right after a departure the new
    // account has no store, and a push from the old server can wake this
    // context while the launch creates it. `openStorePassphrase` reads, then
    // writes: the wake and the launch each minted one, the store was made with
    // one of them, and the keystore kept the other.
    const passphrase = entry()
    const random = draws()
    const minted: string[] = []
    let storeExists = false
    const openTheStore = async () => {
      const opened = await openStorePassphrase(passphrase, random)
      if (opened.held && opened.minted) minted.push(opened.passphrase)
      storeExists = true
      return { started: true } as const
    }

    const launch = openTheStore()
    const wake = onlyAnExistingStore(async () => storeExists, openTheStore)

    expect(await wake).toEqual({
      started: false,
      reason:
        'this device has no crypto store yet, and only a launch makes one',
    })
    await launch
    expect(minted).toHaveLength(1)
  })

  it('opens a store that exists', async () => {
    let opened = 0
    const result = await onlyAnExistingStore(
      async () => true,
      async () => {
        opened += 1
        return { started: true } as const
      },
    )
    expect(result).toEqual({ started: true })
    expect(opened).toBe(1)
  })
})
