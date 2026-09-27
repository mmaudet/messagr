import type { ServicePoster } from './claimInvitation'
import type { DeliveryService } from './deliveredInvitations'
import type { DiscoveryService } from './discovery'
import type { FindingService } from './findContacts'
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
  const authorised = { Authorization: `Bearer ${accessToken}` }

  return {
    issue: async (body, idempotencyKey) =>
      answered(
        await fetch(`${serviceAt(baseUrl)}/invitations`, {
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
      answered(
        await fetch(
          `${serviceAt(baseUrl)}/invitations/${encodeURIComponent(invitationId)}`,
          { headers: authorised },
        ),
      ),
  }
}

/**
 * The discovery routes of the same service, reached as the account this
 * launch holds: proving a number (#397, #398), and looking for one's
 * contacts (#400).
 *
 * The account is read at each request rather than handed over once: the
 * journey that uses this is made when the screen mounts, before a launch has
 * bound any account, and a request made without one fails like a service
 * that cannot be reached.
 */
export function discoveryService(
  account: () => {
    readonly baseUrl: string
    readonly accessToken: string
  } | null,
): DiscoveryService & FindingService & DeliveryService {
  const call = async (
    path: string,
    body?: string,
    method: 'GET' | 'POST' | 'DELETE' = body === undefined ? 'GET' : 'POST',
  ) => {
    const held = account()
    if (held === null) throw new Error('this launch holds no account')
    const authorised = { Authorization: `Bearer ${held.accessToken}` }
    return answered(
      await fetch(
        `${serviceAt(held.baseUrl)}${path}`,
        body === undefined
          ? { method, headers: authorised }
          : {
              method,
              headers: { ...authorised, 'Content-Type': 'application/json' },
              body,
            },
      ),
    )
  }
  return {
    state: () => call('/discovery/state'),
    startProof: body => call('/discovery/proofs', body),
    finishProof: body => call('/discovery/proofs/finish', body),
    withdraw: () => call('/discovery/number', undefined, 'DELETE'),
    keys: () => call('/discovery/keys'),
    maskBatch: body => call('/discovery/masks', body),
    directory: () => call('/discovery/directory'),
    sendInvitation: body => call('/discovery/invitations', body),
    sentStatus: id => call(`/discovery/invitations/${encodeURIComponent(id)}`),
    waitingInvitations: () => call('/discovery/invitations'),
    joinInvitation: id =>
      call(`/discovery/invitations/${encodeURIComponent(id)}/join`, '{}'),
    declineInvitation: id =>
      call(`/discovery/invitations/${encodeURIComponent(id)}/decline`, '{}'),
    blockInvitation: id =>
      call(`/discovery/invitations/${encodeURIComponent(id)}/block`, '{}'),
    enteredInvitation: id =>
      call(`/discovery/invitations/${encodeURIComponent(id)}/entered`, '{}'),
  }
}

/**
 * The invitation service of an account: nginx hands `/_messagr/` on the
 * account's homeserver to it.
 */
export function serviceAt(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/_messagr`
}

/** An answer read whole, whatever its status: a refusal is an answer too. */
async function answered(response: Response) {
  return { status: response.status, body: await response.text() }
}

/**
 * Announces to the invitation service that this account is about to be
 * deleted (#385), and answers the HTTP status.
 *
 * No body: the token says whose account, as on every route of the service
 * that acts for one, and nobody announces somebody else's deletion. A status
 * is returned rather than thrown, as everywhere in this file: what counts as
 * told is `deleteAccount.ts`'s to decide, where it is tested.
 */
export async function announceDeletion(
  baseUrl: string,
  accessToken: string,
): Promise<number> {
  const response = await fetch(`${serviceAt(baseUrl)}/account-deletions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  return response.status
}
