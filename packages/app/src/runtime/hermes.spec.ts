import { describe, expect, it } from 'vitest'

import { computeHermesReport } from './hermes'

describe('computeHermesReport', () => {
  it('reports absent on a runtime carrying no Hermes marker', () => {
    expect(computeHermesReport({})).toEqual({ present: false, version: null })
  })

  it('reports present when the marker is there', () => {
    expect(computeHermesReport({ HermesInternal: {} })).toEqual({
      present: true,
      version: null,
    })
  })

  it('reads the release version the runtime names for itself', () => {
    const report = computeHermesReport({
      HermesInternal: {
        getRuntimeProperties: () => ({
          'OSS Release Version': 'for RN 0.87.1',
          'Bytecode Version': 96,
        }),
      },
    })
    expect(report).toEqual({ present: true, version: 'for RN 0.87.1' })
  })

  it('stays present with no version when the properties name none', () => {
    const report = computeHermesReport({
      HermesInternal: { getRuntimeProperties: () => ({ GC: 'hades' }) },
    })
    expect(report).toEqual({ present: true, version: null })
  })

  it('survives a runtime whose properties call throws', () => {
    const report = computeHermesReport({
      HermesInternal: {
        getRuntimeProperties: () => {
          throw new Error('not available in this build')
        },
      },
    })
    // The marker is the verdict; the version is corroboration. An engine that
    // refuses to describe itself is still the engine that answered.
    expect(report).toEqual({ present: true, version: null })
  })

  it('does not mistake a null marker for a present engine', () => {
    expect(computeHermesReport({ HermesInternal: null })).toEqual({
      present: false,
      version: null,
    })
  })
})
