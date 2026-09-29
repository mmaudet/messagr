import type { Language } from '../copy/languages'

/**
 * Where the conditions are published, for a reader of `language`.
 *
 * #466: the terms exist in French, which is authoritative, and in English at
 * their own address. French opens the French page; every other language the
 * application speaks opens the English one, which says which text is
 * authoritative. The rule lives here and nowhere else: the first screen's
 * link opens this address, and the legal screen names it.
 */
export function termsFor(language: Language): string {
  return language === 'fr'
    ? 'https://messagr.eu/conditions-generales/'
    : 'https://messagr.eu/conditions-generales/en/'
}

/** The same address, as a person reads it rather than as a browser opens it. */
export function termsShown(language: Language): string {
  return termsFor(language)
    .replace(/^https:\/\//, '')
    .replace(/\/$/, '')
}
