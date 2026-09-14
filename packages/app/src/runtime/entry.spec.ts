import { describe, expect, it } from 'vitest'

import type { ServicePoster } from './claimInvitation'
import { enterWithASession, type OtherServer } from './entry'
import type { Departure } from './leaveAccount'
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
 * not only what came back but whether anything was sent at all.
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

/**
 * For an entry that never reaches the question. Asking fails the test, and so
 * does anything leaving would do: an entry that should not have asked, and
 * did, is exactly what these tests are for noticing.
 */
const nobodyAsked: { readonly otherServer: OtherServer } = {
  otherServer: {
    ask: async () => {
      throw new Error('this entry was not supposed to ask anybody anything')
    },
    aMachineIsRunning: () => {
      throw new Error('this entry was not supposed to look for a machine')
    },
    departure: {
      pusher: async () => null,
      stopWaking: async () => {
        throw new Error('this entry was not supposed to leave its account')
      },
      logOut: async () => {
        throw new Error('this entry was not supposed to leave its account')
      },
      forgetPassword: async () => {
        throw new Error('this entry was not supposed to forget a password')
      },
      forget: async () => {
        throw new Error('this entry was not supposed to forget an account')
      },
    },
  },
}

/** An invitation into a server the held account does not live on. */
const ELSEWHERE = 'https://other.example/i/abc123'

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

type Call = { url: string; body: string; bearer?: string }

/**
 * A device holding one account, and everything a launch can send from it.
 *
 * The keystore is modelled entry by entry -- the session, the sign-up marker,
 * the password, the pushkey, and one entry standing for everything else the
 * account keeps -- because what these tests ask is which entries are still
 * there afterwards, and whose they are.
 *
 * Every request leaves through `calls`, whichever door it takes: the
 * invitation service's poster, or the pusher and session calls leaving makes
 * on the server named by the account they carry. One list, so a request cannot
 * escape an assertion by taking the other door.
 */
function device(
  options: {
    readonly claim?: { status: number; body: string } | 'unreachable'
    readonly sessionWrite?: 'refused'
  } = {},
) {
  const calls: Call[] = []
  const forgotten: string[] = []
  // What the password entry held when a session was written, and when the
  // old account began to be forgotten.
  const passwordWhenSessionKept: Array<string | null> = []
  const passwordWhenForgetting: Array<string | null> = []
  let session: string | null = JSON.stringify(SESSION)
  let marker: string | null = null
  let password: string | null = 'old-password'
  let pushkey: string | null = 'pushkey-of-this-device'
  let rest: string | null = 'the-rest-of-the-old-account'

  const secrets: SecretStore = {
    read: async () => session,
    write: async value => {
      if (options.sessionWrite === 'refused') throw new Error('keystore full')
      passwordWhenSessionKept.push(password)
      session = value
    },
  }
  const signUp: SecretStore = {
    read: async () => marker,
    write: async value => {
      marker = value
    },
  }
  const recovery: SecretStore = {
    read: async () => password,
    write: async value => {
      password = value
    },
  }
  const poster: ServicePoster = {
    post: async (url, body, bearer) => {
      calls.push({ url, body, bearer })
      if (options.claim === 'unreachable') {
        throw new Error('network is unreachable')
      }
      return options.claim ?? GRANTED_ELSEWHERE
    },
  }
  const departure: Departure = {
    pusher: async () =>
      pushkey === null ? null : { token: pushkey, road: 'ios' },
    stopWaking: async (account, pusher) => {
      calls.push({
        url: `${account.baseUrl}/_matrix/client/v3/pushers/set`,
        body: JSON.stringify({ pushkey: pusher.token, kind: null }),
        bearer: account.accessToken,
      })
    },
    logOut: async account => {
      calls.push({
        url: `${account.baseUrl}/_matrix/client/v3/logout`,
        body: '{}',
        bearer: account.accessToken,
      })
    },
    forgetPassword: async () => {
      forgotten.push('the old password')
      password = null
    },
    forget: async (account, keeping) => {
      forgotten.push(account.userId)
      passwordWhenForgetting.push(password)
      if (!keeping.includes(secrets)) session = null
      if (!keeping.includes(signUp)) marker = null
      if (!keeping.includes(recovery)) password = null
      pushkey = null
      rest = null
    },
  }

  return {
    calls,
    forgotten,
    passwordWhenSessionKept,
    passwordWhenForgetting,
    secrets,
    signUp,
    recovery,
    poster,
    departure,
    held: () => ({
      session: session === null ? null : (JSON.parse(session) as unknown),
      marker,
      password,
      pushkey,
      rest,
    }),
  }
}

