/**
 * The languages this application speaks, and how they are offered.
 *
 * # Which languages, and why these
 *
 * French, English, German, Spanish, Italian, Dutch. Not a guess: they are the
 * languages of the flows this product is built for, and they are the six the
 * identity has always named.
 *
 * Uzbek is the seventh and it does not belong to that list. It was asked for,
 * and the reason it could be granted in an afternoon is the property below:
 * a screen holds no text, so a language is a catalogue and not a rewrite.
 * Recording that it arrived by request rather than by the same reasoning as
 * the other six keeps the paragraph above honest — and keeps the next person
 * from reading a strategy into it that was never there.
 *
 * # A flag and an endonym, not a flag alone
 *
 * A flag names a country and not a language — Deutsch is not only Germany's,
 * and English is not only Britain's. Carrying the language's own name for
 * itself beside the flag settles that without giving up the recognisability
 * that made a flag worth having, which matters here: the strip has to be
 * readable by somebody who cannot read the screen behind it.
 *
 * Emoji rather than images: nothing to ship, nothing to get wrong, and they
 * follow the platform's own typeface.
 */

export const LANGUAGES = [
  { code: 'fr', flag: '🇫🇷', endonym: 'Français' },
  { code: 'en', flag: '🇬🇧', endonym: 'English' },
  { code: 'de', flag: '🇩🇪', endonym: 'Deutsch' },
  { code: 'es', flag: '🇪🇸', endonym: 'Español' },
  { code: 'it', flag: '🇮🇹', endonym: 'Italiano' },
  { code: 'nl', flag: '🇳🇱', endonym: 'Nederlands' },
  { code: 'uz', flag: '🇺🇿', endonym: 'Oʻzbekcha' },
] as const

export type Language = (typeof LANGUAGES)[number]['code']

/** What a device is set to, when this application knows that language. */
export function languageOf(locale: string): Language | null {
  // A locale is `fr`, `fr-FR`, `fr_FR` or occasionally something longer. Only
  // the first subtag names the language, and it is compared in lower case
  // because a device may hand back either.
  const first = locale.toLowerCase().split(/[-_]/)[0] ?? ''
  return LANGUAGES.some(language => language.code === first)
    ? (first as Language)
    : null
}
