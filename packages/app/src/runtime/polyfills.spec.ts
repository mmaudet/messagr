import { describe, expect, it, vi } from 'vitest'

import { ensureRuntimeGapsClosed, type GapProvider } from './polyfills'

const workingDecoder = class {
  decode(): string {
    return 'é'
  }
}

function decoderProvider(install: GapProvider['install']): GapProvider {
  return { name: 'textDecoder', install }
}

describe('ensureRuntimeGapsClosed', () => {
  it('installs a provider whose gap is open', () => {
    const globals: Record<string, unknown> = {}
    const report = ensureRuntimeGapsClosed(globals, [
      decoderProvider(g => {
        ;(g as Record<string, unknown>).TextDecoder = workingDecoder
        return { ok: true }
      }),
    ])
    expect(report.installed).toEqual(['textDecoder'])
    expect(globals.TextDecoder).toBeDefined()
  })

  it('leaves a working facility alone', () => {
    const install = vi.fn()
    const report = ensureRuntimeGapsClosed({ TextDecoder: workingDecoder }, [
      decoderProvider(install),
    ])
    expect(install).not.toHaveBeenCalled()
    expect(report.installed).toEqual([])
    expect(report.alreadyPresent).toContain('textDecoder')
  })

  it('carries the reason a provider gave for failing', () => {
    const report = ensureRuntimeGapsClosed({}, [
      decoderProvider(() => ({ ok: false, reason: 'no module' })),
    ])
    expect(report.stillMissing).toContainEqual({
      name: 'textDecoder',
      reason: 'no module',
    })
  })

  it('reports a provider that ran without closing its gap', () => {
    const report = ensureRuntimeGapsClosed({}, [
      decoderProvider(() => ({ ok: true })),
    ])
    expect(report.installed).toEqual([])
    expect(report.stillMissing.map(g => g.name)).toContain('textDecoder')
  })

  it('says plainly when no provider covers a gap', () => {
    const report = ensureRuntimeGapsClosed({}, [])
    expect(report.stillMissing).toContainEqual({
      name: 'url',
      reason: 'no provider closes this gap',
    })
  })
})
