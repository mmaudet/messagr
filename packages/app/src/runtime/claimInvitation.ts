import type { InvitationLink } from './invitationLink'
import type { RestoreCredentials } from './sessionCredentials'

/**
 * Spending an invitation, which is what creates the account.
 *
 * The account does not exist before the claim. That is what makes revocation
 * mean something: an invitation withdrawn before it is spent leaves no
 * account behind, and a Matrix homeserver never releases a localpart once one
 * has been taken.
 *
 * What comes back is a whole session rather than a token. A token alone would
 * force a password login, which creates a second device and wastes the
 * invitation just spent.
 *
 * The invitation service is not the homeserver and this request carries no
 * authentication — there is nothing yet to authenticate as. So it goes
 * through a plain poster rather than the pump's authenticated path.
 */
export interface ServicePoster {
  post: (
    url: string,
    body: string,
  ) => Promise<{ readonly status: number; readonly body: string }>
}

export type ClaimResult =
  | { readonly claimed: true; readonly session: RestoreCredentials }
  | { readonly claimed: false; readonly reason: string }

/**
 * What spending an invitation does for a device that already has an account.
 *
 * No session comes back, and that is the whole difference: there is nothing
 * to hand over, because the caller already is somebody. What happens instead
 * is that the account is invited into the conversation the invitation was
 * for -- so the invitation does what its issuer meant it to do rather than
 * being thrown away.
 */
export type JoinResult =
  | { readonly invited: true }
  | { readonly invited: false; readonly reason: string }

interface ClaimResponse {
  user_id?: unknown
  device_id?: unknown
  access_token?: unknown
}

/**
 * One refusal for every reason a link can fail.
 *
 * The service answers unknown, spent, revoked and expired identically, and
 * says why in its own source: distinguishing them would make it an oracle for
 * which tokens ever existed. Reporting the difference here would rebuild
 * exactly the oracle it refuses to be, on the other side of the wire.
 */
const REFUSED = 'this invitation cannot be used'

/**
 * How long to keep asking while the issuer is still letting this account in,
 * and how long to wait between. Fifteen attempts two seconds apart: half a
 * minute, which is longer than the round trip takes and short enough that a
 * link that will never work stops looking like one that might.
 */
const ATTEMPTS = 15
const BETWEEN_MS = 2000

/**
 * A CLAIM IS TWO CALLS, AND THE FIRST ONE IS SUPPOSED TO FAIL.
 *
 * The service answers the first claim `409 MESSAGR_NOT_YET_INVITED`: it has
 * drawn an account for this link, and that account is in no conversation yet.
 * What unblocks it is the *issuer* inviting the drawn account, which their
 * application does without anybody asking (`issueInvitation.ts`), and then a
 * second claim with the same token.
 *
 * So a 409 is not a refusal, it is the middle of the handshake, and the two
 * must not be collapsed: every other refusal the service gives is final, and
 * retrying one would be asking a question already answered. Watched failing
 * exactly that way on two emulators -- the issuer admitted the entrant, and
 * the entrant had already given up and said the invitation could not be used.
 */
export async function claimInvitation(
  poster: ServicePoster,
  link: InvitationLink,
  wait?: (ms: number) => Promise<void>,
): Promise<ClaimResult> {
  const answer = await postWithPatience(poster, link, {}, wait)
  if (!answer.answered) return { claimed: false, reason: answer.reason }
  return sessionFrom(answer.status, answer.body, link)
}

/**
 * Spends an invitation on behalf of an account that already exists.
 *
 * # WHY THIS IS NOT "IGNORE THE LINK"
 *
 * A held session beats a link, and it must: an invitation that could replace
 * an account somebody already has would be a way of taking their account
 * from them. That rule is not in question and does not move.
 *
 * What it does not follow from is that the link is worthless. Somebody
 * issued it deliberately, to reach the person holding this telephone, and
 * throwing it away leaves them looking at « personne n'a encore ouvert le
 * lien » forever while the person they invited is looking at a message
 * saying the invitation was not used. Reported exactly that way, from both
 * ends of the same invitation.
 *
 * The service has always known how to do the other thing. `claim.rs` calls
 * it the *existing user* path: the account it drew for the link cedes its
 * place -- joins the conversation, invites the real person into it, leaves,
 * and deactivates itself. Nothing here is new on the wire; what was missing
 * was any client ever sending `existing_user_id`.
 *
 * # WHAT COMES BACK, AND WHAT DOES NOT
 *
 * No session. `ClaimResponse.device_id` is documented as « empty on the
 * "existing user" path, like the other two secrets: the caller already has
 * its own session there ». So a 200 is the whole of the good news, and
 * reading the body for credentials would be reading for something the
 * service says it does not send.
 */
