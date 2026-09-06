import jsQR from 'jsqr'
import { describe, expect, it } from 'vitest'

import { parseInvitationLink } from './invitationLink'
import { CAPACITY, pathOf, QUIET, qrOf, type QrSymbol } from './qr'

/**
 * The encoder, checked by decoding what it produces.
 *
 * The website's copy of this has never been decoded by a test: it is checked
 * by looking at it, which catches a symbol that is obviously wrong and passes
 * one that is subtly wrong -- and a QR that is subtly wrong is a QR that
 * simply does not scan, with nothing on screen to say so. Two of its comments
 * are about exactly that.
 *
 * So every test here reads the symbol back the way a camera would, which is
 * the only check that means anything about a thing people point a phone at.
 */

/**
 * The symbol as a camera would see it: a white field, a quiet zone, and
 * modules blown up enough that a decoder written for photographs has
 * something to work with.
 */
function asSeen(symbol: QrSymbol, scale = 4, quiet = 4) {
  const side = (symbol.side + quiet * 2) * scale
  const pixels = new Uint8ClampedArray(side * side * 4).fill(255)
  for (let row = 0; row < symbol.side; row += 1) {
    for (let column = 0; column < symbol.side; column += 1) {
      if (symbol.modules[row]?.[column] !== 1) continue
      for (let y = 0; y < scale; y += 1) {
        for (let x = 0; x < scale; x += 1) {
          const at =
            (((row + quiet) * scale + y) * side +
              (column + quiet) * scale +
              x) *
            4
          pixels[at] = 0
          pixels[at + 1] = 0
          pixels[at + 2] = 0
        }
      }
    }
  }
  return { pixels, side }
}

/** What a camera would read off it, or null when nothing would. */
function scanned(text: string): string | null {
  const symbol = qrOf(text)
  if (symbol === null) return null
  const seen = asSeen(symbol)
  return jsQR(seen.pixels, seen.side, seen.side)?.data ?? null
}

describe('qrOf', () => {
  it('produces a symbol a camera can read', () => {
    expect(scanned('hello')).toBe('hello')
  })

  it('round-trips an invitation link, which is the only string that matters', () => {
    const link = 'https://messagr.eu/i/Ux7pQm2vKd91aBcDeFgHiJkL'
    expect(scanned(link)).toBe(link)
  })

  it('round-trips the application scheme as well as the web one', () => {
    // Both are what `parseInvitationLink` accepts, so both are what a
    // scanner may be handed.
    const link = 'messagr://messagr.eu/i/Ux7pQm2vKd91aBcDeFgHiJkL'
    expect(scanned(link)).toBe(link)
  })

  it('what it encodes is what parseInvitationLink accepts', () => {
    // The criterion, joined up rather than assumed: encode a link, read it
    // back off the symbol, and hand *that* to the parser -- so a defect
    // anywhere along the way fails here rather than on somebody's phone.
    const link = 'https://messagr.eu/i/Ux7pQm2vKd91aBcDeFgHiJkL'
    const read = scanned(link)
    expect(read).not.toBeNull()
    expect(parseInvitationLink(read ?? '')).toEqual(parseInvitationLink(link))
  })

  it('carries accented text through unharmed', () => {
    // The port swapped `unescape(encodeURIComponent(...))` for `TextEncoder`.
    // Same bytes, and this is what says so.
    expect(scanned('Où êtes-vous ? Château')).toBe('Où êtes-vous ? Château')
  })

  it('grows to a longer version when a link needs one', () => {
    const short = qrOf('https://messagr.eu/i/short')
    const long = qrOf(`https://messagr.eu/i/${'z'.repeat(300)}`)
    expect(short?.side).toBeLessThan(long?.side ?? 0)
    // And the long one still reads.
    expect(scanned(`https://messagr.eu/i/${'z'.repeat(300)}`)).toBe(
      `https://messagr.eu/i/${'z'.repeat(300)}`,
    )
  })

  it('answers null rather than throwing when nothing fits', () => {
    // A screen that cannot draw a QR still has a link to show.
    expect(qrOf('z'.repeat(5000))).toBeNull()
  })

  it('is square, and every row is the side it claims', () => {
    const symbol = qrOf('https://messagr.eu/i/Ux7pQm2vKd91aBcDeFgHiJkL')
    expect(symbol).not.toBeNull()
    expect(symbol?.modules).toHaveLength(symbol?.side ?? 0)
    for (const row of symbol?.modules ?? []) {
      expect(row).toHaveLength(symbol?.side ?? 0)
    }
  })

  it('draws the three finders, which is what a camera looks for first', () => {
    const symbol = qrOf('hello')
    const side = symbol?.side ?? 0
    // A finder's centre is a 3x3 dark square. Checking the three corners
    // catches a symbol laid out transposed or mirrored, which decodes as
    // nothing and looks fine.
    for (const [row, column] of [
      [2, 2],
      [2, side - 5],
      [side - 5, 2],
    ]) {
      expect(symbol?.modules[row ?? 0]?.[column ?? 0]).toBe(1)
    }
  })

  it('sets the dark module, which nothing else would notice', () => {
    // Its own comment: overwriting it gave a symbol nothing flagged, except
    // that it did not read.
    const symbol = qrOf('hello')
    expect(symbol?.modules[(symbol?.side ?? 0) - 8]?.[8]).toBe(1)
  })
})

