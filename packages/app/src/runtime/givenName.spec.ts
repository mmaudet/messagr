import { describe, expect, it } from 'vitest'

import {
  displayNameFor,
  isNamed,
  normaliseGivenName,
  NAME_LIMIT,
} from './givenName'

describe('normaliseGivenName', () => {
  it('keeps what somebody typed', () => {
    expect(normaliseGivenName('Nadia')).toBe('Nadia')
  })

  it('trims the edges', () => {
    expect(normaliseGivenName('  Nadia  ')).toBe('Nadia')
  })

  it('collapses whitespace, because a row has one line', () => {
    expect(normaliseGivenName('Nadia\n  Belkacem')).toBe('Nadia Belkacem')
  })

  it('is null for nothing, and for whitespace, which are the same state', () => {
    expect(normaliseGivenName('')).toBeNull()
    expect(normaliseGivenName('   \n ')).toBeNull()
  })

  it('shortens rather than refusing, because somebody pasted too much', () => {
    const pasted = 'a'.repeat(NAME_LIMIT + 50)
    expect(normaliseGivenName(pasted)).toHaveLength(NAME_LIMIT)
  })
})

describe('displayNameFor', () => {
  it('shows the name when there is one', () => {
    expect(displayNameFor('@rabr642vve6v:messagr.eu', 'Nadia')).toBe('Nadia')
  })

  it('falls back to the localpart, without the homeserver everyone shares', () => {
    expect(displayNameFor('@rabr642vve6v:messagr.eu', undefined)).toBe(
      '@rabr642vve6v',
    )
  })

  it('treats an empty name as no name', () => {
    expect(displayNameFor('@rabr642vve6v:messagr.eu', '')).toBe('@rabr642vve6v')
  })

  it('is empty when there is nobody to name', () => {
    expect(displayNameFor(null, undefined)).toBe('')
  })

  it('shows a name even for a participant this device cannot identify', () => {
    expect(displayNameFor(null, 'Nadia')).toBe('Nadia')
  })
})

describe('isNamed', () => {
  it('separates a name somebody chose from an identifier', () => {
    expect(isNamed('Nadia')).toBe(true)
    expect(isNamed(undefined)).toBe(false)
    expect(isNamed('')).toBe(false)
  })
})
