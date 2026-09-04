import { getErrorMessage } from '../runtime/errors'
import type { HttpRequester } from '../runtime/pump'
import type { TimelineEntry } from './mergeTimeline'

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
  ) => Promise<{ ciphertext: Uint8Array }>
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
export async function toTimelineEntries(
  machine: TimelineMachine,
  decodeUtf8: (bytes: Uint8Array) => string,
  roomId: string,
  events: readonly unknown[],
): Promise<TimelineEntry[]> {
  const entries: TimelineEntry[] = []

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

    try {
      const envelope = await machine.decryptEvent(roomId, raw)
      const content = JSON.parse(decodeUtf8(envelope.ciphertext)) as {
        body?: unknown
      }
      entries.push({
        eventId,
        claimedSender: sender,
        sentAt,
        body: typeof content.body === 'string' ? content.body : null,
        ...(typeof content.body === 'string'
          ? {}
          : { reason: 'this message carried no text' }),
      })
    } catch (cause: unknown) {
      entries.push({
        eventId,
        claimedSender: sender,
        sentAt,
        body: null,
        reason: getErrorMessage(cause),
      })
    }
  }

  return entries
}
