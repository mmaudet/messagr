import { readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'

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

  it('never explains encryption where a backup is accepted or refused', () => {
    // ADR-0013, and it is a product rule rather than a wording preference:
    // « Rien de la promesse ne change. "Chiffrée de bout en bout, sans
    // réglage" parle du chiffrement, qui reste automatique et non
    // configurable. La durabilité devient un choix ; le chiffrement, non. »
    //
    // The safest way to keep a screen from implying otherwise is for it not
    // to talk about encryption at all in the place where somebody is
    // deciding something. The offer says what the server can and cannot do
    // -- read it, prove nothing was replaced -- which is the substance,
    // without putting the word next to a pair of buttons.
    const talking = Object.entries(fr).filter(
      ([key, value]) => key.startsWith('backup_') && /chiffr/i.test(value),
    )
    expect(talking).toEqual([])
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

describe('no screen writes a label of its own', () => {
  // WHAT `every catalogue` CANNOT SEE.
  //
  // The tests above prove the catalogues agree with each other. They
  // cannot prove a screen *asks* them: a French sentence written straight
  // into a component renders French in every language and every
  // assertion here stays green. That is the realistic mistake -- nobody
  // removes a translation, somebody adds a screen in a hurry.
  //
  // Found by an audit rather than by a failure, on 11 September 2026, and
  // written down because an audit run once rots. The audit found nothing,
  // which is what makes this a guard rather than a fix.
  //
  // # WHAT IT DOES NOT CHECK, AND WHY THAT IS NOT AN OVERSIGHT
  //
  // Bare text between JSX tags -- `<Text>Bonjour</Text>` -- is the other
  // half of the same mistake and is deliberately not attempted here. A
  // regular expression cannot tell it from a TypeScript generic: the source
  // of `Conversation.tsx` contains `readonly read?: ReadonlySet<string>`,
  // and the text between that `>` and the next `<` reads exactly like a
  // sentence to any pattern simple enough to live in a test. A first
  // version flagged it, and the honest options were a parser or a
  // hand-maintained exclusion list -- the second being the kind of test
  // that gets argued with rather than fixed.
  //
  // So this guards the half that can be guarded exactly. The audit that
  // covered the other half is in the commit that added this.

  const screens = readdirSync(join(__dirname, '..', 'ui'))
    .filter(name => name.endsWith('.tsx'))
    .map(name => join(__dirname, '..', 'ui', name))
    .concat(join(__dirname, '..', '..', 'App.tsx'))

  /**
   * The product's own name, which is the same word in every language.
   *
   * The only allowance, and it stays one word: a list that grew would be
   * this test being negotiated with.
   */
  const UNTRANSLATED = new Set(['Messagr'])

  it.each(screens.map(path => [basename(path), path]))(
    '%s puts every label through the catalogue',
    (_name, path) => {
      const source = readFileSync(path, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')

      const written = [
        ...source.matchAll(
          /(?:label|accessibilityLabel|accessibilityHint|placeholder|title)=\{?'([^']{4,})'/g,
        ),
      ]
        .map(([, text]) => text)
        .filter(text => !UNTRANSLATED.has(text))

      expect(written).toEqual([])
    },
  )
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
