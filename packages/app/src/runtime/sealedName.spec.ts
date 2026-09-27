import { describe, expect, it } from 'vitest'

import { bytesOf } from './base64'
import { generateKeyPair, seal } from './hpke'
import { base64Of } from './receiveImage'
import { openSealedName, sealName, SEALED_NAME_BYTES } from './sealedName'

const PURPOSE = new TextEncoder().encode('messagr declared name v1')

function recipient() {
  const pair = generateKeyPair()
  return { secret: pair.secretKey, published: base64Of(pair.publicKey) }
}

describe('the name an inviter gives itself, sealed for its recipient (#405)', () => {
  it('opens on the device it was sealed for', () => {
    const bob = recipient()

    const sealed = sealName(bob.published, 'Nadia du club')

    expect(sealed).not.toBeNull()
    expect(openSealedName([bob.secret], sealed!)).toBe('Nadia du club')
  })

  it('has the same size whatever the name, the one the service accepts', () => {
    const bob = recipient()

    const sizes = ['A', 'Nadia', 'x'.repeat(48), 'é'.repeat(24)].map(
      name => bytesOf(sealName(bob.published, name)!).length,
    )

    expect(SEALED_NAME_BYTES).toBe(96)
    expect(new Set(sizes)).toEqual(new Set([96]))
  })

  it('cuts a longer name where a link cuts it', () => {
    const bob = recipient()

    const long = sealName(bob.published, 'x'.repeat(60))
    expect(openSealedName([bob.secret], long!)).toBe('x'.repeat(48))
  })

  it('seals no name as well, at the same size, and it opens as no name', () => {
    const bob = recipient()

    for (const none of [null, '', '   ']) {
      const sealed = sealName(bob.published, none)
      expect(bytesOf(sealed!).length).toBe(SEALED_NAME_BYTES)
      expect(openSealedName([bob.secret], sealed!)).toBeNull()
    }
  })

  it('seals nothing for a key that is not one', () => {
    for (const key of [base64Of(new Uint8Array(31)), 'not a key at all !']) {
      expect(sealName(key, 'Nadia')).toBeNull()
    }
  })

  it('opens with a key replaced since, which a device keeps a week', () => {
    const before = recipient()
    const now = recipient()
    const sealed = sealName(before.published, 'Nadia')!

    expect(openSealedName([now.secret, before.secret], sealed)).toBe('Nadia')
  })

  it('shows no name, and no error, for an envelope altered or not for this device', () => {
    const bob = recipient()
    const sealed = sealName(bob.published, 'Nadia')!
    const altered = bytesOf(sealed)
    altered[40] = (altered[40]! + 1) % 256

    expect(openSealedName([recipient().secret], sealed)).toBeNull()
    expect(openSealedName([bob.secret], base64Of(altered))).toBeNull()
    expect(openSealedName([bob.secret], sealed.slice(4))).toBeNull()
    expect(openSealedName([bob.secret], 'not base64 !')).toBeNull()
    expect(openSealedName([], sealed)).toBeNull()
  })

  it('cleans a name another client sealed as a link name is cleaned', () => {
    const bob = generateKeyPair()
    const padded = new Uint8Array(48)
    padded.set(new TextEncoder().encode('Na‮dia\u0007'))
    const { enc, ciphertext } = seal(
      bob.publicKey,
      PURPOSE,
      new Uint8Array(0),
      padded,
    )
    const envelope = new Uint8Array(96)
    envelope.set(enc)
    envelope.set(ciphertext, 32)

    expect(openSealedName([bob.secretKey], base64Of(envelope))).toBe('Nadia')
  })
})