/** The question, answered once, remembering the two servers it named. */
function answering(
  answer: 'leave' | 'stay',
  here: ReturnType<typeof device>,
  aMachineIsRunning: () => boolean = () => false,
) {
  const asked: Array<{ account: string; link: string }> = []
  const otherServer: OtherServer = {
    ask: async hosts => {
      asked.push(hosts)
      return answer
    },
    aMachineIsRunning,
    departure: here.departure,
  }
  return { asked, otherServer }
}

/** An entry on `here`, opened with `link`. */
function entering(
  here: ReturnType<typeof device>,
  otherServer: OtherServer | null,
  link: string = ELSEWHERE,
) {
  return enterWithASession({
    secrets: here.secrets,
    poster: here.poster,
    link: async () => link,
    signUp: here.signUp,
    recovery: here.recovery,
    otherServer,
  })
}

/** Everything the old account left on the device, as it was before. */
const UNTOUCHED = {
  session: SESSION,
  marker: null,
  password: 'old-password',
  pushkey: 'pushkey-of-this-device',
  rest: 'the-rest-of-the-old-account',
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
      recovery: store(),
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
      recovery: store(),
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
      recovery: store(),
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
      recovery: store(),
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
      recovery: store(),
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
      recovery: store(),
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
      recovery: store(),
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
      recovery: store(),
    })
    expect(result).toEqual({ entered: true, session: SESSION, claimed: false })
  })

  it('claims the link when there is no session yet, and keeps what it gets', async () => {
    const secrets = store()
    const recovery = store()
    const result = await enterWithASession({
      secrets,
      poster: granting,
      link: async () => 'https://messagr.eu/i/abc123',
      ...nobodyAsked,
      signUp: markerStore().secrets,
      recovery,
    })
    expect(result).toEqual({
      entered: true,
      session: SESSION,
      claimed: true,
      passwordKept: true,
    })
    // Kept, or the next launch claims again and finds the token spent.
    expect(JSON.parse((await secrets.read()) ?? '')).toEqual(SESSION)
    // And its password beside it, kept here and handed to nobody: #190 needs
    // it to come back as a new device after a reinstall, and a caller that
    // wrote it again would be a second moment it could land beside the wrong
    // session.
    expect(await recovery.read()).toBe('unused')
  })

  it('says so when the password could not be kept', async () => {
    const result = await enterWithASession({
      secrets: store(),
      poster: granting,
      link: async () => 'https://messagr.eu/i/abc123',
      ...nobodyAsked,
      signUp: markerStore().secrets,
      recovery: {
        read: async () => null,
        write: async () => {
          throw new Error('keystore full')
        },
      },
    })
    expect(result.entered && result.passwordKept).toBe(false)
  })

  it('reports having no way in when there is neither a session nor a link', async () => {
    const result = await enterWithASession({
      secrets: store(),
      poster: granting,
      link: async () => null,
      ...nobodyAsked,
      signUp: markerStore().secrets,
      recovery: store(),
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
      recovery: store(),
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
      recovery: store(),
    })
    expect(result.entered).toBe(false)
  })

  it('still enters when the session could not be kept, and says so', async () => {
    // The account exists either way: the token was spent. Refusing to enter
    // would waste an invitation that has already been consumed. Its password
    // is not kept, since there is no session for it to go with.
    const unwritable: SecretStore = {
      read: async () => null,
      write: async () => {
        throw new Error('keystore full')
      },
    }
    const recovery = store()
    const result = await enterWithASession({
      secrets: unwritable,
      poster: granting,
      link: async () => 'https://messagr.eu/i/abc123',
      ...nobodyAsked,
      signUp: markerStore().secrets,
      recovery,
    })
    expect(result).toEqual({
      entered: true,
      session: SESSION,
      claimed: true,
      kept: false,
    })
    expect(await recovery.read()).toBeNull()
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
      recovery: store(),
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
      recovery: store(),
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
      recovery: store(),
    })
    expect(result.entered).toBe(true)
  })
})

