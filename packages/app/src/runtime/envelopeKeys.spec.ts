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
  it('keeps the pair before it leaves, and gives it again until a proof holds with it', async () => {
    const { store, raw } = entry()
    const keys = envelopeKeysIn(store, () => 0)

    const first = await keys.toPublish()
    const again = await keys.toPublish()

    expect(raw()).not.toBeNull()
    expect(first).not.toBeNull()
    expect(again?.publicKey).toEqual(first?.publicKey)
    expect(await keys.secrets()).toEqual([first!.secretKey])
  })

  it('opens a name sealed for a key whose proof held without this device hearing it', async () => {
    const keys = envelopeKeysIn(entry().store, () => 0)
    const pair = (await keys.toPublish())!

    // The answer never came: nothing said the proof held.
    const sealed = sealName(base64Of(pair.publicKey), 'Nadia')!

    expect(openSealedName(await keys.secrets(), sealed)).toBe('Nadia')
  })

  it('replaces the others once a proof holds, keeps them thirty days, then takes them out of the keystore', async () => {
    let now = 0
    const { store, raw } = entry()
    const keys = envelopeKeysIn(store, () => now)
    const first = (await keys.toPublish())!
    await keys.published(first)
    now = 21 * DAY
    const second = (await keys.toPublish())!
    expect(second.publicKey).not.toEqual(first.publicKey)
    await keys.published(second)
    const sealedBefore = sealName(base64Of(first.publicKey), 'Nadia')!

    expect(await keys.secrets()).toEqual([second.secretKey, first.secretKey])
    now = 21 * DAY + REPLACED_KEPT_MS - 1
    expect(openSealedName(await keys.secrets(), sealedBefore)).toBe('Nadia')

    now = 21 * DAY + REPLACED_KEPT_MS
    expect(await keys.secrets()).toEqual([second.secretKey])
    expect(raw()).not.toContain(base64Of(first.secretKey))
  })

  it('gives nothing to publish when the keystore will not keep the pair', async () => {
    const keys = envelopeKeysIn(entry(true).store, () => 0)

    expect(await keys.toPublish()).toBeNull()
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
