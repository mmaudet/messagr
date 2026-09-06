/* eslint-disable no-bitwise */
/**
 * A QR symbol for an invitation link.
 *
 * Byte mode, error correction level M, versions 1 to 20 -- which covers an
 * invitation link with room to spare and stops well short of the versions
 * whose modules are too fine for a phone screen to draw honestly.
 *
 * # Where this came from, and why it is here rather than depended on
 *
 * This is a port of the encoder the website's `/i/` page already carries.
 * That page cannot reach a library: its content security policy forbids an
 * external script, so somebody wrote one, and its comments record the two
 * defects that cost the most to find -- the order of the format bits, and the
 * dark module. Both are preserved below, because a reader who breaks either
 * will break the symbol in a way nothing else reports: it simply will not
 * scan.
 *
 * Bringing it here rather than adding a package makes one encoder out of two
 * once the site comes into the repository, which is what the page's own note
 * asks for: *« sinon les deux symboles cessent d'être le même symbole »*.
 *
 * # It is verified rather than trusted
 *
 * The website's copy has never been decoded by a test -- it is checked by
 * looking at it, which catches a symbol that is obviously wrong and passes
 * one that is subtly wrong. Here `qr.spec.ts` decodes what this produces and
 * compares it against what went in, which is the only check that means the
 * thing a person points a camera at can be read.
 *
 * # Level M is a constant, not a preference
 *
 * The page encodes at M. A symbol read at one level and written at another is
 * not the same symbol, so this is the one value here that must not be tuned
 * without changing the page with it.
 */

/** Total codewords per version. */
const TOTAL_WORDS: readonly number[] = [
  26, 44, 70, 100, 134, 172, 196, 242, 292, 346, 404, 466, 532, 581, 655, 733,
  815, 901, 991, 1085,
]

/**
 * Per version, at level M: correction words per block, then each group's
 * block count and data words per block.
 */
const BLOCKS_M: readonly (readonly number[])[] = [
  [10, 1, 16, 0, 0],
  [16, 1, 28, 0, 0],
  [26, 1, 44, 0, 0],
  [18, 2, 32, 0, 0],
  [24, 2, 43, 0, 0],
  [16, 4, 27, 0, 0],
  [18, 4, 31, 0, 0],
  [22, 2, 38, 2, 39],
  [22, 3, 36, 2, 37],
  [26, 4, 43, 1, 44],
  [30, 1, 50, 4, 51],
  [22, 6, 36, 2, 37],
  [22, 8, 37, 1, 38],
  [24, 4, 40, 5, 41],
  [24, 5, 41, 5, 42],
  [28, 7, 45, 3, 46],
  [28, 10, 46, 1, 47],
  [26, 9, 43, 4, 44],
  [26, 3, 44, 11, 45],
  [26, 3, 41, 13, 42],
]

/** Alignment pattern centres, per version. */
const ALIGN: readonly (readonly number[])[] = [
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
  [6, 30, 54],
  [6, 32, 58],
  [6, 34, 62],
  [6, 26, 46, 66],
  [6, 26, 48, 70],
  [6, 26, 50, 74],
  [6, 30, 54, 78],
  [6, 30, 56, 82],
  [6, 30, 58, 86],
  [6, 34, 62, 90],
]

/** The Galois field GF(256) the correction words are computed in. */
const EXP = new Uint8Array(512)
const LOG = new Uint8Array(256)
{
  let x = 1
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x
    LOG[x] = i
    x <<= 1
    if (x & 0x100) x ^= 0x11d
  }
  for (let j = 255; j < 512; j += 1) EXP[j] = EXP[j - 255] ?? 0
}

function mul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0
  return EXP[(LOG[a] ?? 0) + (LOG[b] ?? 0)] ?? 0
}

