import { describe, expect, it } from 'vitest'

import { fr } from './fr'
import { t } from './index'

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

  it('has no empty string, which would render as a missing label', () => {
    const blank = Object.entries(fr).filter(([, value]) => value.trim() === '')
    expect(blank).toEqual([])
  })
})
