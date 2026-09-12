import { getErrorMessage } from '../runtime/errors'
import { logEvent } from '../runtime/log'
import type { HttpRequester } from '../runtime/pump'
import type { TimelineEntry } from './mergeTimeline'
import { leavesALine } from './redactionKind'
import { readFileEvent } from './fileEvent'
import { readImageEvent } from './imageEvent'
import { readReaction, type LooseReaction } from './reactions'

/**
 * Reading a room's history, and turning it into a conversation.
 *
 * # Why the history is fetched rather than kept
 *
 * ADR-0006: nothing decrypted is written to disk. Reopening the application
 * asks the homeserver for the room again and decrypts it again, with the
 * Megolm sessions the crypto store already holds -- which is itself encrypted
 * with a per-device passphrase in the operating system's keystore.
 *
 * A person sees the same thing either way: the conversation is there when
 * they come back. What differs is what an attacker with the device finds.
 */
export interface TimelineMachine {
  /**
   * The field is called `ciphertext` and carries the **plaintext** on this
   * direction. That is the library's own naming, which it warns about: on the
   * way out the field is the whole wire content of an encrypted event, and on
   * the way back it is what came out of it. `receiveDecrypt.ts` reads it the
   * same way, and matching rather than renaming keeps one surprise in one
   * place instead of two names for one field.
   */
  readonly decryptEvent: (
    scope: string,
    rawEvent: unknown,
  ) => Promise<{ readonly eventType: string; readonly ciphertext: Uint8Array }>
}

interface RawEvent {
  type?: unknown
  event_id?: unknown
  sender?: unknown
  origin_server_ts?: unknown
  content?: { body?: unknown }
}

/**
 * The room's most recent messages, oldest first.
 *
 * `dir=b` walks backwards from the present, so the server answers newest
 * first and this reverses it. Forwarding the server's order would build the
 * conversation upside down, which is the kind of defect that looks like a
 * sorting bug three layers away.
 */
export async function fetchRoomMessages(
  http: HttpRequester,
  roomId: string,
  limit: number,
): Promise<readonly unknown[]> {
  const responseJson = await http.authedRequest(
    'GET',
    `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/messages`,
    { dir: 'b', limit: String(limit) },
    undefined,
  )
  const parsed = JSON.parse(responseJson) as { chunk?: unknown }
  return Array.isArray(parsed.chunk) ? [...parsed.chunk].reverse() : []
}

/**
 * One entry per message, decrypted where this device can.
 *
 * What cannot be read becomes an entry with no body rather than no entry: a
 * gap a person can see is one they can act on, and a gap silently closed is
 * one they will never know cost them something.
 *
 * Everything that is not a message is skipped. Membership changes, topic
 * edits and receipts are what the room recorded, not what was said in it.
 */
/**
 * What one pass over a room's events yields: the messages, and the reactions
 * that point at them.
 *
 * Both, because a decrypted event stream carries both and separating them
 * afterwards would mean decrypting twice. ADR-0011: a reaction is an
 * encrypted event like any other here, so it comes out of the same door.
 */
export interface DecryptedEvents {
  readonly entries: TimelineEntry[]
  readonly reactions: LooseReaction[]
}

/**
 * Whether the homeserver has already told us this event was taken back.
 *
 * `unsigned.redacted_because` is the specification's marker and carries the
 * redaction event itself, so its presence is the fact rather than a guess
 * from an empty content -- which an event could have for other reasons.
 */
function isRedacted(event: RawEvent): boolean {
  const unsigned = (event as { unsigned?: unknown }).unsigned
  return (
    typeof unsigned === 'object' &&
    unsigned !== null &&
    'redacted_because' in unsigned &&
    (unsigned as { redacted_because?: unknown }).redacted_because !== undefined
  )
}

