import { describe, expect, it, vi } from 'vitest'

import {
  installMissingCapabilities,
  type CapabilityProvider,
} from './polyfills'

const provider = (
  name: string,
  install: (scope: never) => void,
): CapabilityProvider => ({ name, install }) as CapabilityProvider

describe('installMissingCapabilities', () => {
  it('installs a provider whose capability is absent', () => {
    const scope: Record<string, unknown> = {}
    const report = installMissingCapabilities(scope, [
      provider('textDecoder', s => {
        ;(s as Record<string, unknown>).TextDecoder = class {
          decode(): string {
            return 'é'
          }
        }
      }),
    ])
    expect(report.installed).toEqual(['textDecoder'])
    expect(scope.TextDecoder).toBeDefined()
  })

  it('leaves a working capability alone', () => {
    const install = vi.fn()
    const scope = {
      TextDecoder: class {
        decode(): string {
          return 'é'
        }
      },
    }
    const report = installMissingCapabilities(scope, [
      provider('textDecoder', install),
    ])
    expect(install).not.toHaveBeenCalled()
    expect(report.installed).toEqual([])
    expect(report.alreadyPresent).toContain('textDecoder')
  })

  it('reports a capability that is still missing after its provider ran', () => {
    const scope: Record<string, unknown> = {}
    const report = installMissingCapabilities(scope, [
      provider('textDecoder', () => {}),
    ])
    expect(report.installed).toEqual([])
    expect(report.stillMissing).toContain('textDecoder')
  })

  it('reports a provider that throws as still missing rather than propagating', () => {
    const scope: Record<string, unknown> = {}
    expect(() =>
      installMissingCapabilities(scope, [
        provider('textDecoder', () => {
          throw new Error('no module')
        }),
      ]),
    ).not.toThrow()
    expect(installMissingCapabilities(scope, []).stillMissing).toContain(
      'textDecoder',
    )
  })

  it('reports capabilities no provider covers as still missing', () => {
    const report = installMissingCapabilities({}, [])
    expect(report.stillMissing).toContain('getRandomValues')
    expect(report.stillMissing).toContain('url')
    expect(report.installed).toEqual([])
  })
})
