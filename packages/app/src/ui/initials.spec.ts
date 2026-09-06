import { describe, expect, it } from 'vitest'

import { initialsOf } from './initials'

describe('initialsOf', () => {
  it('takes the first letter of the first two words', () => {
    // The mockup's own examples: taking the first two letters would have
    // given FA and CL instead.
    expect(initialsOf('Famille Maudet')).toBe('FM')
    expect(initialsOf('Classe 4e B, parents')).toBe('C4')
  })

  it('reads a comma or an ampersand as a separator', () => {
    expect(initialsOf('Léa, Théo & moi')).toBe('LT')
  })

  it('is one letter for one word', () => {
    expect(initialsOf('Maria')).toBe('M')
  })

  it('drops the sigil of an identifier, which every one of them shares', () => {
    expect(initialsOf('@rabr642vve6v')).toBe('R')
    expect(initialsOf('!slnCxnQXRvhK')).toBe('S')
  })

  it('upper-cases what it found', () => {
    expect(initialsOf('nadia belkacem')).toBe('NB')
  })

  it('keeps an accent, because a French list is full of them', () => {
    expect(initialsOf('Élise Ferrand')).toBe('ÉF')
  })

  it('is empty for a name that is only punctuation, rather than showing it', () => {
    expect(initialsOf('   ')).toBe('')
    expect(initialsOf('@')).toBe('')
  })

  it('takes a whole grapheme rather than half of one', () => {
    // A first letter cut with `[0]` would take half a surrogate pair and
    // render as a replacement character.
    expect(initialsOf('🙂 Théo')).toBe('🙂T')
  })
})
