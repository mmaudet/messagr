import { describe, expect, it } from 'vitest'

import { claimInvitation, type ServicePoster } from './claimInvitation'

const LINK = {
  token: 'abc123',
  homeserver: 'https://messagr.eu',
  service: 'https://messagr.eu/_messagr',
}

function poster(
  respond: (url: string, body: string) => { status: number; body: string },
): ServicePoster & { calls: Array<{ url: string; body: string }> } {
  const calls: Array<{ url: string; body: string }> = []
  return {
    post: async (url, body) => {
      calls.push({ url, body })
      return respond(url, body)
    },
    calls,
  }
}

const GRANTED = JSON.stringify({
  user_id: '@uvq:messagr.eu',
  device_id: 'DEVICE1',
  access_token: 'syt_secret',
  password: 'a-password-nobody-asked-for',
})

describe('claimInvitation', () => {
  it('spends the token at the invitation service and returns a whole session', async () => {
    const p = poster(() => ({ status: 200, body: GRANTED }))
    const result = await claimInvitation(p, LINK)
    expect(p.calls[0]?.url).toBe(
      'https://messagr.eu/_messagr/invitations/claim',
    )
    expect(p.calls[0]?.body).toBe(JSON.stringify({ token: 'abc123' }))
    expect(result).toEqual({
      claimed: true,
      session: {
        baseUrl: 'https://messagr.eu',
        userId: '@uvq:messagr.eu',
        deviceId: 'DEVICE1',
        accessToken: 'syt_secret',
      },
    })
  })

  it('does not carry the password anywhere', async () => {
    // A restored session needs the triple and nothing else. Keeping the
    // password would be holding a second credential that nothing here uses
    // and that could be lost.
    const p = poster(() => ({ status: 200, body: GRANTED }))
    const result = await claimInvitation(p, LINK)
    expect(JSON.stringify(result)).not.toContain('a-password-nobody-asked-for')
  })

  it('gives one refusal for a link that is unknown, spent, revoked or expired', async () => {
    // The service answers all four the same way on purpose, so that a caller
    // cannot use it to discover which tokens ever existed. Reporting the
    // difference here would rebuild the oracle the service refuses to be.
    for (const errcode of ['M_NOT_FOUND', 'M_UNKNOWN']) {
      const p = poster(() => ({
        status: 404,
        body: JSON.stringify({ errcode, error: 'nope' }),
      }))
      const result = await claimInvitation(p, LINK)
      expect(result).toEqual({
        claimed: false,
        reason: 'this invitation cannot be used',
      })
    }
  })

  it('says something different when the service itself could not be reached', async () => {
    // Not the same as a refused link, and a person can act on the
    // difference: one is worth retrying, the other never will be.
    const p: ServicePoster = {
      post: async () => {
        throw new Error('network unreachable')
      },
    }
    const result = await claimInvitation(p, LINK)
    expect(result.claimed).toBe(false)
    if (!result.claimed) expect(result.reason).toContain('could not be reached')
  })

  it('refuses an answer that is missing any part of the session', async () => {
    // A partial session is worse than none: it would be stored, restored, and
    // fail later somewhere with no connection to this moment.
    for (const missing of ['user_id', 'device_id', 'access_token']) {
      const partial = JSON.parse(GRANTED) as Record<string, unknown>
      delete partial[missing]
      const p = poster(() => ({ status: 200, body: JSON.stringify(partial) }))
      const result = await claimInvitation(p, LINK)
      expect(result.claimed).toBe(false)
    }
  })

  it('refuses an answer that does not parse', async () => {
    const p = poster(() => ({ status: 200, body: 'not json' }))
    await expect(claimInvitation(p, LINK)).resolves.toHaveProperty(
      'claimed',
      false,
    )
  })
})
