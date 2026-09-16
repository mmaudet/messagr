import type { Invitation } from './encryptedSend'
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
 * # WHICH DOOR, AND WHICH ONES IT LEAVES SHUT
 *
 * The one this device is waiting for, and no other. Spending an invitation
 * link is the decision, and it was taken a moment earlier by the person
 * holding the telephone: every link claimed entitles this device to enter one
 * invitation, and `awaitedInvitations.ts` is the register of what is owed.
 * Asking them to confirm that again would be asking about a decision they
 * have already made.
 *
 * Every other invitation is left exactly as it arrived -- neither entered nor
 * declined -- and reported as waiting. What becomes of it is a screen's
 * business rather than a function's: §13.3's first screen describes an
 * invitation before any decision is taken -- sender, scope, validity,
 * remaining uses, origin instance -- and offers two symmetric actions, join
 * and refuse. Until that screen is built, an invitation nobody spent a link
 * for stands where it arrived, on the threshold.
 */

export interface Entering {
  readonly http: HttpRequester
  /** `/sync`'s `rooms.invite`, as `encryptedSend.ts` reads it. */
  readonly invitedRooms: (http: HttpRequester) => Promise<readonly Invitation[]>
  readonly join: (http: HttpRequester, roomId: string) => Promise<string>
  /**
   * How many invitations this device is waiting for: one per invitation link
   * it has spent and not yet been answered about. `awaitedInvitations.ts`
   * keeps the count, and `cryptoPump.ts` tells it what this walk answered.
   *
   * Read once per walk rather than held: a link can be spent while a tick is
   * under way, and the number that matters is the one at the moment the
   * invitations are looked at.
   */
  readonly awaited: () => number
  /**
   * Everyone this account already has a direct conversation with.
   *
   * Asked for lazily, and only when there is an invitation this device may
   * enter: answering it costs a call per conversation, the overwhelming
   * majority of sync ticks carry no invitation at all, and a tick with
   * nothing to enter has nothing to decide either.
   */
  readonly alreadyWith: (http: HttpRequester) => Promise<ReadonlySet<string>>
  /**
   * Declines an invitation. `/leave` on a room one has only been invited to
   * is how Matrix spells refusal -- there is no separate verb.
   */
  readonly decline: (http: HttpRequester, roomId: string) => Promise<void>
}

export interface Entered {
  /** The rooms this device joined, which is news for a conversation list. */
  readonly joined: readonly string[]
  /** What went wrong, per room. Empty on the ordinary path. */
  readonly refused: readonly {
    readonly scope: string
    readonly reason: string
  }[]
  /**
   * The invitations declined because a conversation with that person already
   * exists, and who each one was from.
   *
   * Not a failure and not a joined room: a third outcome, because it is a
   * third fact. A screen that reported it as either would be telling
   * somebody either that something went wrong or that a conversation had
   * appeared, and neither is what happened.
   */
  readonly collapsed: readonly {
    readonly scope: string
    readonly from: string
  }[]
  /**
   * The invitations this device was not waiting for, and who made each
   * conversation.
   *
   * Nothing was sent about them: they are neither joined nor declined, and
   * they stand on the homeserver exactly as they arrived. Reported so that a
   * screen has something to draw -- §13.3's first screen is what decides
   * them -- and so that a launch can say how many are standing.
   */
  readonly waiting: readonly Invitation[]
}

/**
 * Enters the invitations this device is waiting for, and leaves the rest
 * standing.
 *
 * AS MANY DOORS AS LINKS SPENT. `deps.awaited` says how many invitations this
 * device is owed; each one entered or declined uses one up, and every
 * invitation past that is reported as waiting and touched in no way at all.
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
  const collapsed: { scope: string; from: string }[] = []
  const waiting: Invitation[] = []

  let invited: readonly Invitation[]
  try {
    invited = await deps.invitedRooms(deps.http)
  } catch (cause: unknown) {
    return {
      joined: [],
      refused: [{ scope: '', reason: getErrorMessage(cause) }],
      collapsed: [],
      waiting: [],
    }
  }

  if (invited.length === 0) return { joined, refused, collapsed, waiting }

  // HOW MANY DOORS THIS WALK MAY OPEN, read once and spent as it goes. A tick
  // that is owed nothing enters nothing, and says so without asking the
  // homeserver a single question about rooms it will not touch.
  let owed = deps.awaited()
  if (owed <= 0) return { joined, refused, collapsed, waiting: [...invited] }

  // ASKED ONCE, AND ONLY BECAUSE THERE IS SOMETHING TO DECIDE. Every sync
  // tick reaches this function and almost none of them carry an invitation;
  // building this set costs a call per conversation, so it is built after
  // the early returns above and never on a quiet tick.
  //
  // A failure to build it is not a failure to enter. Entering is what this
  // product did before it asked the question at all, and an empty set makes
  // it do that again -- which is the safe way round: a duplicate
  // conversation is untidy, a door that will not open is a person locked
  // out.
  let already: ReadonlySet<string>
  try {
    already = await deps.alreadyWith(deps.http)
  } catch {
    already = new Set()
  }

  for (const invitation of invited) {
    const { scope, from } = invitation
    // PAST WHAT THIS DEVICE IS OWED, AN INVITATION IS LEFT WHERE IT IS.
    // Nothing is joined, nothing is declined, and nothing is asked about it:
    // the screen of §13.3 is what puts it to the person.
    if (owed <= 0) {
      waiting.push(invitation)
      continue
    }
    // One of the doors this walk may open, whichever way the door goes: a
    // conversation declined below answered the invitation just as a
    // conversation joined does. A join that failed spends this walk's door
    // and no more than that -- `cryptoPump.ts` settles the register on what
    // came back, so the next tick is owed it again.
    owed -= 1
    // ONE DIRECT CONVERSATION PER PERSON, which is the rule this answers.
    //
    // Two people already in contact can each issue the other an invitation
    // -- nothing at the issuing end can know who will open a link, since the
    // whole point is that it goes to somebody the product cannot name
    // (ADR-0002). The claiming end can know, and this is it: the invitation
    // was honoured, the conversation it made is declined, and the one they
    // already have is the one they keep using.
    //
    // Reported from the Pixel, from both ends of a single invitation: « de
    // mon côté l'app m'a dirigé vers notre conversation, mais de son côté
    // une nouvelle conversation a été créée. »
    if (from !== null && already.has(from)) {
      try {
        await deps.decline(deps.http, scope)
        collapsed.push({ scope, from })
      } catch (cause: unknown) {
        // Declining is the tidy half and entering is the necessary one. A
        // refusal that cannot be sent leaves the invitation standing, which
        // is what it was a moment ago.
        refused.push({ scope, reason: getErrorMessage(cause) })
      }
      continue
    }
    try {
      joined.push(await deps.join(deps.http, scope))
    } catch (cause: unknown) {
      refused.push({ scope, reason: getErrorMessage(cause) })
    }
  }

  return { joined, refused, collapsed, waiting }
}
