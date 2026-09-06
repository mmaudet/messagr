/**
 * Reactions, folded into the messages they point at.
 *
 * ADR-0011: a reaction is an encrypted event like any other, so the
 * server-side aggregation Matrix specifies for annotations is not available
 * and is not missed — ADR-0005 already made the timeline the application's
 * own state, so this is where the aggregation happens.
 *
 * # What arrives, and in what order
 *
 * Nothing. A reaction can be decrypted before the message it points at is,
 * after it, or without it ever being — a device that holds one key and not
 * the other is ordinary. So this folds a flat list in one pass and keeps
 * whatever pointed at nothing: an orphan is not dropped, because the message
 * it belongs to may be one fetch away.
 */

/** A decrypted reaction, before it is attached to anything. */
export interface LooseReaction {
  /** The reaction event's own id, which is what a redaction names. */
  readonly eventId: string
  /** The event it points at. */
  readonly target: string
  /** What was reacted with. One grapheme in practice, not enforced here. */
  readonly key: string
  /** Who the event says sent it. Unauthenticated, like every sender. */
  readonly claimedSender: string
}

/** One key, and who used it. */
export interface ReactionTally {
  readonly key: string
  readonly count: number
  /**
   * Whether this account is among them, and the id of its own reaction.
   *
   * The id is here because removing a reaction is redacting the event that
   * made it, and a screen that offered "remove" without knowing which event
   * to redact would be offering a gesture it cannot perform.
   */
  readonly mine: string | null
}

/**
 * Groups reactions by the message they point at, then by key.
 *
 * Keys keep the order they were first seen in, and counts do not reorder
 * them. A tally that jumped around as people reacted would be a row that
 * moves under a thumb, and the first person to react having the leftmost
 * place is as good a rule as any and the only stable one.
 */
export function tallyReactions(
  reactions: readonly LooseReaction[],
  selfUserId: string,
): ReadonlyMap<string, readonly ReactionTally[]> {
  const byTarget = new Map<string, Map<string, ReactionTally>>()

  for (const reaction of reactions) {
    // An empty key is not a reaction. A homeserver will carry whatever it is
    // given, and a tally with a blank chip in it is worse than one without.
    if (reaction.key === '') continue

    const keys = byTarget.get(reaction.target) ?? new Map()
    byTarget.set(reaction.target, keys)

    const held = keys.get(reaction.key)
    const mine =
      reaction.claimedSender === selfUserId
        ? reaction.eventId
        : (held?.mine ?? null)
    keys.set(reaction.key, {
      key: reaction.key,
      count: (held?.count ?? 0) + 1,
      mine,
    })
  }

  const folded = new Map<string, readonly ReactionTally[]>()
  for (const [target, keys] of byTarget) {
    folded.set(target, [...keys.values()])
  }
  return folded
}

/**
 * Reads a decrypted event's content as a reaction, or `null`.
 *
 * The shape is Matrix's own — `m.relates_to` with `rel_type: m.annotation` —
 * carried inside the ciphertext rather than outside it. Keeping the standard
 * shape costs nothing and means the day this has to be legible to another
 * client, only the boundary moves and not the payload.
 */
export function readReaction(
  eventId: string,
  claimedSender: string,
  content: unknown,
): LooseReaction | null {
  const relates = (content as { 'm.relates_to'?: unknown })?.['m.relates_to']
  if (typeof relates !== 'object' || relates === null) return null

  const {
    rel_type: relType,
    event_id: target,
    key,
  } = relates as Record<string, unknown>
  if (relType !== 'm.annotation') return null
  if (typeof target !== 'string' || target === '') return null
  if (typeof key !== 'string') return null

  return { eventId, target, key, claimedSender }
}
