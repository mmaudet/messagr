import { describe, expect, it } from 'vitest'

import { claimInvitation, type ServicePoster } from './claimInvitation'

const LINK = {
  token: 'abc123',
  homeserver: 'https://messagr.eu',
  service: 'https://messagr.eu/_messagr',
  // The name its writer gave themselves (#329). Carried by the link and read
  // by nothing here on purpose: a claim sends the token and the token alone,
  // and the assertions below are what hold that.
  declared: 'Nadia',
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
  it('NEVER sends the name the link carries, to anybody', async () => {
    // #329, AND THIS IS THE ASSERTION THE PRIVACY PAGE RESTS ON. A declared
    // name travels in the link's fragment, which no request carries; this is
    // the one place in the application that could put it back into one, by
    // reading it off the parsed link and adding it to the body. `LINK` above
    // carries a name, and the whole body is compared rather than a field of
    // it -- a test asking only « is `declared` absent » would pass over a
    // name sent under some other key.
    const p = poster(() => ({ status: 200, body: GRANTED }))
    await claimInvitation(p, LINK)
    expect(p.calls.map(call => call.body)).toEqual([
      JSON.stringify({ token: 'abc123' }),
    ])
    for (const call of p.calls) {
      expect(call.url).not.toContain('Nadia')
      expect(call.body).not.toContain('Nadia')
    }
  })

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
      password: 'a-password-nobody-asked-for',
    })
  })

  it('carries the password, and this used to be a test that it did not', async () => {
    // THE DECISION CHANGED, so the test that pinned the old one is rewritten
    // rather than deleted. It read: "a restored session needs the triple and
    // nothing else. Keeping the password would be holding a second
    // credential that nothing here uses and that could be lost."
    //
    // Right about restoring a session, and silent about replacing one. #190:
    // an iOS reinstall leaves the keychain and takes the crypto store, so a
    // launch that carried on republished fresh identity keys under a device
    // identifier the homeserver already knew -- the shape of an attack. What
    // fixes it is coming back as a NEW device, and only a password can make
    // one: measured against the homeserver, a token cannot.
    //
    // `recoverySecret.ts` is the only thing that keeps it and `reenter.ts` is
    // the only thing that spends it.
    const p = poster(() => ({ status: 200, body: GRANTED }))
    const result = await claimInvitation(p, LINK)
    expect(result.claimed && result.password).toBe(
      'a-password-nobody-asked-for',
    )
  })

  it('is content with a service that sends no password', async () => {
    // The session is what entry needs; the password is what recovery needs.
    // A service that sends none leaves this working and that device with no
    // way back from a reinstall, which is the behaviour there was before.
    const p = poster(() => ({
      status: 200,
      body: JSON.stringify({
        user_id: '@uvq:messagr.eu',
        device_id: 'DEVICE1',
        access_token: 'syt_secret',
      }),
    }))
    const result = await claimInvitation(p, LINK)
    expect(result.claimed).toBe(true)
    expect(result.claimed && result.password).toBeUndefined()
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

  it('says the same when the service answers with a failure of its own', async () => {
    // #306. nginx answers 502 while the service restarts, and the service
    // answers 503 while its homeserver is away. Neither says anything about
    // the link, which may be perfectly good, and opening it again tries again.
    const failures = [
      { status: 502, body: '<html><h1>502 Bad Gateway</h1></html>' },
      { status: 503, body: '{"errcode":"MESSAGR_UPSTREAM"}' },
      { status: 500, body: '{"errcode":"M_UNKNOWN"}' },
      { status: 504, body: '<html><h1>504 Gateway Time-out</h1></html>' },
    ]
    for (const failure of failures) {
      const p = poster(() => failure)
      expect(await claimInvitation(p, LINK)).toEqual({
        claimed: false,
        reason: 'the invitation service could not be reached',
      })
    }
  })

  it('still gives the one refusal for every 4xx, whichever it is', async () => {
    // Only the 5xx moved (#306). Malformed, unauthenticated, revoked, unknown,
    // expired or spent, and too many at once: telling any of them apart would
    // start rebuilding the oracle `REFUSED` refuses to be.
    for (const status of [400, 401, 403, 404, 410, 429]) {
      const p = poster(() => ({ status, body: '{}' }))
      expect(await claimInvitation(p, LINK)).toEqual({
        claimed: false,
        reason: 'this invitation cannot be used',
      })
    }
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
    declared: null,
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
