import { LANGUAGES, languageOf, type Language } from '../copy/languages'
import type { SecretStore } from './sessionStore'

/**
 * Which language this device speaks, and how it is remembered.
 *
 * # Where it is kept, and why there
 *
 * The keystore, for the reason `promiseSeen.ts` and `syncCursor.ts` both
 * give: `SecretStore` is the only durable per-device store available before
 * the notebook opens, and the language has to be known before anything else
 * is — it is what the first screen is written in.
 *
 * A language is not a secret. It is stored beside things that are because
 * there is nowhere else that early.
 *
 * # What an unreadable store answers, and why it is the device's own
 *
 * The device's language, when this application speaks it; French otherwise.
 * Not French unconditionally: a phone set to Dutch, whose keystore refuses,
 * would meet a French screen for no reason a person could act on. The device
 * already knows what its owner reads, and using that is a better guess than
 * a constant — and it is a guess the strip can overrule in one gesture.
 */

export async function readChosenLanguage(
  store: SecretStore,
  deviceLocale: string,
): Promise<Language> {
  try {
    const held = await store.read()
    const known = held === null ? null : asLanguage(held)
    if (known !== null) return known
  } catch {
    // Falls through to the device's own, below.
  }
  return languageOf(deviceLocale) ?? 'fr'
}

/**
 * `false` when the choice could not be kept, the way every other write here
 * reports. Not a throw: failing to remember a language is a screen in the
 * right language now and the wrong one next launch, which is not a reason to
 * stop somebody choosing one.
 */
export async function rememberLanguage(
  store: SecretStore,
  language: Language,
): Promise<boolean> {
  try {
    await store.write(language)
    return true
  } catch {
    return false
  }
}

/** A stored value, checked rather than trusted: it is a file on a device. */
function asLanguage(held: string): Language | null {
  return LANGUAGES.some(language => language.code === held)
    ? (held as Language)
    : null
}