function generatorPolynomial(degree: number): number[] {
  let g = [1]
  for (let i = 0; i < degree; i += 1) {
    const next = new Array<number>(g.length + 1).fill(0)
    for (let j = 0; j < g.length; j += 1) {
      next[j] = (next[j] ?? 0) ^ (g[j] ?? 0)
      next[j + 1] = (next[j + 1] ?? 0) ^ mul(g[j] ?? 0, EXP[i] ?? 0)
    }
    g = next
  }
  return g
}

function correctionWords(data: readonly number[], count: number): number[] {
  const g = generatorPolynomial(count)
  const rest = new Array<number>(count).fill(0)
  for (let i = 0; i < data.length; i += 1) {
    const factor = (data[i] ?? 0) ^ (rest[0] ?? 0)
    rest.shift()
    rest.push(0)
    if (factor !== 0) {
      for (let j = 0; j < count; j += 1) {
        rest[j] = (rest[j] ?? 0) ^ mul(g[j + 1] ?? 0, factor)
      }
    }
  }
  return rest
}

/**
 * The text as bytes.
 *
 * `TextEncoder` rather than the page's `unescape(encodeURIComponent(...))`:
 * the polyfill is already loaded for the crypto path, and `unescape` is
 * deprecated. Same bytes, and `qr.spec.ts` pins that on an accented string.
 */
function utf8Of(text: string): number[] {
  return Array.from(new TextEncoder().encode(text))
}

/** The smallest version the bytes fit in, or null when nothing does. */
function versionFor(byteCount: number): number | null {
  for (let v = 1; v <= 20; v += 1) {
    const p = BLOCKS_M[v - 1]
    if (p === undefined) continue
    const capacity = (p[1] ?? 0) * (p[2] ?? 0) + (p[3] ?? 0) * (p[4] ?? 0)
    // Four bits of mode, then eight or sixteen of count, then the data.
    const header = 4 + (v <= 9 ? 8 : 16)
    if (byteCount * 8 + header <= capacity * 8) return v
  }
  return null
}

function codewords(bytes: readonly number[], version: number): number[] {
  const p = BLOCKS_M[version - 1] ?? []
  const capacity = (p[1] ?? 0) * (p[2] ?? 0) + (p[3] ?? 0) * (p[4] ?? 0)
  const bits: number[] = []
  const push = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i -= 1) bits.push((value >> i) & 1)
  }
  push(0x4, 4) // byte mode
  push(bytes.length, version <= 9 ? 8 : 16)
  for (const byte of bytes) push(byte, 8)
  // Terminator, at most four bits, then round up to a whole byte.
  push(0, Math.min(4, capacity * 8 - bits.length))
  while (bits.length % 8 !== 0) bits.push(0)

  const words: number[] = []
  for (let b = 0; b < bits.length; b += 8) {
    let v = 0
    for (let k = 0; k < 8; k += 1) v = (v << 1) | (bits[b + k] ?? 0)
    words.push(v)
  }
  // Alternating padding, as the specification requires.
  const padding = [0xec, 0x11]
  for (let r = 0; words.length < capacity; r += 1) {
    words.push(padding[r % 2] ?? 0)
  }
  return words
}

function interleave(words: readonly number[], version: number): number[] {
  const p = BLOCKS_M[version - 1] ?? []
  const count = p[0] ?? 0
  const blocks: number[][] = []
  const corrections: number[][] = []
  const groups = [
    [p[1] ?? 0, p[2] ?? 0],
    [p[3] ?? 0, p[4] ?? 0],
  ]
  let at = 0
  for (const group of groups) {
    for (let b = 0; b < (group[0] ?? 0); b += 1) {
      const block = words.slice(at, at + (group[1] ?? 0))
      at += group[1] ?? 0
      blocks.push([...block])
      corrections.push(correctionWords(block, count))
    }
  }
  const out: number[] = []
  const longest = Math.max(p[2] ?? 0, p[4] ?? 0)
  for (let i = 0; i < longest; i += 1) {
    for (const block of blocks) if (i < block.length) out.push(block[i] ?? 0)
  }
  for (let i = 0; i < count; i += 1) {
    for (const one of corrections) out.push(one[i] ?? 0)
  }
  return out
}

