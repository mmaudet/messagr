import { describe, expect, it } from 'vitest'

import type { SecretStore } from './sessionStore'
import { allowWake, wakeIsAllowed } from './wakeSetting'

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

describe('wakeIsAllowed', () => {
  it('is on when nothing has been chosen', async () => {
    // The opposite default from read receipts, and for the opposite reason:
    // a wake publishes nothing about anybody, and a messenger that does not
    // say a message arrived is not doing the thing it was installed for.
    expect(await wakeIsAllowed(held(null))).toBe(true)
  })

  it('is off when somebody turned it off', async () => {
    expect(await wakeIsAllowed(held('off'))).toBe(false)
  })

  it('fails on rather than off', async () => {
    // A keystore failure that left a phone never ringing, with nothing on
    // screen to explain it, is the unrecoverable direction here.
    expect(await wakeIsAllowed(refuses)).toBe(true)
  })
})

describe('allowWake', () => {
  it('keeps both answers, and reads them back', async () => {
    const store = held(null)
    expect(await allowWake(store, false)).toBe(true)
    expect(await wakeIsAllowed(store)).toBe(false)
    expect(await allowWake(store, true)).toBe(true)
    expect(await wakeIsAllowed(store)).toBe(true)
  })

  it('answers false rather than throwing', async () => {
    expect(await allowWake(refuses, false)).toBe(false)
  })
})
