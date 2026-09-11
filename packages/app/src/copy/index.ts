import { formatCopy } from './format'
import { fr, type CopyKey } from './fr'
import { en } from './en'
import { de } from './de'
import { es } from './es'
import { it } from './it'
import { nl } from './nl'
import { uz } from './uz'
import type { Language } from './languages'

/**
 * Where every user-facing string in this application comes from.
 *
 * A screen holds no text. That is the whole property, and it is what made the
 * other languages a catalogue each rather than a rewrite.
 *
 * # Every catalogue is complete, and the compiler is what says so
 *
 * `Record<CopyKey, string>` has no optional keys, so a catalogue missing one
 * fails to build. There is no fallback to French and there must not be: a
 * fallback is how a half-translated language ships and nobody notices, because
 * the screen reads fine to whoever wrote it.
 *
 * # Chosen at runtime, and this is a module variable
 *
 * `t` is a plain function, called from every screen. Making the language a
 * React context would have meant touching every call site to read it. Instead
 * the catalogue is a variable here, and the screen that changes it also holds
 * the state whose change re-renders the tree -- so `setCatalogue` is always
 * followed by a state change, and never relied on to cause one.
 */
const CATALOGUES: Readonly<
  Record<Language, Readonly<Record<CopyKey, string>>>
> = { fr, en, de, es, it, nl, uz }

let chosen: Language = 'fr'
let catalogue: Readonly<Record<CopyKey, string>> = fr

/** Switches the catalogue. See the note above: this does not re-render. */
export function setCatalogue(language: Language): void {
  chosen = language
  catalogue = CATALOGUES[language]
}

/** Which language is being spoken. */
export function currentLanguage(): Language {
  return chosen
}

/**
 * `t` takes a key the compiler knows, so a typo is a build failure rather
 * than a blank space on a screen somebody ships.
 */
export function t(key: CopyKey, ...args: readonly (string | number)[]): string {
  return formatCopy(catalogue[key], args)
}

export { CATALOGUES }
export type { CopyKey }
