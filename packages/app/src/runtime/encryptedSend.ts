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

interface SyncInvitesResponse {
  rooms?: { invite?: Record<string, unknown> }
}

/** A conversation this account has been invited to, and who made it. */
export interface Invitation {
  readonly scope: string
  /**
   * Who created the conversation, when the stripped state says.
   *
   * NOT WHO SENT THE MATRIX INVITATION. On this product that is almost never
   * the person who meant to invite anybody: the invitation service draws an
   * account for a link, and on the existing-user path that drawn account
   * joins the conversation, sends the invitation, leaves and deactivates
   * itself. Its identifier is a throwaway. `m.room.create`'s sender is the
   * person who issued the link, which is the one a screen can name and the
   * one worth comparing against the conversations this device already has.
   *
   * `null` when the homeserver's stripped state does not carry the creation
   * event -- which it is allowed not to. A caller that cannot tell who
   * invited it must fall back on entering, which is what this product did
   * before it asked at all.
   */
  readonly from: string | null
}

/**
 * The rooms this account has been invited to but has not joined.
 *
 * Provisioning invites this account rather than joining it, and an invited
 * room is not a joined one: `/joined_rooms` does not list it, and nothing can
 * be sent to it. Read from a raw non-blocking sync, the same escape hatch the
 * pump's own workaround uses, because no public accessor offers invites back
 * either once the SDK's loop has stopped.
 */
export async function fetchInvitedRooms(
  http: HttpRequester,
): Promise<readonly string[]> {
  return (await fetchInvitations(http)).map(one => one.scope)
}

/**
 * The same rooms, with who issued each one.
 *
 * The invitation's own `invite_state` carries a handful of stripped state
 * events, and `m.room.create` is the one worth reading: its sender made the
 * conversation, which on this product is the person who issued the link.
 * Reading it costs nothing extra -- the sync already carried it, and the
 * shorter function above was throwing it away.
 */
export async function fetchInvitations(
  http: HttpRequester,
): Promise<readonly Invitation[]> {
  const responseJson = await http.authedRequest(
    'GET',
    '/_matrix/client/v3/sync',
    { timeout: '0' },
    undefined,
  )
  const response = JSON.parse(responseJson) as SyncInvitesResponse
  const invited = response.rooms?.invite

  if (invited === null || typeof invited !== 'object') {
    return []
  }
  return Object.entries(invited).map(([scope, room]) => ({
    scope,
    from: creatorOf(room),
  }))
}

/**
 * Who made the conversation, out of an invitation's stripped state.
 *
 * Read defensively down every step: this is a homeserver's JSON, the field
 * is optional by specification, and a shape nobody expected is a reason to
 * answer `null` rather than to take a launch down.
 */
function creatorOf(room: unknown): string | null {
  if (room === null || typeof room !== 'object') return null
  const events = (room as { invite_state?: { events?: unknown } }).invite_state
    ?.events
  if (!Array.isArray(events)) return null
  for (const event of events) {
    if (event === null || typeof event !== 'object') continue
    const { type, sender } = event as { type?: unknown; sender?: unknown }
    // `m.room.create`'s sender is the creator. Room version 11 removed the
    // `creator` content field in favour of exactly this, so the sender is
    // the field to read rather than a fallback for one.
    if (type === 'm.room.create' && typeof sender === 'string' && sender !== '')
      return sender
  }
  return null
}

/**
 * Joins a room, and answers with the id the server confirms.
 *
 * Joining a room already joined is not an error, so this needs no prior
 * check: the server answers with the same room id either way.
 */
/**
 * Declines an invitation to a conversation.
 *
 * `/leave` is how Matrix spells refusal for a room one has only been invited
 * to: there is no separate verb, and the same call on a room one has joined
 * is a departure. Both are the truthful thing to send in their own case.
 *
 * Nothing comes back worth reading. The homeserver answers an empty object,
 * and a refusal that was accepted is a refusal that no longer appears in
 * `rooms.invite` on the next sync -- which is where the caller finds out.
 */
export async function declineRoom(
  http: HttpRequester,
  roomId: string,
): Promise<void> {
  await http.authedRequest(
    'POST',
    `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/leave`,
    {},
    '{}',
  )
}

export async function joinRoom(
  http: HttpRequester,
  roomId: string,
): Promise<string> {
  const responseJson = await http.authedRequest(
    'POST',
    `/_matrix/client/v3/join/${encodeURIComponent(roomId)}`,
    {},
    '{}',
  )
  const response = JSON.parse(responseJson) as { room_id?: unknown }

  if (typeof response.room_id !== 'string') {
    throw new Error(`the homeserver did not confirm joining ${roomId}`)
  }
  return response.room_id
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