interface Grid {
  readonly m: number[][]
  readonly held: boolean[][]
}

function emptyGrid(side: number): Grid {
  const m: number[][] = []
  const held: boolean[][] = []
  for (let i = 0; i < side; i += 1) {
    m.push(new Array<number>(side).fill(0))
    held.push(new Array<boolean>(side).fill(false))
  }
  return { m, held }
}

function layPatterns(grid: Grid, version: number): void {
  const side = grid.m.length
  const finder = (row: number, column: number) => {
    for (let r = -1; r <= 7; r += 1) {
      for (let c = -1; c <= 7; c += 1) {
        const y = row + r
        const x = column + c
        if (y < 0 || y >= side || x < 0 || x >= side) continue
        const dark =
          (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
          (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
          (r >= 2 && r <= 4 && c >= 2 && c <= 4)
        ;(grid.m[y] ?? [])[x] = dark ? 1 : 0
        ;(grid.held[y] ?? [])[x] = true
      }
    }
  }
  finder(0, 0)
  finder(0, side - 7)
  finder(side - 7, 0)

  // Timing patterns.
  for (let i = 8; i < side - 8; i += 1) {
    const bit = i % 2 === 0 ? 1 : 0
    ;(grid.m[6] ?? [])[i] = bit
    ;(grid.held[6] ?? [])[i] = true
    ;(grid.m[i] ?? [])[6] = bit
    ;(grid.held[i] ?? [])[6] = true
  }

  // Alignment patterns, except where one would cover a finder.
  const centres = ALIGN[version - 1] ?? []
  for (const ly of centres) {
    for (const lx of centres) {
      if (
        (ly <= 8 && lx <= 8) ||
        (ly <= 8 && lx >= side - 9) ||
        (ly >= side - 9 && lx <= 8)
      ) {
        continue
      }
      for (let r = -2; r <= 2; r += 1) {
        for (let c = -2; c <= 2; c += 1) {
          const dark = Math.max(Math.abs(r), Math.abs(c)) !== 1
          ;(grid.m[ly + r] ?? [])[lx + c] = dark ? 1 : 0
          ;(grid.held[ly + r] ?? [])[lx + c] = true
        }
      }
    }
  }

  // The dark module, and the format areas held back for `layFormat`.
  ;(grid.m[side - 8] ?? [])[8] = 1
  ;(grid.held[side - 8] ?? [])[8] = true
  for (let f = 0; f <= 8; f += 1) {
    if (f !== 6) {
      ;(grid.held[8] ?? [])[f] = true
      ;(grid.held[f] ?? [])[8] = true
    }
  }
  for (let f = 0; f < 8; f += 1) {
    ;(grid.held[8] ?? [])[side - 1 - f] = true
    ;(grid.held[side - 1 - f] ?? [])[8] = true
  }

  // Version information, from version 7 up. BCH(18,6), generator 0x1F25,
  // checked against the published values for versions 7, 8, 9, 10 and 12.
  if (version >= 7) {
    let rest = version
    for (let k = 0; k < 12; k += 1) rest = (rest << 1) ^ ((rest >> 11) * 0x1f25)
    const info = (version << 12) | rest
    for (let p = 0; p < 18; p += 1) {
      const bit = (info >> p) & 1
      const y = Math.floor(p / 3)
      const x = side - 11 + (p % 3)
      ;(grid.m[y] ?? [])[x] = bit
      ;(grid.held[y] ?? [])[x] = true
      ;(grid.m[x] ?? [])[y] = bit
      ;(grid.held[x] ?? [])[y] = true
    }
  }
}

function layData(grid: Grid, stream: readonly number[]): void {
  const side = grid.m.length
  let index = 0
  let upward = true
  for (let column = side - 1; column > 0; column -= 2) {
    if (column === 6) column = 5
    for (let step = 0; step < side; step += 1) {
      const row = upward ? side - 1 - step : step
      for (let d = 0; d < 2; d += 1) {
        const x = column - d
        if ((grid.held[row] ?? [])[x] === true) continue
        let bit = 0
        if (index < stream.length * 8) {
          bit = ((stream[index >> 3] ?? 0) >> (7 - (index & 7))) & 1
        }
        ;(grid.m[row] ?? [])[x] = bit
        index += 1
      }
    }
    upward = !upward
  }
}

function masked(number: number, row: number, column: number): boolean {
  switch (number) {
    case 0:
      return (row + column) % 2 === 0
    case 1:
      return row % 2 === 0
    case 2:
      return column % 3 === 0
    case 3:
      return (row + column) % 3 === 0
    case 4:
      return (Math.floor(row / 2) + Math.floor(column / 3)) % 2 === 0
    case 5:
      return ((row * column) % 2) + ((row * column) % 3) === 0
    case 6:
      return (((row * column) % 2) + ((row * column) % 3)) % 2 === 0
    default:
      return (((row + column) % 2) + ((row * column) % 3)) % 2 === 0
  }
}

function layFormat(grid: Grid, maskNumber: number): void {
  const side = grid.m.length
  // Level M is 00 in the two leading bits. BCH(15,5), polynomial 0x537, then
  // masked with 0x5412 so an all-light symbol does not read as a valid
  // format. Checked against the eight published values for level M.
  const data = (0 << 3) | maskNumber
  let rest = data
  for (let k = 0; k < 10; k += 1) rest = (rest << 1) ^ ((rest >> 9) * 0x537)
  const info = ((data << 10) | rest) ^ 0x5412
  for (let p = 0; p < 15; p += 1) {
    // MOST SIGNIFICANT BIT FIRST. The placement runs from bit 14 at (8,0)
    // down to bit 0 at (0,8); writing `info >> p` produced the exact symbol
    // to within fifteen modules, and those fifteen are the ones that tell a
    // reader which mask to lift -- so the whole symbol stayed unreadable.
    const bit = (info >> (14 - p)) & 1
    if (p < 6) (grid.m[8] ?? [])[p] = bit
    else if (p < 8) (grid.m[8] ?? [])[p + 1] = bit
    else if (p === 8) (grid.m[7] ?? [])[8] = bit
    else (grid.m[14 - p] ?? [])[8] = bit
    // SEVEN ROWS, THEN EIGHT COLUMNS -- not eight then seven. The eighth row
    // is (side-8, 8), the DARK MODULE, which is 1 whatever happens. Writing a
    // format bit over it gave a symbol nothing flagged, except that it did
    // not read.
    if (p < 7) (grid.m[side - 1 - p] ?? [])[8] = bit
    else (grid.m[8] ?? [])[side - 15 + p] = bit
  }
}

/** The specification's four penalty rules, which pick the mask. */
function penalty(m: readonly (readonly number[])[]): number {
  const side = m.length
  let total = 0

  // Rule 1: runs of five or more of the same shade.
  for (let i = 0; i < side; i += 1) {
    for (let way = 0; way < 2; way += 1) {
      let run = 1
      let previous = -1
      for (let j = 0; j < side; j += 1) {
        const v = way === 0 ? ((m[i] ?? [])[j] ?? 0) : ((m[j] ?? [])[i] ?? 0)
        if (v === previous) run += 1
        else {
          if (run >= 5) total += run - 2
          run = 1
          previous = v
        }
      }
      if (run >= 5) total += run - 2
    }
  }

  // Rule 2: two-by-two blocks.
  for (let i = 0; i < side - 1; i += 1) {
    for (let j = 0; j < side - 1; j += 1) {
      const a = (m[i] ?? [])[j]
      if (
        a === (m[i] ?? [])[j + 1] &&
        a === (m[i + 1] ?? [])[j] &&
        a === (m[i + 1] ?? [])[j + 1]
      ) {
        total += 3
      }
    }
  }

  // Rule 3: the 1:1:3:1:1 pattern with light either side.
  const shapes = [
    [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0],
    [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1],
  ]
  for (let i = 0; i < side; i += 1) {
    for (let j = 0; j <= side - 11; j += 1) {
      for (const shape of shapes) {
        let across = true
        let down = true
        for (let k = 0; k < 11; k += 1) {
          if ((m[i] ?? [])[j + k] !== shape[k]) across = false
          if ((m[j + k] ?? [])[i] !== shape[k]) down = false
        }
        if (across) total += 40
        if (down) total += 40
      }
    }
  }

  // Rule 4: the imbalance between dark and light.
  let dark = 0
  for (let i = 0; i < side; i += 1) {
    for (let j = 0; j < side; j += 1) dark += (m[i] ?? [])[j] ?? 0
  }
  const percent = (dark * 100) / (side * side)
  total += Math.floor(Math.abs(percent - 50) / 5) * 10

  return total
}

/** A symbol: its side in modules, and the modules themselves. */
export interface QrSymbol {
  readonly side: number
  /** Row-major, 1 for dark. */
  readonly modules: readonly (readonly number[])[]
}

/**
 * The symbol for a string, or null when it does not fit any version this
 * encoder carries.
 *
 * Null rather than a throw: an invitation screen that cannot draw a QR still
 * has a link to show, and `Invite.tsx` says why reading it aloud is the path
 * that must keep working.
 */
export function qrOf(text: string): QrSymbol | null {
  const bytes = utf8Of(text)
  const version = versionFor(bytes.length)
  if (version === null) return null

  const stream = interleave(codewords(bytes, version), version)
  const side = 21 + 4 * (version - 1)

  let best: number[][] | null = null
  let bestScore = Infinity
  for (let number = 0; number < 8; number += 1) {
    const grid = emptyGrid(side)
    layPatterns(grid, version)
    layData(grid, stream)
    for (let i = 0; i < side; i += 1) {
      for (let j = 0; j < side; j += 1) {
        if ((grid.held[i] ?? [])[j] !== true && masked(number, i, j)) {
          ;(grid.m[i] ?? [])[j] = ((grid.m[i] ?? [])[j] ?? 0) ^ 1
        }
      }
    }
    layFormat(grid, number)
    const score = penalty(grid.m)
    if (score < bestScore) {
      bestScore = score
      best = grid.m
    }
  }
  if (best === null) return null
  return { side, modules: best }
}

/**
 * The quiet zone, in modules.
 *
 * Four on every side, and it is part of the symbol rather than padding around
 * it: a decoder needs the light border to find the edges, and a symbol drawn
 * flush against anything is one that will not scan for a reason nobody
 * looking at it can see.
 */
export const QUIET = 4

/**
 * The symbol as one SVG path, in module units, quiet zone included.
 *
 * # Runs, not a rectangle each
 *
 * A version-4 symbol is over a thousand modules and half of them are dark.
 * One node each is a thousand across the bridge for a picture that is mostly
 * horizontal bars; merging a row's consecutive dark modules into one segment
 * leaves a fraction of that and the same image.
 *
 * # Here rather than in the component
 *
 * It is arithmetic, and arithmetic in a component is arithmetic nothing runs
 * except a device. `qr.spec.ts` paints this path back into pixels and decodes
 * it, so the drawing is checked by the same camera the encoder is -- which is
 * the only way an off-by-one in a run is caught before somebody points a
 * phone at it.
 */
export function pathOf(symbol: QrSymbol): string {
  const parts: string[] = []
  for (let row = 0; row < symbol.side; row += 1) {
    let from: number | null = null
    for (let column = 0; column <= symbol.side; column += 1) {
      const dark = symbol.modules[row]?.[column] === 1
      if (dark && from === null) from = column
      if (!dark && from !== null) {
        const run = column - from
        parts.push(`M${from + QUIET} ${row + QUIET}h${run}v1h${-run}z`)
        from = null
      }
    }
  }
  return parts.join('')
}

/** Exported for the spec, which checks the table against the block sizes. */
export const CAPACITY = { TOTAL_WORDS, BLOCKS_M }
