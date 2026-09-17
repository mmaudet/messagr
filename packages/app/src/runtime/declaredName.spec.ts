import { describe, expect, it } from 'vitest'

import {
  cleanDeclaredName,
  declaredNameInFragment,
  DECLARED_LIMIT,
  linkWithDeclaredName,
  utf8LengthOf,
} from './declaredName'
import { qrOf } from './qr'

/** The version of the symbol a link draws, from the side it comes out. */
function versionOf(text: string): number | null {
  const symbol = qrOf(text)
  return symbol === null ? null : (symbol.side - 21) / 4 + 1
}

/** A link of the shape the service mints: a 32-character token on messagr.eu. */
const LINK = `https://messagr.eu/i/${'A'.repeat(32)}`

/**
 * The characters this is about, built rather than typed.
 *
 * A test file carrying an invisible right-to-left override IS the thing being
 * guarded against: the one reading the test would be reordered too, and
 * nothing on the reviewer's screen would say so. `HALF` cannot be written as a
 * literal at all -- it is one unit of a surrogate pair, which is not a
 * character.
 */
const OVERRIDE = String.fromCharCode(0x202e)
const ISOLATE = String.fromCharCode(0x2066)
const NUL = String.fromCharCode(0x0000)
const HALF = String.fromCharCode(0xd83d)

describe('the name an inviter gives themselves', () => {
  it('keeps what somebody typed, collapsed and trimmed', () => {
    expect(cleanDeclaredName('  Nadia  ')).toBe('Nadia')
    expect(cleanDeclaredName('Nadia\ndu\tclub')).toBe('Nadia du club')
  })

  it('makes a space of a newline rather than welding two words', () => {
    // A tab and a newline ARE control characters, so a first version of
    // `cleanDeclaredName` stripped them before collapsing whitespace and
    // turned « Nadia du club » into « Nadiaduclub ». Silently, in the one
    // place this product prints somebody's name.
    expect(cleanDeclaredName('Nadia\ndu club')).toBe('Nadia du club')
  })

  it('is nothing at all when it is only space', () => {
    // Not declaring a name and declaring an empty one are the same state.
    expect(cleanDeclaredName('')).toBeNull()
    expect(cleanDeclaredName('   \n ')).toBeNull()
  })

  it('takes the control characters out, bidi overrides included', () => {
    // THE NAME IS WRITTEN BY WHOEVER ISSUED THE LINK and drawn on the screen
    // where somebody decides. A right-to-left override reorders everything
    // after it, so a name could be written to read as the sentence around
    // it. Stripped rather than refused: the name is still theirs.
    expect(cleanDeclaredName(`Na${OVERRIDE}dia`)).toBe('Nadia')
    expect(cleanDeclaredName(`Na${NUL}dia`)).toBe('Nadia')
    expect(cleanDeclaredName(`Na${ISOLATE}dia`)).toBe('Nadia')
  })

  it('keeps an emoji whole, joiner and variation selector included', () => {
    // The joiner and the variation selector are format characters too, and
    // taking them out would break the emoji rather than protect anybody.
    expect(cleanDeclaredName('👩‍💻')).toBe('👩‍💻')
    expect(cleanDeclaredName('❤️')).toBe('❤️')
  })

  it('cuts at the byte budget, never inside a character', () => {
    const long = 'é'.repeat(DECLARED_LIMIT)
    const cut = cleanDeclaredName(long) as string
    expect(utf8LengthOf(cut)).toBeLessThanOrEqual(DECLARED_LIMIT)
    // Two bytes each, so half of them fit, and no half-character survives.
    expect(cut).toBe('é'.repeat(DECLARED_LIMIT / 2))
    expect([...cut].every(point => point === 'é')).toBe(true)
  })

  it('measures the budget in what travels rather than in characters', () => {
    expect(utf8LengthOf('Nadia')).toBe(5)
    expect(utf8LengthOf('é')).toBe(2)
    expect(utf8LengthOf('漢')).toBe(3)
    expect(utf8LengthOf('😀')).toBe(4)
  })

  it('drops a lone surrogate, which no encoder can carry', () => {
    // A truncated paste leaves one half of a pair behind, and
    // `encodeURIComponent` throws on it -- which would be an invitation
    // nobody could issue.
    expect(cleanDeclaredName(`Na${HALF}dia`)).toBe('Nadia')
    expect(() =>
      linkWithDeclaredName(LINK, cleanDeclaredName(`a${HALF}`)),
    ).not.toThrow()
  })
})

