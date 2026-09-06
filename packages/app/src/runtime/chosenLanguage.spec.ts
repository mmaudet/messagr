import { describe, expect, it } from 'vitest'

import { readChosenLanguage, rememberLanguage } from './chosenLanguage'
import type { SecretStore } from './sessionStore'

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
    throw new Error('the keystore is locked')
  },
  write: async () => {
    throw new Error('the keystore is locked')
  },
  clear: async () => {},
} as unknown as SecretStore

describe('readChosenLanguage', () => {
  it('reads back what was chosen', async () => {
    expect(await readChosenLanguage(held('nl'), 'fr-FR')).toBe('nl')
  })

  it('falls back to the device’s own language, not to French', async () => {
    // A phone set to Dutch whose store holds nothing should not meet a French
    // screen: the device already knows what its owner reads.
    expect(await readChosenLanguage(held(null), 'nl-BE')).toBe('nl')
  })

  it('falls back to French for a language this application does not speak', async () => {
    expect(await readChosenLanguage(held(null), 'pl-PL')).toBe('fr')
  })

  it('falls back the same way when the store refuses', async () => {
    expect(await readChosenLanguage(refuses, 'de-AT')).toBe('de')
  })

  it('ignores a stored value it does not recognise', async () => {
    // A file on a device. A value that is not a language this application
    // speaks would render `undefined` in every label.
    expect(await readChosenLanguage(held('klingon'), 'it-IT')).toBe('it')
  })
})

describe('rememberLanguage', () => {
  it('keeps it, and says so', async () => {
    const store = held(null)
    expect(await rememberLanguage(store, 'es')).toBe(true)
    expect(await readChosenLanguage(store, 'fr')).toBe('es')
  })

  it('answers false rather than throwing when it will not hold', async () => {
    expect(await rememberLanguage(refuses, 'de')).toBe(false)
  })
})
