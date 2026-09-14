import { describe, expect, it } from 'vitest'

import type { ServicePoster } from './claimInvitation'
import { enterWithASession } from './entry'
import type { RestoreCredentials } from './sessionCredentials'
import type { SecretStore } from './sessionStore'

const SESSION = {
  baseUrl: 'https://messagr.eu',
  userId: '@uvq:messagr.eu',
  deviceId: 'DEVICE1',
  accessToken: 'syt_secret',
}

const GRANTED = JSON.stringify({
  user_id: SESSION.userId,
  device_id: SESSION.deviceId,
  access_token: SESSION.accessToken,
  password: 'unused',
})

function store(initial: string | null = null): SecretStore {
  let held = initial
  return {
    read: async () => held,
    write: async v => {
      held = v
    },
  }
}

const granting: ServicePoster = {
  post: async () => ({ status: 200, body: GRANTED }),
}
const refusing: ServicePoster = {
  post: async () => ({ status: 404, body: '{"errcode":"M_NOT_FOUND"}' }),
}

/**
 * A poster that records every call it is asked to make, so a test can assert
 * not only what came back but whether anything was sent at all. The refusal
 * this module now makes for a link into another instance is a refusal to make
 * a request, and only a poster that would have noticed the request can prove
 * it was not made.
 */
function recordingPoster(
  answer: { status: number; body: string } = { status: 200, body: '{}' },
) {
  const calls: Array<{ url: string; body: string; bearer?: string }> = []
  return {
    calls,
    post: async (url: string, body: string, bearer?: string) => {
      calls.push({ url, body, bearer })
      return answer
    },
  }
}

/** An invitation into a server the held account does not live on. */
const ELSEWHERE = 'https://other.example/i/abc123'

/**
 * Everything a launch sends, whichever door it leaves by: the invitation
 * service's poster, and the calls leaving an account makes to a homeserver.
 *
 * One list rather than two, because the question a test about credentials
 * asks is where each request went and what it carried -- and a request that
 * went out of a door the test was not watching would answer it wrongly.
 */
function wire(claim: { status: number; body: string } = GRANTED_ELSEWHERE) {
  const calls: Array<{ url: string; body: string; bearer?: string }> = []
  return {
    calls,
    poster: {
      post: async (url: string, body: string, bearer?: string) => {
        calls.push({ url, body, bearer })
        return claim
      },
    },
    homeserver: (baseUrl: string) => ({
      post: async (path: string, body: unknown, bearer?: string) => {
        calls.push({
          url: `${baseUrl}${path}`,
          body: JSON.stringify(body),
          bearer,
        })
        return { status: 200, body: {} }
      },
    }),
  }
}

/** The account the other server hands a device that claims its link. */
const ENTERED_ELSEWHERE = {
  baseUrl: 'https://other.example',
  userId: '@new:other.example',
  deviceId: 'DEVICE2',
  accessToken: 'syt_elsewhere',
}

const GRANTED_ELSEWHERE = {
  status: 200,
  body: JSON.stringify({
    user_id: ENTERED_ELSEWHERE.userId,
    device_id: ENTERED_ELSEWHERE.deviceId,
    access_token: ENTERED_ELSEWHERE.accessToken,
    password: 'drawn-elsewhere',
  }),
}

/**
 * A device holding one account, and what forgetting that account does to it.
 *
 * The pushkey lives here too, and goes with the account, so a test can tell
 * whether it was read before it was forgotten.
 */
function holding(session: RestoreCredentials) {
  let kept: string | null = JSON.stringify(session)
  let pushkey: string | null = 'pushkey-of-this-device'
  const forgotten: string[] = []
  const secrets: SecretStore = {
    read: async () => kept,
    write: async value => {
      kept = value
    },
  }
  return {
    secrets,
    forgotten,
    kept: () => (kept === null ? null : (JSON.parse(kept) as unknown)),
    pusher: async () =>
      pushkey === null ? null : { token: pushkey, road: 'ios' as const },
    forget: async (account: RestoreCredentials) => {
      forgotten.push(account.userId)
      kept = null
      pushkey = null
    },
  }
}

/** The answer that changes nothing. */
const stays = async () => 'stay' as const

/** The answer that leaves the account for the link. */
const leaves = async () => 'leave' as const