describe('the fragment the name travels in', () => {
  it('writes the name after the token, in the fragment', () => {
    expect(linkWithDeclaredName(LINK, 'Nadia')).toBe(`${LINK}#n=Nadia`)
  })

  it('leaves the link exactly as it was when no name was given', () => {
    expect(linkWithDeclaredName(LINK, null)).toBe(LINK)
  })

  it('reads back what it wrote, in every script', () => {
    for (const name of ['Nadia', 'Nadia du club', 'Надя', '漢字', '👩‍💻']) {
      const read = declaredNameInFragment(
        linkWithDeclaredName(LINK, name).split('#')[1] as string,
      )
      expect(read).toBe(name)
    }
  })

  it('ignores every other key in the fragment', () => {
    // The same tolerance `invitationLink.ts` already has for a link that came
    // back from a messenger with something attached to it.
    expect(declaredNameInFragment('utm=x&n=Nadia&z=1')).toBe('Nadia')
    expect(declaredNameInFragment('utm=x')).toBeNull()
    expect(declaredNameInFragment('')).toBeNull()
  })

  it('answers nothing for a fragment that arrived mangled', () => {
    // A percent sign with nothing usable after it makes
    // `decodeURIComponent` throw, and an invitation must not fail to open
    // because a name did not survive the trip.
    expect(declaredNameInFragment('n=%E0%A4%A')).toBeNull()
    expect(declaredNameInFragment('n=%')).toBeNull()
  })

  it('holds the budget on the way in as well as on the way out', () => {
    // The cap is enforced on READ, not only on write: the fragment is
    // written by somebody else's application, and nothing obliges it to have
    // used this one.
    const over = `n=${'a'.repeat(DECLARED_LIMIT * 4)}`
    const read = declaredNameInFragment(over) as string
    expect(utf8LengthOf(read)).toBe(DECLARED_LIMIT)
  })

  it('carries no name a query string could put there', () => {
    // A QUERY REACHES THE SERVER AND ITS LOG; A FRAGMENT NEVER DOES. Reading
    // `?n=` would be an invitation to write the name where nginx sees it,
    // which is the one thing this whole path exists to avoid.
    expect(declaredNameInFragment('n=Nadia')).toBe('Nadia')
    expect(linkWithDeclaredName(LINK, 'Nadia')).not.toContain('?')
  })
})

describe('what the name costs the QR code', () => {
  it('leaves the symbol inside versions 1 to 20, at the worst name allowed', () => {
    // §13.25: level M, byte mode, versions 1 to 20. The budget above is what
    // holds this, and it is measured here rather than reasoned about.
    const worst = cleanDeclaredName('漢'.repeat(DECLARED_LIMIT)) as string
    const version = versionOf(linkWithDeclaredName(LINK, worst))
    expect(version).not.toBeNull()
    expect(version as number).toBeLessThanOrEqual(20)
    expect(version as number).toBeLessThanOrEqual(10)
  })

  it('costs nothing at all for a short name, and two versions for a long one', () => {
    // What a link costs today, and what it costs with a name on it. The
    // symbol gets denser, which is the whole price, and for the case
    // everybody is in it does not get denser at all.
    expect(versionOf(LINK)).toBe(4)
    expect(versionOf(linkWithDeclaredName(LINK, 'Nadia'))).toBe(4)
    expect(
      versionOf(linkWithDeclaredName(LINK, 'Nadia du club de voile')),
    ).toBe(6)
  })
})
