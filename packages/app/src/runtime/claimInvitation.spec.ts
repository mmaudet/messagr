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

describe('claimInvitation, the two-call handshake', () => {
  const HANDSHAKE_LINK = {
    token: 'a-token',
    homeserver: 'https://messagr.eu',
    service: 'https://messagr.eu/_messagr',
  }
  const SESSION = JSON.stringify({
    user_id: '@her:messagr.eu',
    device_id: 'DEV',
    access_token: 'tok',
  })

  function scriptedPoster(
    answers: readonly { status: number; body: string }[],
  ) {
    let asked = 0
    return {
      calls: () => asked,
      post: async () => {
        const answer = answers[Math.min(asked, answers.length - 1)]!
        asked += 1
        return answer
      },
    }
  }

  it('claims again after a 409, which is the middle of the handshake', async () => {
    // The service draws an account on the first claim and answers 409 because
    // that account is in no conversation yet. The issuer's application invites
    // it; the second claim is what turns that into a session.
    const service = scriptedPoster([
      { status: 409, body: '{"errcode":"MESSAGR_NOT_YET_INVITED"}' },
      { status: 200, body: SESSION },
    ])
    const claim = await claimInvitation(service, HANDSHAKE_LINK, async () => {})
    expect(claim.claimed).toBe(true)
    expect(service.calls()).toBe(2)
  })

  it('keeps asking while nobody has let the account in', async () => {
    const service = scriptedPoster([
      { status: 409, body: '{}' },
      { status: 409, body: '{}' },
      { status: 409, body: '{}' },
      { status: 200, body: SESSION },
    ])
    expect(
      (await claimInvitation(service, HANDSHAKE_LINK, async () => {})).claimed,
    ).toBe(true)
    expect(service.calls()).toBe(4)
  })

  it('gives up saying nobody let it in, not that the link is unusable', async () => {
    // The distinction is what a person does next. A refused link means ask
    // for another one; this means the other person's application has not
    // finished, and another link would fail the same way.
    const service = scriptedPoster([{ status: 409, body: '{}' }])
    const claim = await claimInvitation(service, HANDSHAKE_LINK, async () => {})
    expect(claim).toEqual({
      claimed: false,
      reason: 'nobody has let this account in yet',
    })
  })

  it('does not retry a refusal, which is final', async () => {
    const service = scriptedPoster([{ status: 403, body: '{}' }])
    await claimInvitation(service, HANDSHAKE_LINK, async () => {})
    expect(service.calls()).toBe(1)
  })

  it('asks once when given no way to wait, rather than bursting', async () => {
    // A caller with nothing to pause with cannot mean to keep asking:
    // fifteen calls in as many milliseconds is not patience. `entry.ts`
    // passes a real wait on a device and nothing in a test does.
    const service = scriptedPoster([{ status: 409, body: '{}' }])
    await claimInvitation(service, HANDSHAKE_LINK)
    expect(service.calls()).toBe(1)
  })
})
