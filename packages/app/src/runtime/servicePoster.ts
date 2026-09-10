import type { ServicePoster } from './claimInvitation'
import type { InvitationService } from './issueInvitation'

/**
 * The poster the invitation service's claim endpoint is reached with.
 *
 * Not the pump's authenticated path, and not matrix-js-sdk at all: claiming
 * an invitation usually happens before any account exists, so there is
 * nothing to authenticate as and no client to authenticate with.
 *
 * USUALLY, AND NOT ALWAYS. A device that already has an account spends a
 * link the other way -- the service invites that account into the
 * conversation rather than drawing a new one -- and there it must prove
 * whose account it is. So the bearer is optional here rather than absent:
 * the two paths are the same call, and only one of them has anybody to be.
 *
 * A non-200 is returned rather than thrown. The service answers a refused
 * invitation with a status, and that is an answer — distinguishing it from a
 * network failure is the whole reason `claimInvitation` can tell a person
 * which of the two happened.
 */
export const servicePoster: ServicePoster = {
  post: async (url, body, bearer) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Only when there is one. A newcomer has nothing to send and the
        // service wants nothing; a device that already has an account has to
        // prove it is the account it names, or the service answers 401.
        ...(bearer === undefined ? {} : { Authorization: `Bearer ${bearer}` }),
      },
      body,
    })
    return { status: response.status, body: await response.text() }
  },
}

/**
 * The same service, reached as somebody.
 *
 * Issuing an invitation is the mirror of claiming one and needs the opposite
 * thing: a claim has no account yet and carries no authentication, while a
 * mint is made by an account that must be allowed to invite. The bearer is
 * this account's own Matrix access token — the invitation service accepts it
 * and reads the conversation's power levels with it, which is how it refuses
 * to mint for somebody who could not honour the link.
 *
 * `fetch` rather than the pump's authenticated path, for the reason the
 * unauthenticated poster above gives and one more: minting needs an
 * idempotency key, which is a header, and `HttpRequester` carries none.
 */
export function invitationService(
  baseUrl: string,
  accessToken: string,
): InvitationService {
  const answer = async (response: Response) => ({
    status: response.status,
    body: await response.text(),
  })
  const authorised = { Authorization: `Bearer ${accessToken}` }

  return {
    issue: async (body, idempotencyKey) =>
      answer(
        await fetch(`${baseUrl}/_messagr/invitations`, {
          method: 'POST',
          headers: {
            ...authorised,
            'Content-Type': 'application/json',
            // Required, and the service says why: without one, every retry
            // would create a new pool of definitive accounts.
            'idempotency-key': idempotencyKey,
          },
          body,
        }),
      ),
    status: async invitationId =>
      answer(
        await fetch(
          `${baseUrl}/_messagr/invitations/${encodeURIComponent(invitationId)}`,
          { headers: authorised },
        ),
      ),
  }
}
