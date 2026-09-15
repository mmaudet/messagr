import { describe, expect, it } from 'vitest'

import { passphraseGiven } from './vaultPassphrase'

describe('passphraseGiven', () => {
  it('is false for an empty field, so the vault buttons wait for one', () => {
    expect(passphraseGiven('')).toBe(false)
  })

  it('is false for spaces alone, which nobody means as a passphrase', () => {
    expect(passphraseGiven('   ')).toBe(false)
  })

  it('is true as soon as something is typed', () => {
    expect(passphraseGiven('correct horse battery staple')).toBe(true)
  })

  it('keeps a passphrase that only starts or ends with a space', () => {
    expect(passphraseGiven(' a ')).toBe(true)
  })
})
