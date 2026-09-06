import { describe, expect, it } from 'vitest'

import type { SecretStore } from './sessionStore'
import {
  rememberTermsAccepted,
  termsWereAccepted,
  TERMS_IN_FORCE,
} from './termsAccepted'

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

describe('termsWereAccepted', () => {
  it('is false when nothing was ever accepted', async () => {
    expect(await termsWereAccepted(held(null))).toBe(false)
  })

  it('is true for the conditions in force', async () => {
    expect(await termsWereAccepted(held(TERMS_IN_FORCE))).toBe(true)
  })

  it('is false for conditions that have since been revised', async () => {
    // The reason this stores a version rather than a flag. A revision nobody
    // was asked about is a revision nobody agreed to, and a flag cannot tell
    // the difference.
    expect(await termsWereAccepted(held('2025-01-01'))).toBe(false)
  })

  it('is false when the store refuses, so the screen comes back', async () => {
    // The cost of asking twice is a tap. The cost of recording an acceptance
    // that never happened is a claim about a person that is not true.
    expect(await termsWereAccepted(refuses)).toBe(false)
  })
})

describe('rememberTermsAccepted', () => {
  it('records the conditions in force, and reads back true', async () => {
    const store = held(null)
    expect(await rememberTermsAccepted(store)).toBe(true)
    expect(await termsWereAccepted(store)).toBe(true)
  })

  it('answers false rather than throwing', async () => {
    expect(await rememberTermsAccepted(refuses)).toBe(false)
  })
})