export async function toTimelineEntries(
  machine: TimelineMachine,
  decodeUtf8: (bytes: Uint8Array) => string,
  roomId: string,
  events: readonly unknown[],
): Promise<DecryptedEvents> {
  const entries: TimelineEntry[] = []
  const reactions: LooseReaction[] = []

  for (const raw of events) {
    const event = raw as RawEvent
    const eventId = event.event_id
    const sender = event.sender
    // Without an identifier nothing can deduplicate it, and a conversation
    // that grows copies of a message is worse than one missing it.
    if (typeof eventId !== 'string' || typeof sender !== 'string') {
      continue
    }
    const sentAt =
      typeof event.origin_server_ts === 'number' ? event.origin_server_ts : 0

    if (event.type === 'm.room.message') {
      // Never encrypted, and said so. Refusing to show it would hide
      // something that was in the room; decrypting it would fail for a
      // reason that has nothing to do with what happened.
      const body = event.content?.body
      if (typeof body === 'string') {
        entries.push({ eventId, claimedSender: sender, sentAt, body })
      }
      continue
    }

    if (event.type !== 'm.room.encrypted') {
      continue
    }

    // REDACTED, WHICH IS NOT THE SAME AS UNREADABLE, AND LOOKED IDENTICAL.
    //
    // A redaction strips an event's content and leaves the shell behind, type
    // and all. An `m.room.encrypted` with nothing in it cannot be decrypted
    // -- there is no ciphertext -- so it fell into the catch below and was
    // drawn as "its key never arrived": a phantom message, in this account's
    // own name, on a conversation it never said anything on.
    //
    // A reaction taken back must leave nothing. Reported from a Pixel as
    // messages nobody had sent; the log showed four such events with no
    // `session_id`, one of them a reaction removed minutes earlier.
    //
    // AND HERE IS THE BRANCH THIS COMMENT PROMISED. It said: "the day a
    // message can be deleted, this is where that would branch -- a deleted
    // message may well deserve a line saying so, where a withdrawn reaction
    // deserves silence." §13.7 asks for exactly that line. What tells the
    // two apart is not in this event, which is a stripped shell either way;
    // it is in the redaction, and `redactionKind.ts` says why it had to be
    // put there and what an unmarked one means.
    if (isRedacted(event)) {
      if (leavesALine(event)) {
        // No `reason`: nothing went wrong. A `body` of `null` with a reason
        // is a message whose key never arrived, and this is not that.
        entries.push({
          eventId,
          claimedSender: sender,
          sentAt,
          body: null,
          removed: true,
        })
      }
      continue
    }

    try {
      const envelope = await machine.decryptEvent(roomId, raw)

      // SIGNALLING IS NOT SPEECH, AND IT WAS BEING DRAWN AS SOME.
      //
      // A call's `m.call.*` events go into the conversation encrypted, for
      // the reason `session.ts` gives: an unencrypted `party_id` tells the
      // timeline which of somebody's devices is on a call. They therefore
      // arrive here exactly like a message, decrypt perfectly, and carry no
      // `body` -- so every invite, answer and candidate list drew a bubble
      // saying "message illisible sur cet appareil". A single call would
      // have filled the conversation with them.
      //
      // The inner type is the only thing that tells them apart, and it is on
      // the envelope. `inbox.ts` reads the same field to decide the
      // opposite question.
      if (envelope.eventType.startsWith('m.call.')) continue

      const content = JSON.parse(decodeUtf8(envelope.ciphertext)) as {
        body?: unknown
      }

      // A reaction before a message, because a reaction has a body of its own
      // in no sense: read as a message it would be one with no text, which is
      // the shape reserved for a message that carried none.
      const reaction = readReaction(eventId, sender, content)
      if (reaction !== null) {
        reactions.push(reaction)
        continue
      }

      // A photograph before a text, because an `m.image` has a `body` too:
      // read as a message it would be an entry whose text is "image.jpg",
      // which is a filename drawn where a sentence goes.
      const image = readImageEvent(content as Record<string, unknown>)

      // A document before a text, and the reason is the mirror image of the
      // one above: an `m.file`'s `body` IS its filename, deliberately, so
      // read as a message it would be an entry whose text is the name of a
      // file -- true, and drawn where a sentence goes. The row says the name
      // where a name belongs.
      const document = readFileEvent(content as Record<string, unknown>)

      // L'INSTRUMENT QUI SÉPARE DEUX PANNES INDISCERNABLES.
      //
      // Quand la suite ne trouve pas la ligne d'un fichier à l'écran, deux
      // histoires très différentes donnent la même image : ou bien
      // l'application n'a pas su lire l'`m.file`, ou bien elle l'a lu et la
      // ligne n'était pas visible. Sans cette ligne, on ne peut que
      // formuler des hypothèses, et elles se ressemblent toutes.
      //
      // Le nom et rien d'autre : c'est ce que le sondage compare, et c'est
      // déjà ce que l'expéditeur a choisi de divulguer en envoyant le
      // fichier. Ni l'adresse, ni le secret, ni la taille.
      //
      // Même raison que `MESSAGR_VIDEO_CEILING` pour #199 : une mesure
      // prise sans instrument mesure autre chose que ce qu'on croit lire.
      if (document !== null) {
        logEvent('info', 'MESSAGR_DOCUMENT_READ', { name: document.name })
      }

      entries.push({
        eventId,
        claimedSender: sender,
        sentAt,
        body: typeof content.body === 'string' ? content.body : null,
        ...(image === null ? {} : { image }),
        ...(document === null ? {} : { document }),
        ...(typeof content.body === 'string' ||
        image !== null ||
        document !== null
          ? {}
          : { reason: 'this message carried no text' }),
      })
    } catch (cause: unknown) {
      const reason = getErrorMessage(cause)
      // The screen says only "its key never arrived", which is the right
      // sentence for somebody reading a conversation and the wrong one for
      // anybody working out WHY. A message this device sent itself coming
      // back unreadable means something quite different from one whose
      // sender never shared the key, and the two look identical on screen.
      // Metadata only: the identifier, who claimed to send it, and the
      // library's own words. No ciphertext, and by definition no plaintext.
      // The sender is enough to tell the two apart -- this account's own
      // identifier there is the case worth chasing.
      // The Megolm session, which is the field that tells the two apart: a
      // key somebody never sent, or a session this device made and then
      // could not read back. Both say "undecryptable" and only one of them
      // is this application's fault.
      const wrapper = (event as { content?: Record<string, unknown> }).content
      logEvent('warn', 'MESSAGR_UNREADABLE', {
        eventId,
        claimedSender: sender,
        session:
          typeof wrapper?.session_id === 'string' ? wrapper.session_id : null,
        fromDevice:
          typeof wrapper?.device_id === 'string' ? wrapper.device_id : null,
        reason,
      })
      entries.push({
        eventId,
        claimedSender: sender,
        sentAt,
        body: null,
        reason,
      })
    }
  }

  return { entries, reactions }
}
