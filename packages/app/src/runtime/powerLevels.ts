import type { HttpRequester } from './pump'

/**
 * Reading and raising what a member is allowed to do in a conversation.
 *
 * # What the numbers mean here
 *
 * A conversation this product creates sets `m.room.power_levels` so that
 * `invite` requires 50 and members arrive at 0. So an entrant cannot invite
 * anybody, a promoted member can, and the invitation service reads the same
 * event to decide -- it does not take the application's word for it
 * (`services/invitations/src/matrix.rs`). Promotion is therefore not a flag
 * this product invents: it is the one number both sides already agree to
 * read.
 *
 * # The trap this module exists to close
 *
 * **`PUT .../state/m.room.power_levels` replaces the whole content.** There
 * is no merge, no patch, and no partial update: whatever is sent becomes the
 * room's complete set of rules, and every key not sent is *gone*.
 *
 * That makes the obvious implementation dangerous in a way nothing reports.
 * Parse the content into a typed shape, change one number, send the typed
 * shape back, and every key the type did not model has been deleted --
 * `events`, `events_default`, `state_default`, `ban`, `kick`, `redact`,
 * `notifications`, and `invite` itself. Dropping `invite` is the worst of
 * them, because the specification's default for a missing `invite` key is
 * **0**: a promotion meant to grant one person the right to invite would
 * instead grant it to everybody in the room, silently, and the only symptom
 * would be entrants who can suddenly invite.
 *
 * So the content is carried as an opaque object from the moment it is read
 * to the moment it is written. Exactly one key is touched. Nothing is
 * reshaped, nothing is defaulted, and nothing this application does not
 * understand is dropped.
 */

/** What this application reads out of the room's rules, for its own use. */
export interface PowerReading {
  /** The level `<user>` holds, taking `users_default` into account. */
  readonly held: number
  /** The level the room requires to invite. */
  readonly toInvite: number
  /** Whether `held` is enough to invite. */
  readonly mayInvite: boolean
}

/**
 * The room's rules, exactly as the homeserver holds them.
 *
 * Opaque on purpose -- see the trap above. Nothing outside this module
 * should reach into it, and nothing inside it reshapes it.
 */
export type PowerContent = Record<string, unknown>

const SPEC_DEFAULT_INVITE = 0
const SPEC_DEFAULT_USERS = 0

function path(roomId: string): string {
  return (
    `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}` +
    `/state/m.room.power_levels`
  )
}

function numberAt(
  content: PowerContent,
  key: string,
  fallback: number,
): number {
  const value = content[key]
  // A key that is absent is a specification default; a key that is present
  // and unreadable is NOT. `"invite": "fifty"` read as 0 would be a
  // permission granted because a value could not be parsed -- the same
  // distinction the invitation service draws, and for the same reason.
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`the room's "${key}" is not a number`)
  }
  return value
}

/** Reads the room's rules. Throws rather than guessing at an unreadable one. */
export async function fetchPowerContent(
  http: HttpRequester,
  roomId: string,
): Promise<PowerContent> {
  const responseJson = await http.authedRequest(
    'GET',
    path(roomId),
    {},
    undefined,
  )
  const content: unknown = JSON.parse(responseJson)
  if (
    content === null ||
    typeof content !== 'object' ||
    Array.isArray(content)
  ) {
    throw new Error("the room's power levels are not an object")
  }
  return content as PowerContent
}

/**
 * What `userId` currently holds, and whether it is enough to invite.
 *
 * **It reads `users` and `users_default`, and nothing else — which is not the
 * whole truth about power, and is enough for what this module is asked.** A
 * room's creator holds power that is not in that map: newer room versions put
 * it in `m.room.create` instead, and the invitation service models it
 * separately for exactly that reason (`HeldPower::Creator`).
 *
 * Measured on `messagr.eu`, 5 September 2026: a room created seconds earlier
 * came back with `"users": {}` while its creator could issue invitations.
 * Asked about that creator, this function answers `held: 0` and
 * `mayInvite: false`, and both are wrong.
 *
 * It is not wrong anywhere this product calls it. Vouching asks about the
 * *entrant*, who is never the creator, and nothing in the application asks
 * about its own power. The day something does — a screen that says what you
 * may do here — this is the first thing to fix, and it should read
 * `m.room.create` rather than guess.
 */
export function readPower(content: PowerContent, userId: string): PowerReading {
  const usersDefault = numberAt(content, 'users_default', SPEC_DEFAULT_USERS)
  const users = content.users
  let held = usersDefault
  if (users !== undefined && users !== null) {
    if (typeof users !== 'object' || Array.isArray(users)) {
      throw new Error('the room\'s "users" is not an object')
    }
    const named = (users as Record<string, unknown>)[userId]
    if (named !== undefined) {
      if (typeof named !== 'number' || !Number.isFinite(named)) {
        throw new Error(`the room's level for ${userId} is not a number`)
      }
      held = named
    }
  }

  const toInvite = numberAt(content, 'invite', SPEC_DEFAULT_INVITE)
  return { held, toInvite, mayInvite: held >= toInvite }
}

/**
 * Raises `userId` to `level`, and reads the room back to say what happened.
 *
 * **Read back rather than assumed.** A `PUT` that returns an event id says
 * the homeserver accepted the event, not that the room now grants what was
 * asked: a server-side policy, a room version's own rules, or a concurrent
 * write can all leave the room saying something other than what was sent.
 * The promotion this product makes is the thing a person is told about and
 * the thing the invitation service will act on, so it is confirmed against
 * the room rather than against the request.
 *
 * Never lowers. A call that would reduce what `userId` already holds returns
 * the current reading untouched and writes nothing -- promotion is the only
 * thing this module does, and demotion belongs to the eviction gesture,
 * which has its own consequences (a key rotation) that this call does not
 * perform.
 */
export async function grantPower(
  http: HttpRequester,
  roomId: string,
  userId: string,
  level: number,
): Promise<PowerReading> {
  const content = await fetchPowerContent(http, roomId)
  const before = readPower(content, userId)
  if (before.held >= level) return before

  // The opaque object, one key deeper, with exactly one value changed.
  // `users` is rebuilt rather than mutated in place so a caller holding the
  // fetched content does not see it change under them; everything else in
  // the content is carried across by reference, untouched and unexamined.
  const users = content.users
  const existing: Record<string, unknown> =
    users !== undefined &&
    users !== null &&
    typeof users === 'object' &&
    !Array.isArray(users)
      ? (users as Record<string, unknown>)
      : {}
  const next: PowerContent = {
    ...content,
    users: { ...existing, [userId]: level },
  }

  await http.authedRequest('PUT', path(roomId), {}, JSON.stringify(next))

  return readPower(await fetchPowerContent(http, roomId), userId)
}