describe('a link into another server (#304)', () => {
  it('keeps the account when the person stays, and says why the link was not followed', async () => {
    // A link into another server used to be refused outright, and a device
    // carrying an account from a server it had outlived could follow no
    // invitation at all. Now the person is asked, and staying is the answer
    // that changes nothing.
    const here = device()
    const { otherServer } = answering('stay', here)
    const result = await entering(here, otherServer)
    expect(result).toEqual({
      entered: true,
      session: SESSION,
      claimed: false,
      invitation: { kind: 'elsewhere' },
    })
    expect(here.held()).toEqual(UNTOUCHED)
  })

  it('names both servers when it asks', async () => {
    // Which two servers is the whole of what somebody decides on, so the
    // question carries them: the one this device's account lives on, and the
    // one the link leads to. Hosts as a person reads them, not URLs.
    const here = device()
    const { asked, otherServer } = answering('stay', here)
    await entering(here, otherServer)
    expect(asked).toEqual([{ account: 'messagr.eu', link: 'other.example' }])
  })

  it('asks about another server reached through the application scheme too', async () => {
    // The application's own scheme names a host exactly as https does, so it
    // is held to the same rule.
    const here = device()
    const { otherServer } = answering('stay', here)
    const result = await entering(
      here,
      otherServer,
      'messagr://other.example/i/abc123',
    )
    expect(result.entered && result.invitation).toEqual({ kind: 'elsewhere' })
  })

  it('asks about the account server named on a different port', async () => {
    // A bench on another port is another instance. The host matching is not
    // enough on its own.
    const here = device()
    const { otherServer } = answering('stay', here)
    const result = await entering(
      here,
      otherServer,
      'https://messagr.eu:8448/i/abc123',
    )
    expect(result.entered && result.invitation).toEqual({ kind: 'elsewhere' })
  })

  it('asks nothing about a link handed to a running application, and says to reopen it', async () => {
    // Decided on 14 September 2026: the account changes only at a cold
    // launch. So nothing is asked, forgotten or claimed, and the list says to
    // close Messagr completely and open the link again.
    const here = device()
    const result = await entering(here, null)
    expect(result).toEqual({
      entered: true,
      session: SESSION,
      claimed: false,
      invitation: { kind: 'reopen' },
    })
    expect(here.calls).toEqual([])
    expect(here.held()).toEqual(UNTOUCHED)
  })

  it('asks nothing, and says to reopen, when this context already holds a crypto machine', async () => {
    // A process a wake started holds the old account's machine before any
    // screen opens, and the next account would need a second one beside it.
    const here = device()
    const { asked, otherServer } = answering('leave', here, () => true)
    const result = await entering(here, otherServer)
    expect(result.entered && result.invitation).toEqual({ kind: 'reopen' })
    expect(asked).toEqual([])
    expect(here.calls).toEqual([])
  })

  it('claims nothing, and says to reopen, when a crypto machine started while the question waited', async () => {
    // Read again after the answer: a wake can start the old account's machine
    // while somebody is still reading. A yes that finds one running cannot be
    // carried out, and nothing of it is begun.
    const here = device()
    let machine = false
    const otherServer: OtherServer = {
      ask: async () => {
        machine = true
        return 'leave'
      },
      aMachineIsRunning: () => machine,
      departure: here.departure,
    }
    const result = await entering(here, otherServer)
    expect(result).toEqual({
      entered: true,
      session: SESSION,
      claimed: false,
      invitation: { kind: 'reopen' },
    })
    expect(here.calls).toEqual([])
    expect(here.held()).toEqual(UNTOUCHED)
  })

  it('leaves the old account untouched when the claim is refused, and tells the old server nothing', async () => {
    // CLAIMED BEFORE ANYTHING ELSE (14 September 2026). A link that turns out
    // to be spent or revoked must not cost somebody the account they had, and
    // the list says so at once.
    const here = device({ claim: { status: 404, body: '{}' } })
    const { otherServer } = answering('leave', here)
    const result = await entering(here, otherServer)
    expect(result).toEqual({
      entered: true,
      session: SESSION,
      claimed: false,
      invitation: { kind: 'retry', reason: 'this invitation cannot be used' },
    })
    expect(here.held()).toEqual(UNTOUCHED)
    expect(here.calls.map(call => call.url)).toEqual([
      'https://other.example/_messagr/invitations/claim',
    ])
  })

  it('leaves the old account untouched when the invitation service cannot be reached', async () => {
    const here = device({ claim: 'unreachable' })
    const { otherServer } = answering('leave', here)
    const result = await entering(here, otherServer)
    expect(result).toEqual({
      entered: true,
      session: SESSION,
      claimed: false,
      invitation: {
        kind: 'retry',
        reason: 'the invitation service could not be reached',
      },
    })
    expect(here.held()).toEqual(UNTOUCHED)
  })

  it('forgets the old account once the claim succeeds, and keeps the new one', async () => {
    // The new account is kept first -- its session, then its password, since
    // its token is spent and its password is what a reinstall needs -- and
    // what the old account left is forgotten afterwards, sparing the three
    // entries the new account has written. The old server is told last, with
    // what was held in memory.
    const here = device()
    const { otherServer } = answering('leave', here)
    const result = await entering(here, otherServer)
    expect(result).toEqual({
      entered: true,
      session: ENTERED_ELSEWHERE,
      claimed: true,
      passwordKept: true,
      left: { closing: expect.any(Promise) },
    })
    expect(here.held()).toEqual({
      session: ENTERED_ELSEWHERE,
      marker: 'signing-up',
      password: 'drawn-elsewhere',
      pushkey: null,
      rest: null,
    })
    await (result.entered ? result.left?.closing : undefined)
    expect(here.calls.map(call => [call.url, call.bearer])).toEqual([
      ['https://other.example/_messagr/invitations/claim', undefined],
      ['https://messagr.eu/_matrix/client/v3/pushers/set', 'syt_secret'],
      ['https://messagr.eu/_matrix/client/v3/logout', 'syt_secret'],
    ])
  })

  it('keeps the new password before it forgets anything of the old account', async () => {
    // Forgetting takes a while -- a dozen keystore entries, a notebook, a
    // crypto store -- and a stop in the middle of it must find the new account
    // whole. Without its password, and with no crypto store yet, the next
    // launch would find it stranded.
    const here = device()
    const { otherServer } = answering('leave', here)
    await entering(here, otherServer)
    expect(here.passwordWhenForgetting).toEqual(['drawn-elsewhere'])
  })

  it('has already forgotten the old password when it keeps the new session', async () => {
    // A stop between the two would otherwise leave the old account's password
    // beside the new account's session, and a launch that then finds no crypto
    // store re-enters with the password it holds -- on the new account's
    // server. That is #279 broken by a crash, so the password goes first.
    const here = device()
    const { otherServer } = answering('leave', here)
    await entering(here, otherServer)
    expect(here.passwordWhenSessionKept).toEqual([null])
  })

  it('goes back to the old account when the new session could not be kept', async () => {
    // A keystore that refuses the new session keeps the old one, and the old
    // account is then the only one this device can hold. So this launch stays
    // on it -- running the new account from memory would write its sync and
    // its notebook into what the old account left -- and the list says the
    // link could not be followed. Only the old password is gone: it went
    // first, for the reason the test above gives.
    const here = device({ sessionWrite: 'refused' })
    const { otherServer } = answering('leave', here)
    const result = await entering(here, otherServer)
    expect(result).toEqual({
      entered: true,
      session: SESSION,
      claimed: false,
      invitation: {
        kind: 'retry',
        reason: 'this device could not keep the new account',
      },
    })
    expect(here.forgotten).toEqual(['the old password'])
    expect(here.calls.map(call => call.url)).toEqual([
      'https://other.example/_messagr/invitations/claim',
    ])
  })

  it('never leaves a password of the new account beside the old session', async () => {
    // A launch that re-enters after a reinstall sends the password it holds
    // to the server of the session it holds. The new account's password beside
    // the old session would go to the old server.
    const here = device({ sessionWrite: 'refused' })
    const { otherServer } = answering('leave', here)
    await entering(here, otherServer)
    const { session, password } = here.held()
    expect({ session, password }).toEqual({ session: SESSION, password: null })
  })
})

