/**
 * Which of the runtime facilities matrix-js-sdk needs actually work.
 *
 * Named for gaps rather than capabilities: in this product a capability is a
 * scoped permission held by a participant, and reusing the word for
 * `TextDecoder` would put two meanings on one term. See CONTEXT.md.
 *
 * Behaviour rather than presence. React Native ships a `URL` that is a
 * regular-expression shim, so `typeof URL === 'function'` is true while the
 * object it builds may be wrong. A probe that only counted names would report
 * a gap closed and let the polyfill layer be written against an assumption
 * instead of a measurement.
 *
 * Every check is exercised against a value whose correct answer is known, and
 * every one is guarded: a facility that throws is a facility that is missing,
 * which is what the caller needs to know.
 */
export type RuntimeGapName =
  | 'getRandomValues'
  | 'promiseWithResolvers'
  | 'textEncoder'
  | 'textDecoder'
  | 'url'
  | 'urlSearchParams'

export interface RuntimeGapReport {
  readonly working: Readonly<Record<RuntimeGapName, boolean>>
  /** The facilities that failed, in declaration order. */
  readonly missing: readonly RuntimeGapName[]
}

type Check = () => boolean

function attempt(check: Check): boolean {
  try {
    return check()
  } catch {
    return false
  }
}

interface Candidates {
  readonly crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array }
  readonly Promise?: { withResolvers?: () => unknown }
  readonly TextEncoder?: new () => { encode: (s: string) => Uint8Array }
  readonly TextDecoder?: new () => { decode: (b: Uint8Array) => string }
  readonly URL?: new (u: string) => {
    searchParams?: { get: (k: string) => unknown }
  }
  readonly URLSearchParams?: new (q: string) => { get: (k: string) => unknown }
}

export function computeRuntimeGapReport(
  globals: object = globalThis,
): RuntimeGapReport {
  const g = globals as Candidates

  const checks: Readonly<Record<RuntimeGapName, Check>> = {
    // Filling must actually happen. A stub returning the array untouched
    // leaves it all zeroes, the one outcome a random source must never
    // produce for sixteen bytes.
    getRandomValues: () => {
      const filled = g.crypto?.getRandomValues?.(new Uint8Array(16))
      return filled != null && filled.some(byte => byte !== 0)
    },

    // The triple must be usable, not merely returned.
    promiseWithResolvers: () => {
      const trio = g.Promise?.withResolvers?.() as
        { promise?: unknown; resolve?: unknown; reject?: unknown } | undefined
      return (
        trio != null &&
        typeof trio.resolve === 'function' &&
        typeof trio.reject === 'function' &&
        trio.promise instanceof Promise
      )
    },

    // A multi-byte character, so that a one-byte-per-character implementation
    // fails rather than passing on ASCII.
    textEncoder: () => {
      const bytes =
        g.TextEncoder != null ? new g.TextEncoder().encode('é') : null
      return (
        bytes != null &&
        bytes.length === 2 &&
        bytes[0] === 0xc3 &&
        bytes[1] === 0xa9
      )
    },

    textDecoder: () => {
      const text =
        g.TextDecoder != null
          ? new g.TextDecoder().decode(Uint8Array.from([0xc3, 0xa9]))
          : null
      return text === 'é'
    },

    // Query parsing is where React Native's shim gives way, so the check asks
    // for a parsed parameter rather than for the object to exist.
    url: () => {
      const parsed =
        g.URL != null ? new g.URL('https://example.org/a/b?x=1&y=2') : null
      return parsed?.searchParams?.get('y') === '2'
    },

    urlSearchParams: () =>
      g.URLSearchParams != null &&
      new g.URLSearchParams('x=1&y=2').get('y') === '2',
  }

  const entries = Object.entries(checks) as [RuntimeGapName, Check][]
  const working = Object.fromEntries(
    entries.map(([name, check]) => [name, attempt(check)]),
  ) as Record<RuntimeGapName, boolean>

  return {
    working,
    missing: entries.map(([name]) => name).filter(name => !working[name]),
  }
}
