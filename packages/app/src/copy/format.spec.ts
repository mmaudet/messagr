import { describe, expect, it } from 'vitest'

import { formatCopy } from './format'

describe('formatCopy', () => {
  it('returns a string with no placeholders untouched', () => {
    expect(formatCopy('Aujourd’hui', [])).toBe('Aujourd’hui')
  })

  it('fills an unnumbered placeholder in order', () => {
    expect(formatCopy('Version du noyau : %@', ['1.2'])).toBe(
      'Version du noyau : 1.2',
    )
  })

  it('fills numbered placeholders, which is how the catalogue reorders', () => {
    // `date_separator` is "%1$d %2$@ %3$d" in French and a different order in
    // German. Numbering is what lets a translator move the parts without the
    // caller knowing, so it has to survive the conversion.
    expect(formatCopy('%1$d %2$@ %3$d', [4, 'septembre', 2026])).toBe(
      '4 septembre 2026',
    )
  })

  it('reuses one argument in two places', () => {
    expect(formatCopy('%1$@ et %1$@', ['Léa'])).toBe('Léa et Léa')
  })

  it('leaves a placeholder alone when nothing was given for it', () => {
    // Better a visible gap than a silent "undefined" in a sentence a person
    // reads. A missing argument is a defect, and it should look like one.
    expect(formatCopy('Bonjour %@', [])).toBe('Bonjour %@')
  })

  it('does not treat a percentage in the copy as a placeholder', () => {
    expect(formatCopy('100 % chiffré', [])).toBe('100 % chiffré')
  })
})
