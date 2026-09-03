import { describe, expect, it } from 'vitest'

import { computeNewArchitectureReport } from './newArchitecture'

describe('computeNewArchitectureReport', () => {
  it('finds nothing in an empty scope', () => {
    expect(computeNewArchitectureReport({})).toEqual({
      bridgeless: false,
      turboModules: false,
      fabric: false,
      enabled: false,
    })
  })

  it('reads bridgeless only from the exact value true', () => {
    expect(
      computeNewArchitectureReport({ RN$Bridgeless: true }).bridgeless,
    ).toBe(true)
    expect(computeNewArchitectureReport({ RN$Bridgeless: 1 }).bridgeless).toBe(
      false,
    )
    expect(
      computeNewArchitectureReport({ RN$Bridgeless: false }).bridgeless,
    ).toBe(false)
  })

  it('treats bridgeless as sufficient for turbo modules', () => {
    const report = computeNewArchitectureReport({ RN$Bridgeless: true })
    expect(report.turboModules).toBe(true)
  })

  it('accepts a turbo module proxy on its own, as React Native does', () => {
    const report = computeNewArchitectureReport({ __turboModuleProxy: {} })
    expect(report.turboModules).toBe(true)
    expect(report.bridgeless).toBe(false)
  })

  it('rejects a null turbo module proxy', () => {
    expect(
      computeNewArchitectureReport({ __turboModuleProxy: null }).turboModules,
    ).toBe(false)
    expect(
      computeNewArchitectureReport({ __turboModuleProxy: undefined })
        .turboModules,
    ).toBe(false)
  })

  it('reports the Fabric renderer separately from the module system', () => {
    const report = computeNewArchitectureReport({ nativeFabricUIManager: {} })
    expect(report.fabric).toBe(true)
    expect(report.turboModules).toBe(false)
    expect(report.enabled).toBe(false)
  })

  it('is enabled on a full new-architecture runtime', () => {
    expect(
      computeNewArchitectureReport({
        RN$Bridgeless: true,
        __turboModuleProxy: {},
        nativeFabricUIManager: {},
      }),
    ).toEqual({
      bridgeless: true,
      turboModules: true,
      fabric: true,
      enabled: true,
    })
  })

  it('falls back to the ambient global scope', () => {
    expect(() => computeNewArchitectureReport()).not.toThrow()
  })
})
