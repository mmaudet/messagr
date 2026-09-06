import { describe, expect, it } from 'vitest'

import type { SecretStore } from './sessionStore'
import { readStoreDirectory, rememberStoreDirectory } from './storeDirectory'

function held(value: string | null): SecretStore {
  let kept = value
  return {
    read: async () => kept,
    write: async (next: string) => {
      kept = next
    },
    clear: async () => {
      kept = null
    },
  } as unknown as SecretStore
}

const refuses: SecretStore = {
  read: async () => {
    throw new Error('locked')
  },
  write: async () => {
    throw new Error('locked')
  },
  clear: async () => {},
} as unknown as SecretStore

describe('rememberStoreDirectory', () => {
  it('keeps a directory and reads it back', async () => {
    const store = held(null)
    expect(
      await rememberStoreDirectory(store, '/data/user/0/eu.messagr/files'),
    ).toBe(true)
    expect(await readStoreDirectory(store)).toEqual({
      dir: '/data/user/0/eu.messagr/files',
    })
  })

  it('refuses to record nothing', async () => {
    // An empty value read back would look like a directory this application
    // should try to open. "Nothing was recorded" is a different answer.
    const store = held(null)
    expect(await rememberStoreDirectory(store, '')).toBe(false)
    expect(await readStoreDirectory(store)).toEqual({
      dir: null,
      reason: 'this device has not recorded where its stores are',
    })
  })

  it('answers false rather than throwing when it will not hold', async () => {
    expect(await rememberStoreDirectory(refuses, '/somewhere')).toBe(false)
  })
})

describe('readStoreDirectory', () => {
  it('says nothing was recorded, rather than guessing', async () => {
    const answer = await readStoreDirectory(held(null))
    expect(answer.dir).toBeNull()
  })

  it('says why when the store refuses', async () => {
    const answer = await readStoreDirectory(refuses)
    expect(answer).toEqual({ dir: null, reason: 'locked' })
  })
})
