import { fr, type CopyKey } from './fr'
import { formatCopy } from './format'

/**
 * Where every user-facing string in this application comes from.
 *
 * A screen holds no text. That is the whole property, and it is what makes
 * the other four languages -- already translated, already sitting in the
 * previous product -- droppable later without touching a screen.
 *
 * # Only French is here
 *
 * Not because five languages are hard, but because shipping five was never
 * the point of this. The point is that the fifth can arrive without a
 * rewrite. Selecting a language will mean choosing a catalogue here, and
 * nothing else will have to know.
 */
const catalogue: Readonly<Record<CopyKey, string>> = fr

/**
 * `t` takes a key the compiler knows, so a typo is a build failure rather
 * than a blank space on a screen somebody ships.
 */
export function t(key: CopyKey, ...args: readonly (string | number)[]): string {
  return formatCopy(catalogue[key], args)
}

export type { CopyKey }
