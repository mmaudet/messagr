/**
 * The initials a list row's avatar carries.
 *
 * Its own module rather than living beside the component: this is the only
 * part of an avatar worth testing, and a pure function reachable from a spec
 * is worth more than one buried in a `.tsx`.
 */

/**
 * Up to two initials, from what the row shows.
 *
 * Words rather than characters: "Famille Maudet" gives FM, "Léa, Théo & moi"
 * gives LT — the mockup's own examples, and taking the first two letters
 * would have given FA and LÉ instead.
 */
export function initialsOf(shown: string): string {
  const words = shown
    .replace(/^[@!]/, '')
    .split(/[\s,&]+/)
    // Anything that is not pure punctuation survives: "&" is already eaten
    // as a separator above, and an emoji somebody put at the front of a name
    // is a grapheme they chose rather than debris.
    .filter(word => word !== '' && !/^[\p{P}\p{Z}]+$/u.test(word))
  const letters = words
    .slice(0, 2)
    .map(word => [...word][0] ?? '')
    .join('')
  return letters.toLocaleUpperCase('fr')
}
