/**
 * Which of the runtime capabilities matrix-js-sdk needs actually work.
 *
 * Behaviour rather than presence. React Native ships a `URL` that is a
 * regular-expression shim rather than an implementation, so `typeof URL ===
 * 'function'` is true while the object it builds is wrong. A probe that only
 * counted names would report that gap closed and let the polyfill layer be
 * written against an assumption instead of a measurement.
 *
 * Every check is exercised against a value whose correct answer is known, and
 * every one is guarded: a capability that throws is a capability that is
 * missing, which is precisely what the caller needs to know.
 */
export interface CapabilityReport {
  readonly getRandomValues: boolean
  readonly promiseWithResolvers: boolean
  readonly textEncoder: boolean
  readonly textDecoder: boolean
  readonly url: boolean
  readonly urlSearchParams: boolean
  /** The names above that failed, in declaration order. */
  readonly missing: readonly string[]
}

type Check = () => boolean

const attempt = (check: Check): boolean => {
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

export function computeCapabilityReport(
  scope: object = globalThis,
): CapabilityReport {
  const g = scope as Candidates

  const checks: Readonly<Record<string, Check>> = {
    // Filling must actually happen. A stub returning the array untouched
    // leaves it all zeroes, which is the one outcome a random source must
    // never produce for sixteen bytes.
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

    // A multi-byte character, so that a single-byte-per-character
    // implementation fails rather than passing on ASCII.
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

  const found = Object.fromEntries(
    Object.entries(checks).map(([name, check]) => [name, attempt(check)]),
  ) as Omit<CapabilityReport, 'missing'>

  const missing = Object.entries(found)
    .filter(([, ok]) => !ok)
    .map(([name]) => name)

  return { ...found, missing }
}
