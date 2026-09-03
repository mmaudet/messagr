import type { HttpRequester } from './pump'

/**
 * Sending what the crypto machine encrypted.
 *
 * The transport never encrypts anything here. `encryptEvent` hands back the
 * wire content of an `m.room.encrypted` event, already serialised, and this
 * module addresses and posts it. ADR-0001's send-path consequence is what
 * makes that work: matrix-js-sdk passes a self-built encrypted event through
 * untouched, because it treats an already-encrypted type as needing no
 * encryption, so the guard that would throw without crypto configured is
 * never reached.
 *
 * The same raw authenticated request path the pump uses, for the same
 * reason: the typed endpoint wrappers build a body from structured
 * arguments, and this body is one the crypto machine already produced.
 */

interface JoinedRoomsResponse {
  joined_rooms?: unknown
}

/**
 * The rooms this account has joined, asked of the server rather than read
 * off matrix-js-sdk's room model.
 *
 * The model is populated by a sync loop this application stops as soon as its
 * first sync lands (`sessionSync.ts`), so asking directly is both simpler and
 * true at the moment it is asked.
 */
export async function fetchJoinedRooms(
  http: HttpRequester,
): Promise<readonly string[]> {
  const responseJson = await http.authedRequest(
    'GET',
    '/_matrix/client/v3/joined_rooms',
    {},
    undefined,
  )
  const response = JSON.parse(responseJson) as JoinedRoomsResponse
  const rooms = response.joined_rooms

  if (!Array.isArray(rooms)) {
    return []
  }
  return rooms.filter((room): room is string => typeof room === 'string')
}

interface JoinedMembersResponse {
  joined?: Record<string, unknown>
}

/**
 * Who is in the room, so the room key can be shared with them.
 *
 * Megolm shares to the devices present when the key is shared, so a member
 * this misses is a member who cannot read what follows. Asked of the server
 * for the same reason as the joined rooms above.
 */
export async function fetchJoinedMembers(
  http: HttpRequester,
  roomId: string,
): Promise<readonly string[]> {
  const responseJson = await http.authedRequest(
    'GET',
    `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/joined_members`,
    {},
    undefined,
  )
  const response = JSON.parse(responseJson) as JoinedMembersResponse
  const joined = response.joined

  if (joined === null || typeof joined !== 'object') {
    return []
  }
  return Object.keys(joined)
}

interface SendResponse {
  event_id?: unknown
}

/**
 * Puts an already-encrypted content into a room as `m.room.encrypted`.
 *
 * `contentJson` goes out verbatim. It is what `encryptEvent` produced, and
 * anything reshaped here is something the far side cannot decrypt.
 */
export async function sendEncryptedEvent(
  http: HttpRequester,
  roomId: string,
  contentJson: string,
  txnId: string,
): Promise<string> {
  const path =
    `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/` +
    `m.room.encrypted/${encodeURIComponent(txnId)}`

  const responseJson = await http.authedRequest('PUT', path, {}, contentJson)
  const response = JSON.parse(responseJson) as SendResponse

  if (typeof response.event_id !== 'string') {
    // Not defaulted to empty: a send this application cannot name an event id
    // for is a send it cannot claim happened.
    throw new Error('the homeserver returned no event id for the send')
  }
  return response.event_id
}

interface EncryptedContent {
  ciphertext?: unknown
}

/**
 * Flips one character of the ciphertext, leaving everything around it alone.
 *
 * This exists to be refused. A product that encrypts correctly and accepts
 * anything on the way back in has not built end-to-end encryption, it has
 * built an expensive encoding, and the difference is invisible until someone
 * tampers with a message. So the application tampers with its own.
 *
 * Only the ciphertext moves: the algorithm, session and sender fields stay
 * exactly as the machine wrote them, so a refusal is attributable to the
 * ciphertext rather than to a shape the far side never recognised.
 */
export function tamperCiphertext(contentJson: string): string {
  const content = JSON.parse(contentJson) as EncryptedContent
  const ciphertext = content.ciphertext

  if (typeof ciphertext !== 'string' || ciphertext.length === 0) {
    throw new Error('the content carries no ciphertext to tamper with')
  }

  // Substituted rather than incremented: an increment has to answer what
  // comes after the last character of the alphabet, and every alphabet in
  // play here (base64, base64url) contains both of these, so one of the two
  // is always a change.
  const first = ciphertext[0]
  const replacement = first === 'A' ? 'B' : 'A'

  return JSON.stringify({
    ...content,
    ciphertext: replacement + ciphertext.slice(1),
  })
}
