import type { ServicePoster } from './claimInvitation'

/**
 * The plain, unauthenticated poster the invitation service is reached with.
 *
 * Not the pump's authenticated path, and not matrix-js-sdk at all: claiming
 * an invitation happens before any account exists, so there is nothing to
 * authenticate as and no client to authenticate with.
 *
 * A non-200 is returned rather than thrown. The service answers a refused
 * invitation with a status, and that is an answer — distinguishing it from a
 * network failure is the whole reason `claimInvitation` can tell a person
 * which of the two happened.
 */
export const servicePoster: ServicePoster = {
  post: async (url, body) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
    return { status: response.status, body: await response.text() }
  },
}
