/**
 * The name one participant gives another. `CONTEXT.md`, ADR-0010.
 *
 * Identifiers here are pseudonymous by design, so a list showing
 * `@rabr642vve6v:messagr.eu` is a list nobody can read. The inviter is the one
 * person who knows who they invited — that is already the ground the vouching
 * gesture stands on — so the name they give is the only readable thing
 * available that costs no pseudonymity.
 *
 * A given name is held on the device that gave it and nowhere else. It never
 * reaches the homeserver, never reaches the other participant, and never
 * appears in a push payload. Two devices belonging to the same person can
 * hold different names for the same participant, and that is correct rather
 * than a synchronisation defect: a given name says who somebody is *to you*,
 * on the device where you said it.
 *
 * # Keyed by participant, not by conversation
 *
 * Naming somebody names them everywhere. The alternative — a name per
 * conversation — would let one person appear under two names on one screen,
 * which is precisely the confusion a given name exists to remove.
 *
 * # A port, and why the store is not here
 *
 * ADR-0010 puts these in an encrypted database of the application's own. That
 * is an adapter; this is the interface it satisfies, so everything above it
 * is testable without a database and so the day the store changes, nothing
 * that reads a name has to.
 */

export interface GivenNames {
  /**
   * Every name this device holds, keyed by participant.
   *
   * All of them at once rather than one lookup per row: a list of twenty
   * conversations is one read, and a store that made it twenty would be a
   * store the list had to work around.
   */
  readonly all: () => Promise<ReadonlyMap<string, string>>
  /**
   * `false` when the name could not be kept, so a screen can say so rather
   * than showing a name that will be gone at the next launch.
   */
  readonly set: (participant: string, name: string) => Promise<boolean>
}

/**
 * The longest name kept.
 *
 * Not a validation rule so much as a refusal to store a document: a given
 * name is what one person calls another, and something longer than this is
 * not that. Trimming rather than rejecting, because a person who pasted too
 * much wants their name shortened, not their gesture refused.
 */
export const NAME_LIMIT = 64

/**
 * What to store for what somebody typed, or `null` for nothing worth storing.
 *
 * Whitespace is collapsed rather than preserved: a name is a label on a row,
 * and a label with a line break in it is a row of a different height. `null`
 * for a name that is only whitespace — clearing a name and never setting one
 * are the same state, and giving them two representations would be two states
 * for one fact.
 */
export function normaliseGivenName(typed: string): string | null {
  const collapsed = typed.replace(/\s+/g, ' ').trim()
  return collapsed === '' ? null : collapsed.slice(0, NAME_LIMIT)
}

/**
 * What a row shows for a participant.
 *
 * # Why the fallback is the localpart and not the product's own format
 *
 * `design/tokens.json` describes an identifier as `@prefix#SUFFIX`, and the
 * prototype draws `@balcon#T9WD`. That format describes an identifier this
 * product does not yet mint: accounts here are drawn by the invitation
 * service and their localparts carry no prefix and no suffix. Splitting
 * `@rabr642vve6v` into two halves to look like the format would be inventing
 * structure the identifier does not have, and the invented suffix would be
 * meaningless where the real one is meant to disambiguate.
 *
 * So an unnamed participant shows their localpart, without the homeserver —
 * which every participant on one homeserver shares, and which therefore
 * distinguishes nobody. It is not pretty. It is honest, and it is what the
 * given name exists to replace.
 */
export function displayNameFor(
  participant: string | null,
  given: string | undefined,
): string {
  if (given !== undefined && given !== '') return given
  if (participant === null) return ''
  const localpart = participant.replace(/^@/, '').replace(/:.*$/, '')
  return `@${localpart}`
}

/** Whether a row is showing a name somebody chose, or an identifier. */
export function isNamed(given: string | undefined): boolean {
  return given !== undefined && given !== ''
}
