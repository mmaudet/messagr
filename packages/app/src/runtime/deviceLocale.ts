import { Platform, TurboModuleRegistry } from 'react-native'

import { logEvent } from './log'

/**
 * What language this device is set to.
 *
 * # Why this is hand-rolled rather than a library
 *
 * `react-native-localize` would answer it, and it is one string. React Native
 * already exposes the platform's own settings; taking a native dependency for
 * a locale tag would be a package to keep, to build on two platforms and to
 * explain in the iOS job, for a value the platform hands over already.
 *
 * # It is a fallback and never a decision
 *
 * `chosenLanguage.ts` uses this only when nothing has been chosen. A device
 * set to Dutch meeting a French screen for no reason a person could act on is
 * what it prevents; it does not override anybody's choice, and the strip
 * overrules it in one gesture.
 *
 * # A CONSTANT IS BEHIND A METHOD, AND FOR MONTHS THIS READ IT AS A PROPERTY
 *
 * #353. This module used to ask `NativeModules.SettingsManager.settings` and
 * `NativeModules.I18nManager.localeIdentifier`. Both are constants, and the
 * legacy bridge flattened a module's constants onto the module object, so
 * both reads worked -- under the architecture this application stopped
 * running. `newArchEnabled=true`, and under the New Architecture nothing is
 * flattened: `BridgelessNativeModuleProxy::get` answers the turbo module
 * itself, whose constants are only behind `getConstants()`. Both reads
 * answered `undefined`, this function answered `''`, `languageOf('')`
 * answered `null`, and `chosenLanguage.ts` handed French to an iPhone set to
 * English -- on every device, on both platforms, because the two branches
 * make the same mistake two lines apart.
 *
 * `TurboModuleRegistry.get` rather than `NativeModules` because it is the
 * lookup that answers under either architecture: it asks the turbo module
 * proxy and falls back to `NativeModules` itself. The constants are then read
 * through `getConstants()` where there is one, and off the module where there
 * is not, so a return to the legacy bridge would be read too. This repository
 * does not get to bet on one architecture.
 *
 * # « JE NE SAIS PAS » IS NOT « C'EST DU FRANÇAIS »
 *
 * The failure above was silent by construction. One `catch` answered `''`,
 * `''` means "no idea", and "no idea" reaches `chosenLanguage.ts` as French:
 * nothing to see in a log, nothing red in a suite, and a defect that outlived
 * every screen built on top of it.
 *
 * So an unread is now named and written, and written to the trace, which is
 * the only thing that leaves a store build -- the build where this went
 * unseen. It stays a fallback and not a failure: the launch continues on `''`
 * exactly as before, because a locale nobody could read is still not a reason
 * to refuse somebody their messages.
 */
export function deviceLocale(): string {
  const reading = readTheDevice()
  if (reading.unread !== null) {
    logEvent('warn', 'MESSAGR_DEVICE_LOCALE_UNREAD', {
      platform: Platform.OS,
      unread: reading.unread,
    })
  }
  return reading.locale
}

/**
 * Why the device's language could not be read.
 *
 * Four states rather than one, because they call for different things.
 * `noModule` and `noConstants` say React Native moved the value again and
 * this file has to follow it; `noLocale` says the platform kept the shape and
 * had nothing to put in it; `threw` says the bridge is not there at all.
 * Each is one word, which is what the trace may carry (`log.ts`).
 */
type Unread = 'noModule' | 'noConstants' | 'noLocale' | 'threw'

interface Reading {
  /** The tag the device answered, or `''` when it could not be read. */
  readonly locale: string
  /** Why it could not be read, or `null` when it was. */
  readonly unread: Unread | null
}

function readTheDevice(): Reading {
  try {
    const ios = Platform.OS === 'ios'
    // iOS keeps the tag in `NSUserDefaults`, which `SettingsManager` hands
    // over whole. `I18nManager` would be the tidier question, but
    // `RCTI18nManager` exports `isRTL` and `doLeftAndRightSwapInRTL` and no
    // `localeIdentifier` at all -- that constant is Android's alone
    // (`I18nManagerModule.kt`), which is why the two platforms are asked
    // different modules rather than the same one.
    const module = TurboModuleRegistry.get(
      ios ? 'SettingsManager' : 'I18nManager',
    )
    if (module == null) return unread('noModule')

    const constants = constantsOf(module)
    if (constants === null) return unread('noConstants')

    const tag = ios ? appleLocale(constants) : androidLocale(constants)
    if (tag === null) return unread('noLocale')

    return { locale: tag, unread: null }
  } catch {
    // A platform that answers differently than expected is not a reason to
    // fail a launch. It is a reason to say so, which the caller does.
    return unread('threw')
  }
}

function unread(why: Unread): Reading {
  return { locale: '', unread: why }
}

/**
 * Where a native module keeps its constants, under either architecture.
 *
 * `getConstants()` first: it is the only place the New Architecture puts
 * them, and the legacy bridge defined one too (`NativeModules.js` adds it to
 * every module it builds), so a module that has the method is answered by the
 * method whichever architecture made it. A module without one is a legacy
 * module built some other way, and there the constants are the module.
 *
 * `null` is reserved for a `getConstants` that answers something that is not
 * an object, which is the shape moving again rather than a locale missing.
 */
function constantsOf(module: object): Record<string, unknown> | null {
  const turbo = module as { getConstants?: () => unknown }
  if (typeof turbo.getConstants !== 'function') {
    return module as Record<string, unknown>
  }
  const constants = turbo.getConstants()
  if (typeof constants !== 'object' || constants === null) return null
  return constants as Record<string, unknown>
}

/**
 * The tag an iPhone is set to, out of `NSUserDefaults`.
 *
 * `AppleLocale` is the region format and `AppleLanguages` the ordered list of
 * languages the person reads; the first of that list is what the system draws
 * its own text in, so it is the better answer of the two when they disagree.
 * `AppleLocale` is kept first because it is the one every iOS carries, and an
 * empty one falls through rather than winning, which `??` would have let it
 * do.
 */
function appleLocale(constants: Record<string, unknown>): string | null {
  const settings = constants.settings
  if (typeof settings !== 'object' || settings === null) return null
  const kept = settings as { AppleLocale?: unknown; AppleLanguages?: unknown }
  if (typeof kept.AppleLocale === 'string' && kept.AppleLocale !== '') {
    return kept.AppleLocale
  }
  const [first] = Array.isArray(kept.AppleLanguages) ? kept.AppleLanguages : []
  return typeof first === 'string' && first !== '' ? first : null
}

/** Android's own, `Locale.toString()` of the configuration's first locale. */
function androidLocale(constants: Record<string, unknown>): string | null {
  const locale = constants.localeIdentifier
  return typeof locale === 'string' && locale !== '' ? locale : null
}
