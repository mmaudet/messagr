import type { ReadImage } from './imageEvent'

/**
 * The conversation, as this application holds it.
 *
 * ADR-0005 settles that the timeline is built on the application's own state
 * rather than on the transport library's room model, and this module is that
 * state. The cost the ADR names is paid here: ordering, deduplication and
 * gaps are the application's to handle, because the library's model is filled
 * by a sync loop this application stops.
 */
export interface TimelineEntry {
  readonly eventId: string
  /**
   * Who the event says sent it, and nothing more.
   *
   * **Unauthenticated.** Decrypting an event proves which key wrote it and
   * nothing about who holds that key. The name carries the warning so that
   * no screen can render it as a fact without having read this.
   */
  readonly claimedSender: string
  /** The homeserver's timestamp. The only ordering anyone here agrees on. */
  readonly sentAt: number
  /** `null` when this device could not read it. */
  readonly body: string | null
  /** Why it could not be read, when it could not. */
  readonly reason?: string
  /**
   * The photograph this entry carries, when it carries one.
   *
   * Present alongside `body` rather than instead of it: an `m.image` has a
   * fallback name in `body`, and a client that cannot render the picture
   * shows that. This application can render it, so the screen shows the
   * picture and ignores the name -- but the name stays in the entry, because
   * dropping it would leave nothing to say when the download fails.
   */
  readonly image?: ReadImage
  /**
   * Whether this event was removed for everyone.
   *
   * §13.7 asks that such a removal leave a line -- *« un retrait est un fait
   * social, pas une disparition silencieuse »* -- so it is an entry rather
   * than a gap. `body` is `null` and `reason` is absent, which is what tells
   * a screen apart from a message whose key never arrived: nothing went
   * wrong here, there is simply nothing left to read.
   *
   * A withdrawn reaction is not one of these. See `redactionKind.ts` for how
   * the two are told apart, given that a redaction leaves both looking
   * identical on the wire.
   */
  readonly removed?: boolean
}

/**
 * Folds newly seen events into the conversation.
 *
 * # Deduplication, because a sync is a window and not a delta
 *
 * The same event comes back on every later sync. Keying by event id is what
 * keeps a conversation from growing copies of itself.
 *
 * # Ordering, including the tie
 *
 * Two messages can carry the same millisecond, and a comparison returning
 * zero there would leave their order to whatever the sort happened to do --
 * a conversation that reshuffles itself between launches. The event id breaks
 * the tie: arbitrary, but the same arbitrary every time.
 *
 * # A late key beats an early gap, and never the other way round
 *
 * A room key can arrive after the message it unlocks, so the same event may
 * be offered again with a body where it had none. That version wins. The
 * reverse is refused: a later round can offer an event before its key is
 * loaded again, and losing a message that had already been read would be
 * worse than never having read it.
 *
 * What cannot be read is kept rather than hidden. A gap a person can see is
 * one they can act on; a gap silently closed is one they will never know cost
 * them something.
 */
export function mergeTimeline(
  existing: readonly TimelineEntry[],
  incoming: readonly TimelineEntry[],
): TimelineEntry[] {
  const byId = new Map(existing.map(entry => [entry.eventId, entry]))

  for (const entry of incoming) {
    const held = byId.get(entry.eventId)
    if (held === undefined || (held.body === null && entry.body !== null)) {
      byId.set(entry.eventId, entry)
    }
  }

  return [...byId.values()].sort(
    (a, b) =>
      a.sentAt - b.sentAt ||
      (a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0),
  )
}
