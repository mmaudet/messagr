import { describe, expect, it } from 'vitest'

import { LANGUAGES, languageOf } from './languages'

describe('LANGUAGES', () => {
  it('offers the six the identity names, and Uzbek', () => {
    // The list, spelled out, so adding a language is a deliberate edit here
    // rather than a side effect somewhere else. Uzbek is named apart on
    // purpose: the first six follow from the flows this product was built
    // for, and the seventh was asked for. See `languages.ts`.
    expect(LANGUAGES.map(l => l.code)).toEqual([
      'fr',
      'en',
      'de',
      'es',
      'it',
      'nl',
      'uz',
    ])
  })

  it('names each language in itself', () => {
    // Not "French" and "German" in English. Somebody looking for their own
    // language is looking for the word they call it by.
    expect(LANGUAGES.map(l => l.endonym)).toEqual([
      'Français',
      'English',
      'Deutsch',
      'Español',
      'Italiano',
      'Nederlands',
      // Latin script, and `oʻ` written with the modifier letter turned comma
      // (U+02BB) rather than an apostrophe: that is the standard form, and
      // `copy.spec.ts` checks this string against the one in `uz.ts`.
      'Oʻzbekcha',
    ])
  })

  it('carries a flag for each, and no two the same', () => {
    const flags = LANGUAGES.map(l => l.flag)
    expect(new Set(flags).size).toBe(flags.length)
  })
})

describe('languageOf', () => {
  it('reads a bare tag', () => {
    expect(languageOf('de')).toBe('de')
  })

  it('reads a region tag, in either shape a platform uses', () => {
    expect(languageOf('fr-CA')).toBe('fr')
    expect(languageOf('nl_BE')).toBe('nl')
  })

  it('does not care about case', () => {
    expect(languageOf('EN-GB')).toBe('en')
  })

  it('is nothing for a language this application does not speak', () => {
    // `null` rather than French. A device set to Polish gets whatever the
    // caller decides to do about it, and quietly pretending it asked for
    // French is not a decision this function should make.
    expect(languageOf('pl')).toBeNull()
  })

  it('is nothing for nonsense', () => {
    expect(languageOf('')).toBeNull()
    expect(languageOf('-')).toBeNull()
  })
})
