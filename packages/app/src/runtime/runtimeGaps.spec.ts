import { describe, expect, it } from 'vitest'

import { computeRuntimeGapReport } from './runtimeGaps'

describe('computeRuntimeGapReport', () => {
  it('reports everything missing in an empty scope', () => {
    expect(computeRuntimeGapReport({}).missing).toEqual([
      'getRandomValues',
      'promiseWithResolvers',
      'textEncoder',
      'textDecoder',
      'url',
      'urlSearchParams',
    ])
  })

  it('finds nothing missing in the ambient scope of this test runner', () => {
    // Node supplies all six, so a report claiming otherwise means a check is
    // wrong rather than a facility absent.
    expect(computeRuntimeGapReport().missing).toEqual([])
  })

  it('rejects a random source that leaves the buffer untouched', () => {
    const report = computeRuntimeGapReport({
      crypto: { getRandomValues: (a: Uint8Array) => a },
    })
    expect(report.working.getRandomValues).toBe(false)
  })

  it('rejects an encoder that treats one character as one byte', () => {
    class Latin1Encoder {
      encode(s: string): Uint8Array {
        return Uint8Array.from([...s].map(c => c.charCodeAt(0)))
      }
    }
    expect(
      computeRuntimeGapReport({ TextEncoder: Latin1Encoder }).working
        .textEncoder,
    ).toBe(false)
  })

  it('rejects a URL that parses but exposes no query parameters', () => {
    class ShimUrl {
      readonly searchParams = undefined
      constructor(readonly href: string) {}
    }
    expect(computeRuntimeGapReport({ URL: ShimUrl }).working.url).toBe(false)
  })

  it('treats a facility that throws as missing rather than propagating', () => {
    class Exploding {
      constructor() {
        throw new Error('boom')
      }
    }
    expect(() =>
      computeRuntimeGapReport({ TextEncoder: Exploding }),
    ).not.toThrow()
    expect(
      computeRuntimeGapReport({ TextEncoder: Exploding }).working.textEncoder,
    ).toBe(false)
  })

  it('rejects a withResolvers that returns an incomplete triple', () => {
    const report = computeRuntimeGapReport({
      Promise: {
        withResolvers: () => ({ promise: Promise.resolve(), resolve: 1 }),
      },
    })
    expect(report.working.promiseWithResolvers).toBe(false)
  })
})