describe('the capacity tables', () => {
  it('agree with each other, version by version', () => {
    // A block table that disagrees with the total is how a symbol ends up
    // one codeword short -- which the decoder reports as unreadable and
    // nothing else reports at all.
    CAPACITY.BLOCKS_M.forEach((p, index) => {
      const data = (p[1] ?? 0) * (p[2] ?? 0) + (p[3] ?? 0) * (p[4] ?? 0)
      const correction = (p[0] ?? 0) * ((p[1] ?? 0) + (p[3] ?? 0))
      expect(data + correction).toBe(CAPACITY.TOTAL_WORDS[index])
    })
  })

  it('covers twenty versions on both sides', () => {
    expect(CAPACITY.BLOCKS_M).toHaveLength(20)
    expect(CAPACITY.TOTAL_WORDS).toHaveLength(20)
  })
})

describe('pathOf', () => {
  /**
   * The path, painted back into pixels the way an SVG renderer would.
   *
   * Every segment this emits is `M<x> <y>h<w>v1h-<w>z` -- a run of dark
   * modules one module tall -- so parsing it back is exact rather than a
   * general SVG interpreter. What it proves is the part a component would
   * otherwise own alone: that the runs land where the modules are.
   */
  function painted(path: string, span: number, scale = 4) {
    const side = span * scale
    const pixels = new Uint8ClampedArray(side * side * 4).fill(255)
    const segments = path.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)
    for (const [, x, y, w] of segments) {
      for (let dy = 0; dy < scale; dy += 1) {
        for (let dx = 0; dx < Number(w) * scale; dx += 1) {
          const at =
            ((Number(y) * scale + dy) * side + Number(x) * scale + dx) * 4
          pixels[at] = 0
          pixels[at + 1] = 0
          pixels[at + 2] = 0
        }
      }
    }
    return { pixels, side }
  }

  it('paints back into a symbol a camera can read', () => {
    // The whole chain, end to end: encode, build the path a screen is
    // actually given, paint that path, decode it. An off-by-one in a run
    // fails here rather than on somebody's phone.
    const link = 'https://messagr.eu/i/Ux7pQm2vKd91aBcDeFgHiJkL'
    const symbol = qrOf(link)
    expect(symbol).not.toBeNull()
    const span = (symbol?.side ?? 0) + QUIET * 2
    const seen = painted(pathOf(symbol as QrSymbol), span)
    expect(jsQR(seen.pixels, seen.side, seen.side)?.data).toBe(link)
  })

  it('merges a row into runs rather than a segment per module', () => {
    // The reason the path exists at all. Measured on this link: 583 dark
    // modules become 298 segments -- a shade under half, which is what a
    // symbol's entropy allows, since runs of two are common and runs of five
    // are penalised by the specification itself. The bound is loose enough
    // to survive a different link and tight enough to fail if the merging
    // ever stops happening.
    const symbol = qrOf('https://messagr.eu/i/Ux7pQm2vKd91aBcDeFgHiJkL')
    const segments = pathOf(symbol as QrSymbol).match(/M/g)?.length ?? 0
    let dark = 0
    for (const row of symbol?.modules ?? []) {
      for (const module of row) dark += module
    }
    expect(segments).toBeLessThan(dark * 0.6)
  })

  it('offsets everything by the quiet zone, which a decoder needs', () => {
    // Nothing may be drawn in the first four modules: that border is how a
    // reader finds the symbol's edge.
    const symbol = qrOf('hello')
    for (const [, x, y] of pathOf(symbol as QrSymbol).matchAll(
      /M(\d+) (\d+)h/g,
    )) {
      expect(Number(x)).toBeGreaterThanOrEqual(QUIET)
      expect(Number(y)).toBeGreaterThanOrEqual(QUIET)
    }
  })
})
