import { describe, expect, it } from 'vitest'

import { accountInQuestion, putTheAccountInQuestion } from './accountInQuestion'

describe('accountInQuestion', () => {
  it('holds from the moment the question is put until it is released', () => {
    expect(accountInQuestion()).toBe(false)
    const release = putTheAccountInQuestion()
    expect(accountInQuestion()).toBe(true)
    release()
    expect(accountInQuestion()).toBe(false)
  })

  it('is not released twice by the same release', () => {
    // Module state, read by the wake. A release called again must not lift a
    // question put since.
    const first = putTheAccountInQuestion()
    first()
    const second = putTheAccountInQuestion()
    first()
    expect(accountInQuestion()).toBe(true)
    second()
    expect(accountInQuestion()).toBe(false)
  })
})
