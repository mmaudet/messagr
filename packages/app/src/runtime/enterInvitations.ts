import { getErrorMessage } from './errors'
import type { HttpRequester } from './pump'

/**
 * Walking through the door somebody held open.
 *
 * # AN INVITATION IS NOT MEMBERSHIP, AND NOTHING WAS CROSSING THAT GAP
 *
 * The entrant claims a link, the issuer's application admits them, and the
 * homeserver records an *invitation* to the conversation. Until the entrant's
 * device joins, they are on the threshold: `/joined_rooms` does not list the
 * room, no message reaches them, and the conversation list is empty on a
 * device whose sync reports a room. Nothing on either screen says so.
 *
 * The only join this application ever performed lived inside
 * `encryptAndSendOneMessage` -- the launch probe -- as a side effect of
 * needing somewhere to send its diagnostic message. Every entrant who ever
 * entered did so because a probe wanted a room. On 7 September 2026 the probe
 * was put behind a flag, for a good reason of its own, and the door quietly
 * stopped opening. Measured the next morning: an emulator that claimed an
 * invitation, was admitted, synced one room, and showed an empty
 * conversation list through two relaunches; the demonstration Pixel had eight
 * such rooms in its own list, drawn by their identifier with "nothing has
 * been said here yet" under them.
 *
 * So entering is its own function now, on the product's path rather than the
 * diagnostic one.
 *
 * # WHY IT ACCEPTS WITHOUT ASKING
 *
 * On this product an invitation to a conversation is not an unsolicited
 * approach: §7.6 has no directory and no address book, so nobody can invite
 * an account they were not given by the invitation service, and the person
 * being invited is the one who opened the link a moment earlier. Asking them
 * to confirm again would be asking about a decision they have already made.
 *
 * The day a conversation can be started by anybody who knows an identifier,
 * this becomes a screen and not a function.
 */

export interface Entering {
  readonly http: HttpRequester
  /** `/sync`'s `rooms.invite`, as `encryptedSend.ts` reads it. */
  readonly invitedRooms: (http: HttpRequester) => Promise<readonly string[]>
  readonly join: (http: HttpRequester, roomId: string) => Promise<string>
}

export interface Entered {
  /** The rooms this device joined, which is news for a conversation list. */
  readonly joined: readonly string[]
  /** What went wrong, per room. Empty on the ordinary path. */
  readonly refused: readonly {
    readonly scope: string
    readonly reason: string
  }[]
}

/**
 * Joins every room this account has been invited to.
 *
 * ONE FAILURE DOES NOT COST THE OTHERS. A room whose join is refused -- a
 * conversation the issuer left, a homeserver that says no -- must not keep
 * the device out of the next one. Each is reported and the walk continues.
 *
 * Answers rather than throws: this runs on a launch and on a sync tick, and
 * neither is a place where a room that would not open should take anything
 * else down.
 */
export async function enterInvitations(deps: Entering): Promise<Entered> {
  const joined: string[] = []
  const refused: { scope: string; reason: string }[] = []

  let invited: readonly string[]
  try {
    invited = await deps.invitedRooms(deps.http)
  } catch (cause: unknown) {
    return {
      joined: [],
      refused: [{ scope: '', reason: getErrorMessage(cause) }],
    }
  }

  for (const scope of invited) {
    try {
      joined.push(await deps.join(deps.http, scope))
    } catch (cause: unknown) {
      refused.push({ scope, reason: getErrorMessage(cause) })
    }
  }

  return { joined, refused }
}
