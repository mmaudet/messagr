import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { deviceLocale } from './deviceLocale'

/**
 * Reading the device's own language, on a runtime shaped like the one that
 * ships.
 *
 * # THE FAKE MODULES ANSWER LIKE TURBO MODULES, AND THAT IS THE POINT
 *
 * #353. Both branches of `deviceLocale` used to read a constant as a
 * property -- `NativeModules.SettingsManager.settings`,
 * `NativeModules.I18nManager.localeIdentifier` -- which is what the legacy
 * bridge flattened onto the module object. The New Architecture does not
 * flatten anything: `BridgelessNativeModuleProxy` hands `NativeModules[name]`
 * the turbo module itself, whose constants are only behind `getConstants()`.
 * So both reads answered `undefined`, `deviceLocale` answered `''`, and every
 * device on earth opened in French.
 *
 * A fake that flattens its constants the way the legacy bridge did would have
 * been green against that code and would have proved nothing. These fakes
 * carry `getConstants()` and nothing else, which is exactly what a device
 * hands over, and `NativeModules` here is the bridgeless proxy -- it answers
 * the same object, constants and all still behind the method. A regression
 * back to a property read fails here rather than on somebody's telephone.
 *
 * The legacy shape is covered too, further down: this repository does not get
 * to bet on one architecture.
 */

const platform = vi.hoisted(() => ({ OS: 'ios' as string }))

const registry = vi.hoisted(() => ({ modules: new Map<string, unknown>() }))

vi.mock('react-native', () => ({
  Platform: platform,
  // What `TurboModuleRegistry.get` is: the turbo module, or nothing. It is
  // the one lookup that answers under either architecture, which is why the
  // module under test asks it rather than `NativeModules`.
  TurboModuleRegistry: {
    get: (name: string) => registry.modules.get(name) ?? null,
  },
  // The bridgeless proxy: the same turbo module, never its constants
  // flattened. Kept in the fake so that reinstating the old access is red.
  NativeModules: new Proxy(
    {},
    { get: (_target, name) => registry.modules.get(String(name)) },
  ),
}))

/** A turbo module: its constants behind `getConstants()`, and nowhere else. */
function turboModule(constants: object): object {
  return { getConstants: () => constants }
}

/** What the log wrote, whatever level it wrote it at. */
function linesWrittenBy(gesture: () => void): string[] {
  const lines: string[] = []
  for (const method of ['log', 'warn', 'error'] as const) {
    vi.spyOn(console, method).mockImplementation((...written: unknown[]) => {
      lines.push(String(written[0]))
    })
  }
  gesture()
  return lines
}

beforeEach(() => {
  platform.OS = 'ios'
  registry.modules.clear()
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('an iPhone', () => {
  it('reads the locale out of the settings a turbo module answers', () => {
    registry.modules.set(
      'SettingsManager',
      turboModule({ settings: { AppleLocale: 'en_GB' } }),
    )
    expect(deviceLocale()).toBe('en_GB')
  })

  it('falls back to the first preferred language when there is no locale', () => {
    registry.modules.set(
      'SettingsManager',
      turboModule({ settings: { AppleLanguages: ['nl-NL', 'en-GB'] } }),
    )
    expect(deviceLocale()).toBe('nl-NL')
  })

  it('takes the first preferred language over an empty locale', () => {
    registry.modules.set(
      'SettingsManager',
      turboModule({ settings: { AppleLocale: '', AppleLanguages: ['de-DE'] } }),
    )
    expect(deviceLocale()).toBe('de-DE')
  })

  it('still reads a module that flattened its constants, as the legacy bridge did', () => {
    registry.modules.set('SettingsManager', {
      settings: { AppleLocale: 'it_IT' },
    })
    expect(deviceLocale()).toBe('it_IT')
  })
})

describe('an Android telephone', () => {
  beforeEach(() => {
    platform.OS = 'android'
  })

  it('reads the locale identifier a turbo module answers', () => {
    registry.modules.set(
      'I18nManager',
      turboModule({
        isRTL: false,
        doLeftAndRightSwapInRTL: true,
        localeIdentifier: 'en_US',
      }),
    )
    expect(deviceLocale()).toBe('en_US')
  })

  it('still reads a module that flattened its constants, as the legacy bridge did', () => {
    registry.modules.set('I18nManager', {
      isRTL: false,
      localeIdentifier: 'uz_UZ',
    })
    expect(deviceLocale()).toBe('uz_UZ')
  })
})

describe('when it cannot be read', () => {
  it('says so rather than answer an empty string in silence', () => {
    expect(
      linesWrittenBy(() => {
        expect(deviceLocale()).toBe('')
      }),
    ).toEqual([
      'MESSAGR_DEVICE_LOCALE_UNREAD {"platform":"ios","unread":"noModule"}',
    ])
  })

  it('tells a module that answered nothing usable from one that never came', () => {
    registry.modules.set('SettingsManager', turboModule({ settings: {} }))
    expect(
      linesWrittenBy(() => {
        expect(deviceLocale()).toBe('')
      }),
    ).toEqual([
      'MESSAGR_DEVICE_LOCALE_UNREAD {"platform":"ios","unread":"noLocale"}',
    ])
  })

  it('names constants that are not an object, which is the shape moving again', () => {
    registry.modules.set('SettingsManager', { getConstants: () => undefined })
    expect(
      linesWrittenBy(() => {
        expect(deviceLocale()).toBe('')
      }),
    ).toEqual([
      'MESSAGR_DEVICE_LOCALE_UNREAD {"platform":"ios","unread":"noConstants"}',
    ])
  })

  it('does not fail a launch when the platform throws, and says that too', () => {
    registry.modules.set('I18nManager', {
      getConstants: () => {
        throw new Error('no bridge')
      },
    })
    platform.OS = 'android'
    let locale = 'unset'
    const lines = linesWrittenBy(() => {
      expect(() => {
        locale = deviceLocale()
      }).not.toThrow()
    })
    expect(locale).toBe('')
    expect(lines).toEqual([
      'MESSAGR_DEVICE_LOCALE_UNREAD {"platform":"android","unread":"threw"}',
    ])
  })

  it('writes nothing at all when the device answered', () => {
    registry.modules.set(
      'SettingsManager',
      turboModule({ settings: { AppleLocale: 'fr_FR' } }),
    )
    expect(linesWrittenBy(() => deviceLocale())).toEqual([])
  })

  it('is still written by a store build, which is where it went unseen', () => {
    // The trace, and only the trace, leaves an installed build. A line the
    // trace does not carry is a line nobody outside a cable ever reads --
    // which is how every iPhone came to open in French for months.
    vi.stubGlobal('__DEV__', false)
    vi.stubEnv('MESSAGR_SEND_PROBE', '')
    vi.stubEnv('MESSAGR_WHOLE_LOG', '')
    expect(
      linesWrittenBy(() => {
        expect(deviceLocale()).toBe('')
      }),
    ).toEqual([
      'MESSAGR_DEVICE_LOCALE_UNREAD {"platform":"ios","unread":"noModule"}',
    ])
  })
})
