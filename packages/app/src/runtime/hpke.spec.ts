import { describe, expect, it } from 'vitest'

import { deriveKeyPair, generateKeyPair, open, seal } from './hpke'

/**
 * RFC 9180, appendix A.2.1: DHKEM(X25519, HKDF-SHA256), HKDF-SHA256,
 * ChaCha20Poly1305, base mode, and its first encryption (sequence number 0).
 * Copied from the RFC's text, not from any implementation.
 */
const A_2_1 = {
  info: '4f6465206f6e2061204772656369616e2055726e',
  ikmE: '909a9b35d3dc4713a5e72a4da274b55d3d3821a37e5d099e74a647db583a904b',
  pkEm: '1afa08d3dec047a643885163f1180476fa7ddb54c6a8029ea33f95796bf2ac4a',
  skEm: 'f4ec9b33b792c372c1d2c2063507b684ef925b8c75a42dbcbf57d63ccd381600',
  ikmR: '1ac01f181fdf9f352797655161c58b75c656a6cc2716dcb66372da835542e1df',
  pkRm: '4310ee97d88cc1f088a5576c77ab0cf5c3ac797f3d95139c6c84b5429c59662a',
  skRm: '8057991eef8f1f1af18f4a9491d16a1ce333f695d4db8e38da75975c4478e0fb',
  enc: '1afa08d3dec047a643885163f1180476fa7ddb54c6a8029ea33f95796bf2ac4a',
  pt: '4265617574792069732074727574682c20747275746820626561757479',
  aad: '436f756e742d30',
  ct:
    '1c5250d8034ec2b784ba2cfd69dbdb8af406cfe3ff938e131f0def8c8b60b4db' +
    '21993c62ce81883d2dd1b51a28',
}

function bytes(written: string): Uint8Array {
  return Uint8Array.from(written.match(/../g) ?? [], pair => parseInt(pair, 16))
}

/** `of`, with the byte at `at` changed. */
function altered(of: Uint8Array, at: number): Uint8Array {
  const changed = of.slice()
  changed[at] = (changed[at]! + 1) % 256
  return changed
}

function hex(of: Uint8Array): string {
  return Array.from(of, b => b.toString(16).padStart(2, '0')).join('')
}

describe('HPKE, against the vectors of RFC 9180 (A.2.1)', () => {
  it('derives both key pairs from their seeds', () => {
    const ephemeral = deriveKeyPair(bytes(A_2_1.ikmE))
    const recipient = deriveKeyPair(bytes(A_2_1.ikmR))

    expect(hex(ephemeral.secretKey)).toBe(A_2_1.skEm)
    expect(hex(ephemeral.publicKey)).toBe(A_2_1.pkEm)
    expect(hex(recipient.secretKey)).toBe(A_2_1.skRm)
    expect(hex(recipient.publicKey)).toBe(A_2_1.pkRm)
  })

  it('seals the first message into the ciphertext the RFC gives', () => {
    const sealed = seal(
      bytes(A_2_1.pkRm),
      bytes(A_2_1.info),
      bytes(A_2_1.aad),
      bytes(A_2_1.pt),
      deriveKeyPair(bytes(A_2_1.ikmE)),
    )

    expect(hex(sealed.enc)).toBe(A_2_1.enc)
    expect(hex(sealed.ciphertext)).toBe(A_2_1.ct)
  })

  it("opens the RFC's ciphertext with the recipient's secret key", () => {
    const opened = open(
      bytes(A_2_1.skRm),
      { enc: bytes(A_2_1.enc), ciphertext: bytes(A_2_1.ct) },
      bytes(A_2_1.info),
      bytes(A_2_1.aad),
    )

    expect(opened === null ? null : hex(opened)).toBe(A_2_1.pt)
  })
})

describe('HPKE, sealed and opened here', () => {
  const info = Uint8Array.of(1, 2, 3)
  const aad = new Uint8Array(0)
  const message = Uint8Array.from('Nadia du club', c => c.charCodeAt(0))

  it('opens what it sealed, with a fresh ephemeral key each time', () => {
    const recipient = generateKeyPair()

    const first = seal(recipient.publicKey, info, aad, message)
    const second = seal(recipient.publicKey, info, aad, message)

    expect(open(recipient.secretKey, first, info, aad)).toEqual(message)
    expect(hex(first.enc)).not.toBe(hex(second.enc))
    expect(hex(first.ciphertext)).not.toBe(hex(second.ciphertext))
  })

  it('refuses an envelope altered on the way, a byte at a time', () => {
    const recipient = generateKeyPair()
    const sealed = seal(recipient.publicKey, info, aad, message)

    for (let at = 0; at < sealed.ciphertext.length; at += 1) {
      const ciphertext = altered(sealed.ciphertext, at)
      expect(
        open(recipient.secretKey, { ...sealed, ciphertext }, info, aad),
      ).toBeNull()
    }
    const enc = altered(sealed.enc, 0)
    expect(open(recipient.secretKey, { ...sealed, enc }, info, aad)).toBeNull()
  })

  it('opens nothing for another key, or for another purpose', () => {
    const recipient = generateKeyPair()
    const sealed = seal(recipient.publicKey, info, aad, message)

    expect(open(generateKeyPair().secretKey, sealed, info, aad)).toBeNull()
    expect(open(recipient.secretKey, sealed, Uint8Array.of(9), aad)).toBeNull()
    expect(open(recipient.secretKey, sealed, info, Uint8Array.of(9))).toBeNull()
  })
})
