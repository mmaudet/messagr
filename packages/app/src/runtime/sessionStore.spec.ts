import { describe, expect, it, vi } from 'vitest'

import { loadSession, saveSession, type SecretStore } from './sessionStore'

const SESSION = {
  baseUrl: 'https://messagr.eu',
  userId: '@uvq:messagr.eu',
  deviceId: 'DEVICE1',
  accessToken: 'syt_secret',
}

function fakeStore(initial: string | null = null): SecretStore & {
  written: string[]
} {
  let held = initial
  const written: string[] = []
  return {
    read: async () => held,
    write: async value => {
      held = value
      written.push(value)
    },
    written,
  }
}

describe('saveSession and loadSession', () => {
  it('gives back what it was given', async () => {
    const store = fakeStore()
    await saveSession(store, SESSION)
    await expect(loadSession(store)).resolves.toEqual(SESSION)
  })

  it('is empty before anything has been saved', async () => {
    await expect(loadSession(fakeStore())).resolves.toBeNull()
  })

  it('refuses a stored value that is not a whole session', async () => {
    // A partial session restored would fail later, somewhere with nothing
    // connecting the failure to the storage that produced it.
    for (const missing of ['baseUrl', 'userId', 'deviceId', 'accessToken']) {
      const partial: Record<string, unknown> = { ...SESSION }
      delete partial[missing]
      await expect(
        loadSession(fakeStore(JSON.stringify(partial))),
      ).resolves.toBeNull()
    }
  })

  it('refuses a stored value that does not parse, rather than throwing', async () => {
    await expect(loadSession(fakeStore('not json'))).resolves.toBeNull()
  })

  it('survives a store that cannot be read', async () => {
    // A keystore can refuse: the device may be locked, or the entry may have
    // been invalidated by a credential change. That is not a crash.
    const store: SecretStore = {
      read: async () => {
        throw new Error('keystore unavailable')
      },
      write: async () => undefined,
    }
    await expect(loadSession(store)).resolves.toBeNull()
  })

  it('reports a save that did not happen instead of pretending it did', async () => {
    // Silently losing a session means claiming an invitation again, and an
    // invitation is single-use: the second claim finds nothing.
    const store: SecretStore = {
      read: async () => null,
      write: async () => {
        throw new Error('keystore full')
      },
    }
    await expect(saveSession(store, SESSION)).resolves.toBe(false)
  })

  it('confirms a save that did happen', async () => {
    await expect(saveSession(fakeStore(), SESSION)).resolves.toBe(true)
  })

  it('writes the session as one value, so a half-written session cannot exist', async () => {
    const store = fakeStore()
    await saveSession(store, SESSION)
    expect(store.written).toHaveLength(1)
    expect(JSON.parse(store.written[0] ?? '')).toEqual(SESSION)
  })

  it('never logs what it holds', async () => {
    // The access token is a bearer credential for the account.
    const spy = vi.spyOn(console, 'log')
    const store = fakeStore()
    await saveSession(store, SESSION)
    await loadSession(store)
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})