describe('the rule of #279, whichever the answer', () => {
  // AN ACCOUNT'S CREDENTIALS GO TO ITS OWN SERVER AND TO NO OTHER. #304 turned
  // the refusal into a question, and this is the part that must not move with
  // it: neither answer may carry the held account's token, or any
  // authenticated request at all, towards the server the link names.
  //
  // Read off one list that sees every door a request can leave by, so a
  // request cannot escape the assertion by taking the other door.

  it('lets no request leave when the person stays', async () => {
    const here = device()
    const { otherServer } = answering('stay', here)
    await entering(here, otherServer)
    expect(here.calls).toEqual([])
  })

  it('sends nothing authenticated towards the link when the person leaves, and the old token only home', async () => {
    const here = device()
    const { otherServer } = answering('leave', here)
    const result = await entering(here, otherServer)
    // Every request leaving started, answered, so none is still to come.
    await (result.entered ? result.left?.closing : undefined)

    const carriesTheAccount = (call: Call) =>
      call.bearer === SESSION.accessToken ||
      call.body.includes(SESSION.accessToken)

    const towardsTheLink = here.calls.filter(call =>
      call.url.startsWith('https://other.example/'),
    )
    expect(
      towardsTheLink.filter(
        call => call.bearer !== undefined || carriesTheAccount(call),
      ),
    ).toEqual([])
    expect(
      here.calls
        .filter(carriesTheAccount)
        .filter(call => !call.url.startsWith('https://messagr.eu/')),
    ).toEqual([])

    // And the list saw both sides, so the two assertions above are about
    // requests that were made rather than about a silence.
    expect(here.calls.map(call => call.url)).toEqual(
      expect.arrayContaining([
        'https://messagr.eu/_matrix/client/v3/logout',
        'https://other.example/_messagr/invitations/claim',
      ]),
    )
  })
})