/**
 * For an entry that never reaches the question. Asking fails the test, and so
 * does anything leaving would do: an entry that should not have asked, and
 * did, is exactly what these tests are for noticing.
 */
const nobodyAsked = {
  ask: async (): Promise<'leave' | 'stay'> => {
    throw new Error('this entry was not supposed to ask anybody anything')
  },
  leaving: {
    homeserver: () => ({
      post: async (): Promise<{ status: number; body: unknown }> => {
        throw new Error('this entry was not supposed to leave its account')
      },
    }),
    pusher: async () => null,
    forget: async () => {
      throw new Error('this entry was not supposed to forget an account')
    },
  },
}

/** The sign-up marker's own store, which every entry now writes through. */
function markerStore() {
  const written: string[] = []
  return {
    written,
    secrets: {
      read: async () => written[written.length - 1] ?? null,
      write: async (value: string) => {
        written.push(value)
      },
    },
  }
}

describe('enterWithASession', () => {
  it('spends an invitation for the account it already has, not against it', async () => {
    // THE ACCOUNT IS NEVER REPLACED, which is the rule, and it is not the
    // same rule as "throw the link away". The service's existing-user path
    // invites this account into the conversation the invitation was for.
    let sent: unknown = null
    let bearer: string | undefined
    const watching: ServicePoster = {
      post: async (_url, body, carried) => {
        sent = JSON.parse(body)
        bearer = carried
        return { status: 200, body: '{}' }
      },
    }
    const result = await enterWithASession({
      secrets: store(JSON.stringify(SESSION)),
      poster: watching,
      link: async () => 'https://messagr.eu/i/abc123',
      ...nobodyAsked,
      signUp: markerStore().secrets,
    })
    expect(result).toEqual({
      entered: true,
      session: SESSION,
      claimed: false,
      invitation: { kind: 'used' },
    })
    // Its own identifier, and the token. Nothing it holds is handed over.
    expect(sent).toEqual({
      token: 'abc123',
      existing_user_id: SESSION.userId,
    })
    // AND THE PROOF THAT IT IS THAT ACCOUNT. The service refuses this path
    // without it -- naming a third party would otherwise let anyone holding
    // a link have an arbitrary identifier invited into a real room.
    // Measured against the bench before it was sent: `401 M_UNAUTHORIZED`,
    // "unauthenticated caller".
    expect(bearer).toBe(SESSION.accessToken)
  })

  it('keeps the account when the person stays, and says why the link was not followed', async () => {
    // #304. A link into another server used to be refused outright, and a
    // device carrying an account from a server it had outlived could follow
    // no invitation at all -- a new link was refused the same way. Now the
    // person is asked, and staying is the answer that changes nothing: the
    // account and its conversations stay. What is sent is the rule of #279,
    // below.
    const sent = wire()
    const device = holding(SESSION)
    const result = await enterWithASession({
      secrets: device.secrets,
      poster: sent.poster,
      link: async () => ELSEWHERE,
      signUp: markerStore().secrets,
      ask: stays,
      leaving: { ...device, homeserver: sent.homeserver },
    })
    expect(result).toEqual({
      entered: true,
      session: SESSION,
      claimed: false,
      invitation: { kind: 'elsewhere' },
    })
    expect(device.kept()).toEqual(SESSION)
  })

  it('leaves the account, then claims the link as a device with no account', async () => {
    // The other answer. What this device keeps of the old account is
    // forgotten first, and the link is then claimed the way a telephone that
    // never had an account claims one: a new account, its password carried
    // out for #190, the sign-up marker written -- the ordinary first launch.
    const sent = wire()
    const device = holding(SESSION)
    const marker = markerStore()
    const result = await enterWithASession({
      secrets: device.secrets,
      poster: sent.poster,
      link: async () => ELSEWHERE,
      signUp: marker.secrets,
      ask: leaves,
      leaving: { ...device, homeserver: sent.homeserver },
    })
    expect(result).toEqual({
      entered: true,
      session: ENTERED_ELSEWHERE,
      claimed: true,
      password: 'drawn-elsewhere',
      left: { closing: expect.any(Promise) },
    })
    expect(device.forgotten).toEqual([SESSION.userId])
    // Kept after the old account was forgotten, not before: forgetting it
    // afterwards would have taken the new one too.
    expect(device.kept()).toEqual(ENTERED_ELSEWHERE)
    expect(marker.written).toEqual(['signing-up'])
  })

  it('names both servers when it asks', async () => {
    // Which two servers is the whole of what somebody decides on, so the
    // question carries them: the one this device's account lives on, and the
    // one the link leads to. Hosts as a person reads them, not URLs.
    const sent = wire()
    const device = holding(SESSION)
    const asked: Array<{ account: string; link: string }> = []
    await enterWithASession({
      secrets: device.secrets,
      poster: sent.poster,
      link: async () => ELSEWHERE,
      signUp: markerStore().secrets,
      ask: async hosts => {
        asked.push(hosts)
        return 'stay'
      },
      leaving: { ...device, homeserver: sent.homeserver },
    })
    expect(asked).toEqual([{ account: 'messagr.eu', link: 'other.example' }])
  })

  it('asks about another server reached through the application scheme too', async () => {
    // The application's own scheme names a host exactly as https does, so it
    // is held to the same rule: a link to another instance is a question
    // whichever scheme carried it.
    const sent = wire()
    const device = holding(SESSION)
    const result = await enterWithASession({
      secrets: device.secrets,
      poster: sent.poster,
      link: async () => 'messagr://other.example/i/abc123',
      signUp: markerStore().secrets,
      ask: stays,
      leaving: { ...device, homeserver: sent.homeserver },
    })
    expect(sent.calls).toEqual([])
    expect(result.entered && result.invitation).toEqual({ kind: 'elsewhere' })
  })

  it('asks about the account server named on a different port', async () => {
    // A bench on another port is another instance. The host matching is not
    // enough on its own.
    const sent = wire()
    const device = holding(SESSION)
    const result = await enterWithASession({
      secrets: device.secrets,
      poster: sent.poster,
      link: async () => 'https://messagr.eu:8448/i/abc123',
      signUp: markerStore().secrets,
      ask: stays,
      leaving: { ...device, homeserver: sent.homeserver },
    })
    expect(sent.calls).toEqual([])
    expect(result.entered && result.invitation).toEqual({ kind: 'elsewhere' })
  })

  it('spends a link that names the account server through the application scheme', async () => {
    // Same instance, the operating system's own scheme: the ordinary path,
    // and the token is what proves the account.
    const poster = recordingPoster()
    const result = await enterWithASession({
      secrets: store(JSON.stringify(SESSION)),
      poster,
      link: async () => 'messagr://messagr.eu/i/abc123',
      ...nobodyAsked,
      signUp: markerStore().secrets,
    })
    expect(poster.calls).toHaveLength(1)
    expect(poster.calls[0]?.bearer).toBe(SESSION.accessToken)
    expect(result.entered && result.invitation).toEqual({ kind: 'used' })
  })

  it('spends a link whose host differs only in case', async () => {
    // A capitalised host is the same instance as the stored session, so this
    // is the unchanged path: the account is invited and its token is sent.
    const poster = recordingPoster()
    const result = await enterWithASession({
      secrets: store(JSON.stringify(SESSION)),
      poster,
      link: async () => 'https://MESSAGR.EU/i/abc123',
      ...nobodyAsked,
      signUp: markerStore().secrets,
    })
    expect(poster.calls).toHaveLength(1)
    expect(poster.calls[0]?.bearer).toBe(SESSION.accessToken)
    expect(poster.calls[0]?.url).toBe(
      'https://messagr.eu/_messagr/invitations/claim',
    )
    expect(result.entered && result.invitation).toEqual({ kind: 'used' })
  })

  it('spends a link that names the account server with its default port explicit', async () => {
    // `:443` on an https link is the same instance as the same host without it,
    // so this is allowed and the token is sent -- the request simply carries
    // the port the link spelled out.
    const poster = recordingPoster()
    const result = await enterWithASession({
      secrets: store(JSON.stringify(SESSION)),
      poster,
      link: async () => 'https://messagr.eu:443/i/abc123',
      ...nobodyAsked,
      signUp: markerStore().secrets,
    })
    expect(poster.calls).toHaveLength(1)
    expect(poster.calls[0]?.bearer).toBe(SESSION.accessToken)
    expect(result.entered && result.invitation).toEqual({ kind: 'used' })
  })

  it('says so when the link could not be used, and keeps the session', async () => {
    const saysNo: ServicePoster = {
      post: async () => ({ status: 404, body: '{}' }),
    }
    const result = await enterWithASession({
      secrets: store(JSON.stringify(SESSION)),
      poster: saysNo,
      link: async () => 'https://messagr.eu/i/abc123',
      ...nobodyAsked,
      signUp: markerStore().secrets,
    })
    expect(result).toEqual({
      entered: true,
      session: SESSION,
      claimed: false,
      invitation: { kind: 'refused', reason: 'this invitation cannot be used' },
    })
  })

  it('asks the service nothing when the link is not an invitation', async () => {
    // Opening the application from its icon is this, every time. A call per
    // launch to say "there was no link" would be a call per launch.
    let posted = false
    const watching: ServicePoster = {
      post: async () => {
        posted = true
        return { status: 200, body: '{}' }
      },
    }
    const result = await enterWithASession({
      secrets: store(JSON.stringify(SESSION)),
      poster: watching,
      link: async () => null,
      ...nobodyAsked,
      signUp: markerStore().secrets,
    })
    expect(result).toEqual({ entered: true, session: SESSION, claimed: false })
    expect(posted).toBe(false)
  })

  it('says nothing about an invitation when the launch carried none', async () => {
    // The opposite direction, so the flag cannot become "there is a session",
    // which is every ordinary launch and would put a notice on all of them.
    const result = await enterWithASession({
      secrets: store(JSON.stringify(SESSION)),
      poster: { post: async () => ({ status: 200, body: GRANTED }) },
      link: async () => null,
      ...nobodyAsked,
      signUp: markerStore().secrets,
    })
    expect(result).toEqual({ entered: true, session: SESSION, claimed: false })
  })

  it('says nothing when the link is not an invitation', async () => {
    const result = await enterWithASession({
      secrets: store(JSON.stringify(SESSION)),
      poster: { post: async () => ({ status: 200, body: GRANTED }) },
      link: async () => 'https://messagr.eu/about',
      ...nobodyAsked,
      signUp: markerStore().secrets,
    })
    expect(result).toEqual({ entered: true, session: SESSION, claimed: false })
  })

  it('claims the link when there is no session yet, and keeps what it gets', async () => {
    const secrets = store()
    const result = await enterWithASession({
      secrets,
      poster: granting,
      link: async () => 'https://messagr.eu/i/abc123',
      ...nobodyAsked,
      signUp: markerStore().secrets,
    })
    expect(result).toEqual({
      entered: true,
      session: SESSION,
      claimed: true,
      // Carried out of the claim rather than kept here: #190 needs it to
      // come back as a new device after a reinstall, and this module decides
      // entry rather than where a credential lives.
      password: 'unused',
    })
    // Kept, or the next launch claims again and finds the token spent.
    expect(JSON.parse((await secrets.read()) ?? '')).toEqual(SESSION)
  })

  it('reports having no way in when there is neither a session nor a link', async () => {
    const result = await enterWithASession({
      secrets: store(),
      poster: granting,
      link: async () => null,
      ...nobodyAsked,
      signUp: markerStore().secrets,
    })
    expect(result).toEqual({
      entered: false,
      reason:
        'this device has no session and was not opened with an invitation',
    })
  })

  it('carries the refusal when the link cannot be used', async () => {
    const result = await enterWithASession({
      secrets: store(),
      poster: refusing,
      link: async () => 'https://messagr.eu/i/abc123',
      ...nobodyAsked,
      signUp: markerStore().secrets,
    })
    expect(result.entered).toBe(false)
    if (!result.entered) {
      expect(result.reason).toBe('this invitation cannot be used')
    }
  })

  it('refuses a link it cannot read as an invitation', async () => {
    const result = await enterWithASession({
      secrets: store(),
      poster: granting,
      link: async () => 'https://messagr.eu/about',
      ...nobodyAsked,
      signUp: markerStore().secrets,
    })
    expect(result.entered).toBe(false)
  })

  it('still enters when the session could not be kept, and says so', async () => {
    // The account exists either way: the token was spent. Refusing to enter
    // would waste an invitation that has already been consumed.
    const unwritable: SecretStore = {
      read: async () => null,
      write: async () => {
        throw new Error('keystore full')
      },
    }
    const result = await enterWithASession({
      secrets: unwritable,
      poster: granting,
      link: async () => 'https://messagr.eu/i/abc123',
      ...nobodyAsked,
      signUp: markerStore().secrets,
    })
    expect(result).toEqual({
      entered: true,
      session: SESSION,
      claimed: true,
      kept: false,
      password: 'unused',
    })
  })

  it('records that a sign-up began, when one did', async () => {
    // The entitlement a later launch needs to finish a publication this one
    // may not complete. Written at the claim, because that is when the
    // sign-up starts.
    const marker = markerStore()
    await enterWithASession({
      secrets: store(),
      poster: granting,
      link: async () => 'https://messagr.eu/i/abc123',
      ...nobodyAsked,
      signUp: marker.secrets,
    })
    expect(marker.written).toEqual(['signing-up'])
  })

  it('records nothing when a session was merely restored', async () => {
    // A restore is not a sign-up. Marking one would hand a later launch the
    // entitlement to overwrite an identity that is working.
    const marker = markerStore()
    await enterWithASession({
      secrets: store(JSON.stringify(SESSION)),
      poster: granting,
      link: async () => null,
      ...nobodyAsked,
      signUp: marker.secrets,
    })
    expect(marker.written).toEqual([])
  })

  it('enters even when the marker could not be written', async () => {
    // The account exists and the token is spent. Refusing over a marker
    // would throw away an invitation that cannot be spent again, and what is
    // lost is smaller: a later launch's ability to finish an interrupted
    // publication.
    const result = await enterWithASession({
      secrets: store(),
      poster: granting,
      link: async () => 'https://messagr.eu/i/abc123',
      ...nobodyAsked,
      signUp: {
        read: async () => null,
        write: async () => {
          throw new Error('keystore full')
        },
      },
    })
    expect(result.entered).toBe(true)
  })
})

