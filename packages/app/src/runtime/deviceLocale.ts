import { NativeModules, Platform } from 'react-native'

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
 */
export function deviceLocale(): string {
  try {
    if (Platform.OS === 'ios') {
      const settings = NativeModules.SettingsManager?.settings as
        { AppleLocale?: string; AppleLanguages?: string[] } | undefined
      return settings?.AppleLocale ?? settings?.AppleLanguages?.[0] ?? ''
    }
    const locale = NativeModules.I18nManager?.localeIdentifier as
      string | undefined
    return locale ?? ''
  } catch {
    // A platform that answers differently than expected is not a reason to
    // fail a launch. An empty string means "no idea", which is exactly what
    // `languageOf` turns into `null`.
    return ''
  }
}
