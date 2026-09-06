import { describe, expect, it } from 'vitest'

import { fr } from './fr'
import { CATALOGUES, currentLanguage, setCatalogue, t } from './index'
import { LANGUAGES } from './languages'

describe('the copy catalogue', () => {
  it('reads a string by key', () => {
    expect(t('tab_discussions')).toBe('Discussions')
  })

  it('fills a placeholder the key itself names', () => {
    // The previous product wrote the placeholder into the key. Keeping that
    // shape is what lets the other four catalogues drop in unmodified.
    expect(t('core_version_label %@', '0.1.0')).toBe('Version du noyau : 0.1.0')
  })

  it('carries no trust or entry copy', () => {
    // Refused on purpose rather than missed. That copy describes a ceremony
    // which gated nothing, and uses "reconnaissance" in the sense the
    // glossary has since reassigned to vouching -- plausible, and wrong.
    const refused = [
      'recognition',
      'ceremony',
      'arrival',
      'first_',
      'promotion',
      'revocation',
      'invitation_',
      'inert',
    ]
    const smuggled = Object.keys(fr).filter(key =>
      refused.some(prefix => key.startsWith(prefix)),
    )
    expect(smuggled).toEqual([])
  })

  it('never says "reconnu" anywhere, in any string', () => {
    // The word itself, not just the key prefix: the glossary reassigned it,
    // so a sentence carrying it would be wrong wherever it came from.
    const offending = Object.entries(fr).filter(([, value]) =>
      /reconnu|reconnaissance/i.test(value),
    )
    expect(offending).toEqual([])
  })

  it('never says "vérifier" anywhere, in any string', () => {
    // #34's own acceptance criterion, kept as a test rather than as
    // something somebody re-reads. Verification is a real act in this
    // product -- comparing a short string, scanning a code -- and vouching
    // is a human judgement that proves nothing cryptographically. A screen
    // that borrowed the word would be telling somebody they had done the
    // one when they had done the other.
    const offending = Object.entries(fr).filter(([, value]) =>
      /vérifi|verifi/i.test(value),
    )
    expect(offending).toEqual([])
  })

  it('has no empty string, which would render as a missing label', () => {
    const blank = Object.entries(fr).filter(([, value]) => value.trim() === '')
    expect(blank).toEqual([])
  })
})

describe('every catalogue', () => {
  const catalogues = Object.entries(CATALOGUES)

  it('exists for each language the strip offers', () => {
    // The strip must never offer a language the catalogue map has no entry
    // for: the picker would set a language and the screen would render
    // `undefined` in every label.
    expect(Object.keys(CATALOGUES).sort()).toEqual(
      LANGUAGES.map(language => language.code).sort(),
    )
  })

  it.each(catalogues)('%s carries exactly the keys French does', (_, book) => {
    // The compiler already refuses a missing key, since a catalogue is typed
    // `Record<CopyKey, string>`. This catches the other direction -- a key
    // present here and gone from French, which types fine and renders
    // nowhere.
    expect(Object.keys(book).sort()).toEqual(Object.keys(fr).sort())
  })

  it.each(catalogues)('%s has no empty string', (_, book) => {
    const blank = Object.entries(book).filter(
      ([, value]) => value.trim() === '',
    )
    expect(blank).toEqual([])
  })

  it.each(catalogues)('%s keeps every placeholder French has', (_, book) => {
    // A placeholder dropped in translation renders a sentence with a hole in
    // it, and one invented renders a literal `%@` on somebody's screen.
    // Compared as multisets, because a translation may move a placeholder
    // within a sentence -- word order is the translator's business, and the
    // set of holes to fill is not.
    const holes = (value: string) =>
      (value.match(/%(?:\d+\$)?[@ds]/g) ?? []).sort().join(' ')
    for (const [key, french] of Object.entries(fr)) {
      expect(`${key}: ${holes(book[key as keyof typeof fr])}`).toBe(
        `${key}: ${holes(french)}`,
      )
    }
  })
})

describe('choosing a language', () => {
  it('changes what t answers, and says which is chosen', () => {
    try {
      setCatalogue('de')
      expect(currentLanguage()).toBe('de')
      expect(t('promise_action')).toBe('Beginnen')
      setCatalogue('nl')
      expect(t('promise_action')).toBe('Beginnen')
      setCatalogue('it')
      expect(t('promise_action')).toBe('Cominciare')
    } finally {
      // Module state. Left switched, it would leak into every test after
      // this one -- which is the failure mode a module variable buys.
      setCatalogue('fr')
    }
  })

  it('starts on French', () => {
    expect(currentLanguage()).toBe('fr')
  })

  it('names each language in itself, in its own catalogue', () => {
    try {
      for (const language of LANGUAGES) {
        setCatalogue(language.code)
        expect(t('language_endonym')).toBe(language.endonym)
      }
    } finally {
      setCatalogue('fr')
    }
  })
})
