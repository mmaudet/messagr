import { describe, expect, it } from 'vitest'

import { envelopeKeysIn, REPLACED_KEPT_MS } from './envelopeKeys'
import { base64Of } from './receiveImage'
import { openSealedName, sealName } from './sealedName'
import type { SecretStore } from './sessionStore'

/** A keystore entry, as an ordinary object; one that refuses, on request. */
function entry(refuses = false) {
  let value: string | null = null
  const store: SecretStore = {
    read: async () => value,
    write: async written => {
      if (refuses) throw new Error('the keystore said no')
      value = written
    },
  }
  return { store, raw: () => value }
}

const DAY = 86_400_000

describe('the envelope keys of this device (#405)', () => {
  it('keeps nothing for a fresh pair until the proof holds', async () => {
    const { store, raw } = entry()
    const keys = envelopeKeysIn(store, () => 0)

    keys.fresh()

    expect(raw()).toBeNull()
    expect(await keys.secrets()).toEqual([])
  })

  it('opens a name sealed for the key a proof published', async () => {
    const keys = envelopeKeysIn(entry().store, () => 0)
    const pair = keys.fresh()

    expect(await keys.keep(pair)).toBe(true)

    const sealed = sealName(base64Of(pair.publicKey), 'Nadia')!
    expect(openSealedName(await keys.secrets(), sealed)).toBe('Nadia')
  })

  it('keeps the key a renewal replaced for a week, the newest first, then forgets it', async () => {
    let now = 0
    const keys = envelopeKeysIn(entry().store, () => now)
    const first = keys.fresh()
    await keys.keep(first)
    now = 21 * DAY
    const second = keys.fresh()
    await keys.keep(second)

    const sealedBefore = sealName(base64Of(first.publicKey), 'Nadia')!
    expect(await keys.secrets()).toEqual([second.secretKey, first.secretKey])
    expect(openSealedName(await keys.secrets(), sealedBefore)).toBe('Nadia')

    now = 21 * DAY + REPLACED_KEPT_MS
    expect(await keys.secrets()).toEqual([second.secretKey])
    expect(openSealedName(await keys.secrets(), sealedBefore)).toBeNull()
  })

  it('says when the keystore would not take the key', async () => {
    const keys = envelopeKeysIn(entry(true).store, () => 0)

    expect(await keys.keep(keys.fresh())).toBe(false)
  })

  it('reads an entry it cannot make sense of as no key at all', async () => {
    for (const written of ['{', '"a string"', '[{"secret": 3}]']) {
      const store: SecretStore = {
        read: async () => written,
        write: async () => undefined,
      }
      expect(await envelopeKeysIn(store, () => 0).secrets()).toEqual([])
    }
  })
})
