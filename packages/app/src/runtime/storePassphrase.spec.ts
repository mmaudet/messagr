import { describe, expect, it } from 'vitest'

import type { SecretStore } from './sessionStore'
import { openStorePassphrase } from './storePassphrase'

/** A counting source, so a test can tell one mint from another. */
function countingRandom() {
  let calls = 0
  return (byteLength: number) => {
    calls += 1
    return Uint8Array.from({ length: byteLength }, (_, i) => (i + calls) % 256)
  }
}

function store(initial: string | null = null) {
  let held = initial
  const written: string[] = []
  const secrets: SecretStore = {
    read: async () => held,
    write: async value => {
      held = value
      written.push(value)
    },
  }
  return { secrets, written, current: () => held }
}

describe('openStorePassphrase', () => {
  it('mints one on a device that has none, and keeps it', async () => {
    const s = store()
    const result = await openStorePassphrase(s.secrets, countingRandom())
    expect(result.held).toBe(true)
    if (result.held) expect(result.minted).toBe(true)
    expect(s.written).toHaveLength(1)
  })

  it('gives back the same passphrase on every later launch', async () => {
    // The store is encrypted with it. A second passphrase is not a second
    // chance, it is a store nobody can open: every room key this device ever
    // received is behind the first one.
    const s = store()
    const random = countingRandom()
    const first = await openStorePassphrase(s.secrets, random)
    const second = await openStorePassphrase(s.secrets, random)
    expect(first).toEqual({
      held: true,
      passphrase: expect.any(String),
      minted: true,
    })
    expect(second.held).toBe(true)
    if (first.held && second.held) {
      expect(second.passphrase).toBe(first.passphrase)
      expect(second.minted).toBe(false)
    }
    expect(s.written).toHaveLength(1)
  })

  it('asks for enough randomness to be worth having', async () => {
    let asked = 0
    await openStorePassphrase(store().secrets, byteLength => {
      asked = byteLength
      return new Uint8Array(byteLength)
    })
    expect(asked).toBeGreaterThanOrEqual(32)
  })

  it('is not derived from anything a reader of the account could guess', async () => {
    // A passphrase derived from the device id or the user id is not a
    // passphrase, it is an obfuscation: both are on the server, and one of
    // them is in the invitation link.
    const s = store()
    const result = await openStorePassphrase(s.secrets, countingRandom())
    if (result.held) {
      expect(result.passphrase).not.toContain('DEVICE')
      expect(result.passphrase).not.toContain('messagr')
      expect(result.passphrase.length).toBeGreaterThanOrEqual(64)
    }
  })

  it('reports a keystore it could not read, rather than minting over it', async () => {
    // The difference between "no entry yet" and "cannot read the entry" is
    // the difference between a first launch and a lost history. Minting on
    // the second would replace a passphrase that still exists and orphan the
    // store it opens.
    const secrets: SecretStore = {
      read: async () => {
        throw new Error('keystore unavailable')
      },
      write: async () => undefined,
    }
    const result = await openStorePassphrase(secrets, countingRandom())
    expect(result.held).toBe(false)
    if (!result.held) expect(result.reason).toContain('could not be read')
  })

  it('reports a passphrase it minted but could not keep', async () => {
    // Opening the store with it now would write a store the next launch
    // cannot open, because the next launch will mint a different one. Losing
    // it silently loses every room key this device holds.
    const secrets: SecretStore = {
      read: async () => null,
      write: async () => {
        throw new Error('keystore full')
      },
    }
    const result = await openStorePassphrase(secrets, countingRandom())
    expect(result.held).toBe(false)
    if (!result.held) expect(result.reason).toContain('could not be kept')
  })

  it('treats an empty stored value as no passphrase rather than as one', async () => {
    const s = store('')
    const result = await openStorePassphrase(s.secrets, countingRandom())
    expect(result.held).toBe(true)
    if (result.held) expect(result.minted).toBe(true)
  })
})
