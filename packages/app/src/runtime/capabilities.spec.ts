import { describe, expect, it } from 'vitest'

import { computeCapabilityReport } from './capabilities'

describe('computeCapabilityReport', () => {
  it('reports everything missing in an empty scope', () => {
    expect(computeCapabilityReport({}).missing).toEqual([
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
    // wrong rather than a capability absent.
    expect(computeCapabilityReport().missing).toEqual([])
  })

  it('rejects a random source that leaves the buffer untouched', () => {
    const report = computeCapabilityReport({
      crypto: { getRandomValues: (a: Uint8Array) => a },
    })
    expect(report.getRandomValues).toBe(false)
  })

  it('rejects an encoder that treats one character as one byte', () => {
    class Latin1Encoder {
      encode(s: string): Uint8Array {
        return Uint8Array.from([...s].map(c => c.charCodeAt(0)))
      }
    }
    expect(
      computeCapabilityReport({ TextEncoder: Latin1Encoder }).textEncoder,
    ).toBe(false)
  })

  it('rejects a URL that parses but exposes no query parameters', () => {
    class ShimUrl {
      readonly searchParams = undefined
      constructor(readonly href: string) {}
    }
    expect(computeCapabilityReport({ URL: ShimUrl }).url).toBe(false)
  })

  it('treats a capability that throws as missing rather than propagating', () => {
    class Exploding {
      constructor() {
        throw new Error('boom')
      }
    }
    expect(() =>
      computeCapabilityReport({ TextEncoder: Exploding, URL: Exploding }),
    ).not.toThrow()
    expect(
      computeCapabilityReport({ TextEncoder: Exploding }).textEncoder,
    ).toBe(false)
  })

  it('rejects a withResolvers that returns an incomplete triple', () => {
    const report = computeCapabilityReport({
      Promise: {
        withResolvers: () => ({ promise: Promise.resolve(), resolve: 1 }),
      },
    })
    expect(report.promiseWithResolvers).toBe(false)
  })
})
