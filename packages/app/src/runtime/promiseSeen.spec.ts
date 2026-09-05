import { describe, expect, it } from 'vitest'

import { hasSeenPromise, rememberPromiseSeen } from './promiseSeen'
import type { SecretStore } from './sessionStore'

function store(held: string | null): SecretStore & { held: string | null } {
  const s = {
    held,
    read: async () => s.held,
    write: async (value: string) => {
      s.held = value
    },
  }
  return s
}

describe('hasSeenPromise', () => {
  it('is false on a device that has never been shown it', async () => {
    expect(await hasSeenPromise(store(null))).toBe(false)
  })

  it('is true once it has been remembered', async () => {
    const s = store(null)
    await rememberPromiseSeen(s)
    expect(await hasSeenPromise(s)).toBe(true)
  })

  it('treats an empty value as never shown', async () => {
    expect(await hasSeenPromise(store(''))).toBe(false)
  })

  it('shows it again rather than skipping it when the store cannot be read', async () => {
    // The default that matters. Answering true here would hide the first
    // screen from somebody seeing the application for the first time, which
    // is the one failure this screen cannot recover from.
    const refusing: SecretStore = {
      read: async () => {
        throw new Error('the keystore is locked')
      },
      write: async () => {},
    }
    expect(await hasSeenPromise(refusing)).toBe(false)
  })
})

describe('rememberPromiseSeen', () => {
  it('reports the write it made', async () => {
    const s = store(null)
    expect(await rememberPromiseSeen(s)).toBe(true)
    expect(s.held).not.toBeNull()
  })

  it('reports a refused write rather than throwing it at the screen', async () => {
    const refusing: SecretStore = {
      read: async () => null,
      write: async () => {
        throw new Error('the keystore refused')
      },
    }
    expect(await rememberPromiseSeen(refusing)).toBe(false)
  })
})