describe('the rule of #279, whichever the answer', () => {
  // AN ACCOUNT'S CREDENTIALS GO TO ITS OWN SERVER AND TO NO OTHER. #304 turned
  // the refusal into a question, and this is the part that must not move with
  // it: neither answer may carry the held account's token, or any
  // authenticated request at all, towards the server the link names.
  //
  // Read off one wire that sees every door a request can leave by -- the
  // invitation service's poster and the homeserver calls leaving makes -- so a
  // request cannot escape the assertion by taking the other door.

  it('lets no request leave when the person stays', async () => {
    const sent = wire()
    const device = holding(SESSION)
    await enterWithASession({
      secrets: device.secrets,
      poster: sent.poster,
      link: async () => ELSEWHERE,
      signUp: markerStore().secrets,
      ask: stays,
      leaving: { ...device, homeserver: sent.homeserver },
    })
    expect(sent.calls).toEqual([])
  })

  it('sends nothing authenticated towards the link when the person leaves, and the old token only home', async () => {
    const sent = wire()
    const device = holding(SESSION)
    const result = await enterWithASession({
      secrets: device.secrets,
      poster: sent.poster,
      link: async () => ELSEWHERE,
      signUp: markerStore().secrets,
      ask: leaves,
      leaving: { ...device, homeserver: sent.homeserver },
    })
    // Every request leaving started, answered, so none is still to come.
    await result.left?.closing

    const carriesTheAccount = (call: { body: string; bearer?: string }) =>
      call.bearer === SESSION.accessToken ||
      call.body.includes(SESSION.accessToken)

    const towardsTheLink = sent.calls.filter(call =>
      call.url.startsWith('https://other.example/'),
    )
    expect(
      towardsTheLink.filter(
        call => call.bearer !== undefined || carriesTheAccount(call),
      ),
    ).toEqual([])
    expect(
      sent.calls
        .filter(carriesTheAccount)
        .filter(call => !call.url.startsWith('https://messagr.eu/')),
    ).toEqual([])

    // And the wire saw both sides, so the two assertions above are about
    // requests that were made rather than about a silence.
    expect(sent.calls.map(call => call.url)).toEqual(
      expect.arrayContaining([
        'https://messagr.eu/_matrix/client/v3/logout',
        'https://other.example/_messagr/invitations/claim',
      ]),
    )
  })
})
