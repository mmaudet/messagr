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
  let answer: { status: number; body: string }
  for (let attempt = 0; ; attempt += 1) {
    try {
      answer = await poster.post(
        `${link.service}/invitations/claim`,
        JSON.stringify({ token: link.token }),
      )
    } catch {
      // Deliberately different from a refusal, because a person can act on
      // the difference: this one is worth trying again, a refused link never
      // will be.
      return {
        claimed: false,
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
      return {
        claimed: false,
        reason: 'nobody has let this account in yet',
      }
    }
    await wait?.(BETWEEN_MS)
  }

  if (answer.status !== 200) {
    return { claimed: false, reason: REFUSED }
  }

  let response: ClaimResponse
  try {
    response = JSON.parse(answer.body) as ClaimResponse
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
