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
  it('uses the session it already has, without spending an invitation', async () => {
    let posted = false
    const watching: ServicePoster = {
      post: async () => {
        posted = true
        return { status: 200, body: GRANTED }
      },
    }
    const result = await enterWithASession({
      secrets: store(JSON.stringify(SESSION)),
      poster: watching,
      link: async () => 'https://messagr.eu/i/abc123',
      signUp: markerStore().secrets,
    })
    expect(result).toEqual({ entered: true, session: SESSION, claimed: false })
    // An invitation is single-use. Spending one for an account that already
    // exists would destroy a link somebody was given.
    expect(posted).toBe(false)
  })

  it('claims the link when there is no session yet, and keeps what it gets', async () => {
    const secrets = store()
    const result = await enterWithASession({
      secrets,
      poster: granting,
      link: async () => 'https://messagr.eu/i/abc123',
      signUp: markerStore().secrets,
    })
    expect(result).toEqual({ entered: true, session: SESSION, claimed: true })
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
