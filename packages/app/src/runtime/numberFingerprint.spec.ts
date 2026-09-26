import { describe, expect, it } from 'vitest'

import { numberFingerprint } from './numberFingerprint'

const bytes = (text: string) => Uint8Array.from(text, c => c.charCodeAt(0))
const fromHex = (hex: string) =>
  Uint8Array.from(hex.match(/../g)!, pair => parseInt(pair, 16))
const base64 = (b: Uint8Array) => btoa(String.fromCharCode(...b))

describe('the fingerprint of a number (#402)', () => {
  it('is HMAC-SHA-256, as RFC 4231 computes it', () => {
    // Test case 2 of RFC 4231: the key « Jefe ».
    expect(
      numberFingerprint(bytes('Jefe'), 'what do ya want for nothing?'),
    ).toBe(
      base64(
        fromHex(
          '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
        ),
      ),
    )
  })

  it('depends on the key, so one number differs from one device to another', () => {
    const number = '+33612345678'
    const one = numberFingerprint(new Uint8Array(32).fill(1), number)
    const other = numberFingerprint(new Uint8Array(32).fill(2), number)

    expect(one).not.toBe(other)
    expect(numberFingerprint(new Uint8Array(32).fill(1), number)).toBe(one)
  })

  it('holds no digit of the number', () => {
    const fingerprint = numberFingerprint(new Uint8Array(32), '+33612345678')
    expect(fingerprint).not.toContain('612345678')
  })
})
