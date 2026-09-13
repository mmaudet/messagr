import { describe, expect, it } from 'vitest'

import type { ServicePoster } from './claimInvitation'
import { enterWithASession } from './entry'
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

/** The one sentence the log carries for a link into another instance. */
const OTHER_SERVER =
  'this invitation is for a different server than this account'

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

  it('sends nothing to a link that names another server, and refuses it', async () => {
    // A held account's token authenticates the claim, and the link names where
    // that claim is sent. A link into an instance this account does not live
    // on is refused before any request leaves: the recording poster is never
    // called, and the outcome is one the list already draws.
    const poster = recordingPoster()
    const result = await enterWithASession({
      secrets: store(JSON.stringify(SESSION)),
      poster,
      link: async () => 'https://other.example/i/abc123',
      signUp: markerStore().secrets,
    })
    expect(poster.calls).toEqual([])
    expect(result).toEqual({
      entered: true,
      session: SESSION,
      claimed: false,
      invitation: { kind: 'refused', reason: OTHER_SERVER },
    })
  })

  it('refuses another server reached through the application scheme too', async () => {
    // The application's own scheme names a host exactly as https does, so it
    // is held to the same rule: a link to another instance is refused whichever
    // scheme carried it.
    const poster = recordingPoster()
    const result = await enterWithASession({
      secrets: store(JSON.stringify(SESSION)),
      poster,
      link: async () => 'messagr://other.example/i/abc123',
      signUp: markerStore().secrets,
    })
    expect(poster.calls).toEqual([])
    expect(result.entered && result.invitation).toEqual({
      kind: 'refused',
      reason: OTHER_SERVER,
    })
  })

  it('refuses the account server named on a different port', async () => {
    // A bench on another port is another instance. The host matching is not
    // enough on its own.
    const poster = recordingPoster()
    await enterWithASession({
      secrets: store(JSON.stringify(SESSION)),
      poster,
      link: async () => 'https://messagr.eu:8448/i/abc123',
      signUp: markerStore().secrets,
    })
    expect(poster.calls).toEqual([])
  })

  it('spends a link that names the account server through the application scheme', async () => {
    // Same instance, the operating system's own scheme: the ordinary path,
    // and the token is what proves the account.
    const poster = recordingPoster()
    const result = await enterWithASession({
      secrets: store(JSON.stringify(SESSION)),
      poster,
      link: async () => 'messagr://messagr.eu/i/abc123',
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
      signUp: markerStore().secrets,
    })
    expect(result).toEqual({ entered: true, session: SESSION, claimed: false })
  })

  it('says nothing when the link is not an invitation', async () => {
    const result = await enterWithASession({
      secrets: store(JSON.stringify(SESSION)),
      poster: { post: async () => ({ status: 200, body: GRANTED }) },
      link: async () => 'https://messagr.eu/about',
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
