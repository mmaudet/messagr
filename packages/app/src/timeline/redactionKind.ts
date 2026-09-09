/**
 * What a redaction says it removed.
 *
 * # WHY THE REDACTION HAS TO SAY IT
 *
 * §13.7 asks that erasing a message for everyone leave a line in the
 * conversation -- *« un retrait est un fait social, pas une disparition
 * silencieuse »* -- while a withdrawn reaction must leave nothing at all.
 *
 * Nothing in the event distinguishes them. A redaction strips the content
 * and keeps the shell, type and all; and in this product a reaction is
 * encrypted exactly like a message (ADR-0011), so both arrive as an
 * `m.room.encrypted` with nothing in it. `buildTimeline.ts` marked this spot
 * before there was anything to put in it:
 *
 * > *"The day a message can be deleted, this is where that would branch: a
 * > deleted message may well deserve a line saying so, where a withdrawn
 * > reaction deserves silence."*
 *
 * The one place that still knows is the redaction itself, which is not
 * encrypted and is not redacted in turn. So it carries the answer, and the
 * specification hands it to every device: `unsigned.redacted_because` is the
 * whole redaction event, so both sides read this, on a telephone that was
 * there and on one that arrives afterwards.
 *
 * # WHAT IT TELLS THE HOMESERVER
 *
 * That a message was removed rather than a reaction. A strict subset of what
 * it already sees: it knows a redaction happened, when, by whom and against
 * which event, and it can see whether the target was ever reacted to. ADR-0009
 * refuses to put content in a push; this is not content, it is the shape of a
 * gesture the server already watched.
 *
 * The alternative was to keep the answer on the device that made the
 * redaction. It fails on the case that matters: the *other* person's
 * telephone, which did not make it and has no way to ask.
 */

/** Namespaced, because it is ours and not the specification's. */
export const KIND_KEY = 'eu.messagr.kind'

export type RedactedKind = 'message' | 'reaction'

const KINDS = new Set<string>(['message', 'reaction'])

/** The body of the redaction to send. */
export function redactionBody(kind: RedactedKind): Record<string, string> {
  return { [KIND_KEY]: kind }
}

/**
 * What the redaction of this event said it removed.
 *
 * `null` when the event was not redacted, when the redaction carries no kind
 * -- another client, or a Messagr from before this key -- or when the kind is
 * not one this version knows.
 */
export function kindOfRedaction(event: unknown): RedactedKind | null {
  const unsigned = (event as { unsigned?: unknown }).unsigned
  if (typeof unsigned !== 'object' || unsigned === null) return null
  const because = (unsigned as { redacted_because?: unknown }).redacted_because
  if (typeof because !== 'object' || because === null) return null
  const content = (because as { content?: unknown }).content
  if (typeof content !== 'object' || content === null) return null
  const kind = (content as Record<string, unknown>)[KIND_KEY]
  return typeof kind === 'string' && KINDS.has(kind)
    ? (kind as RedactedKind)
    : null
}

/**
 * Whether the conversation should say that this event was removed.
 *
 * Only a message marked as one. An unmarked redaction stays silent, which is
 * both the honest migration -- every redaction this application made before
 * this key existed was a reaction being taken back -- and the safe direction:
 * a missing line is what yesterday already did, while a spurious one is the
 * phantom message reported from a Pixel and fixed on 8 September.
 */
export function leavesALine(event: unknown): boolean {
  return kindOfRedaction(event) === 'message'
}