export async function claimForExistingAccount(
  poster: ServicePoster,
  link: InvitationLink,
  userId: string,
  wait?: (ms: number) => Promise<void>,
): Promise<JoinResult> {
  const answer = await postWithPatience(
    poster,
    link,
    { existing_user_id: userId },
    wait,
  )
  if (!answer.answered) return { invited: false, reason: answer.reason }
  // A 200 and nothing else. The conversation this invitation was for now
  // carries a Matrix invitation to this account, and `enterInvitations.ts`
  // is what walks through it.
  return answer.status === 200
    ? { invited: true }
    : { invited: false, reason: REFUSED }
}

type Answered =
  | { readonly answered: true; readonly status: number; readonly body: string }
  | { readonly answered: false; readonly reason: string }

/**
 * The claim call, with the handshake's pause built into it.
 *
 * Shared by both paths because the pause belongs to the service's protocol
 * rather than to either caller: whichever way a link is spent, the drawn
 * account has to be let into the conversation by the issuer's application
 * before the second call can succeed.
 */
async function postWithPatience(
  poster: ServicePoster,
  link: InvitationLink,
  extra: Readonly<Record<string, string>>,
  wait?: (ms: number) => Promise<void>,
): Promise<Answered> {
  let answer: { status: number; body: string }
  for (let attempt = 0; ; attempt += 1) {
    try {
      answer = await poster.post(
        `${link.service}/invitations/claim`,
        JSON.stringify({ token: link.token, ...extra }),
      )
    } catch {
      // Deliberately different from a refusal, because a person can act on
      // the difference: this one is worth trying again, a refused link never
      // will be.
      return {
        answered: false,
        reason: 'the invitation service could not be reached',
      }
    }
    if (answer.status !== 409) break
    // No way to wait is a caller that cannot mean to keep asking: without a
    // pause this would hammer the service fifteen times in as many
    // milliseconds, which is not patience, it is a burst. `entry.ts` passes a
    // real one on a device and nothing in a test does.
    if (wait === undefined || attempt + 1 >= ATTEMPTS) {
      // Not `REFUSED`. The link is fine and the account was drawn; what did
      // not happen is the other person's application letting it in, and
      // saying "this invitation cannot be used" would send somebody to ask
      // for a new link that would fail the same way.
      return { answered: false, reason: 'nobody has let this account in yet' }
    }
    await wait?.(BETWEEN_MS)
  }

  return { answered: true, status: answer.status, body: answer.body }
}

/** The session a newcomer's claim answers with, or why there is none. */
function sessionFrom(
  status: number,
  body: string,
  link: InvitationLink,
): ClaimResult {
  if (status !== 200) {
    return { claimed: false, reason: REFUSED }
  }

  let response: ClaimResponse
  try {
    response = JSON.parse(body) as ClaimResponse
  } catch {
    return { claimed: false, reason: REFUSED }
  }

  const { user_id: userId, device_id: deviceId, access_token: token } = response
  if (
    typeof userId !== 'string' ||
    typeof deviceId !== 'string' ||
    typeof token !== 'string'
  ) {
    // A partial session is worse than none. Stored and restored, it would
    // fail somewhere later with nothing connecting the failure to this
    // moment.
    return { claimed: false, reason: REFUSED }
  }

  // The answer also carries a password. It is deliberately not read here and
  // not carried anywhere: a restored session needs the triple and nothing
  // else, and holding a second credential nothing uses is holding something
  // that can only be lost.
  return {
    claimed: true,
    session: {
      baseUrl: link.homeserver,
      userId,
      deviceId,
      accessToken: token,
    },
  }
}
