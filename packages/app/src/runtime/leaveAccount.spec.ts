import { describe, expect, it } from 'vitest'

import { leaveAccount, type Leaving } from './leaveAccount'

const ACCOUNT = {
  baseUrl: 'https://bench.example',
  userId: '@old:bench.example',
  deviceId: 'OLDDEVICE',
  accessToken: 'syt_old',
}

type Sent = { url: string; body: unknown; bearer?: string }

/**
 * A device holding one account, and the one server it can reach.
 *
 * The pushkey is kept on the device and goes when the account is forgotten, so
 * a test can tell whether it was read in time.
 */
function device(
  answer: (
    path: string,
  ) => Promise<{ status: number; body: unknown }> = async () => ({
    status: 200,
    body: {},
  }),
) {
  const sent: Sent[] = []
  const forgotten: string[] = []
  let pushkey: string | null = 'pushkey-of-this-device'
  const deps: Leaving = {
    homeserver: baseUrl => ({
      post: async (path, body, bearer) => {
        sent.push({ url: `${baseUrl}${path}`, body, bearer })
        return answer(path)
      },
    }),
    pusher: async () =>
      pushkey === null ? null : { token: pushkey, road: 'android' },
    forget: async account => {
      forgotten.push(account.deviceId)
      pushkey = null
    },
  }
  return { deps, sent, forgotten }
}

describe('leaving the account this device holds', () => {
  it('takes its pusher away, then ends its session, on its own server and with its own token', async () => {
    // In that order, and the order is the protocol: once the session has
    // ended, the token that could remove the pusher no longer opens anything.
    // And the pushkey is read before the account is forgotten, since
    // forgetting the account takes the pushkey with it.
    const here = device()
    const { closing } = await leaveAccount(here.deps, ACCOUNT)
    expect(await closing).toEqual({ pusher: 'removed', loggedOut: true })
    expect(here.sent).toEqual([
      {
        url: 'https://bench.example/_matrix/client/v3/pushers/set',
        body: {
          app_id: 'eu.messagr',
          pushkey: 'pushkey-of-this-device',
          kind: null,
        },
        bearer: 'syt_old',
      },
      {
        url: 'https://bench.example/_matrix/client/v3/logout',
        body: {},
        bearer: 'syt_old',
      },
    ])
  })

  it('forgets the account without waiting for its server to answer', async () => {
    // A server that never answers is the one this is for: a bench switched
    // off, a telephone on a train. The person asked to leave, and leaving
    // does not hang on a server that will not say goodbye.
    const here = device(() => new Promise(() => {}))
    let left = false
    leaveAccount(here.deps, ACCOUNT).then(() => {
      left = true
    })
    await new Promise(resolve => setImmediate(resolve))
    expect(left).toBe(true)
    expect(here.forgotten).toEqual(['OLDDEVICE'])
  })

  it('forgets the account all the same when its server cannot be reached', async () => {
    const here = device(async () => {
      throw new Error('network is unreachable')
    })
    const { closing } = await leaveAccount(here.deps, ACCOUNT)
    expect(here.forgotten).toEqual(['OLDDEVICE'])
    expect(await closing).toEqual({ pusher: 'unreachable', loggedOut: false })
  })

  it('still ends the session when this device never wrote a pusher down', async () => {
    // A build older than the pushkey's own entry, or notifications refused:
    // nothing to take away, and the session still has to end.
    const here = device()
    here.deps = {
      ...here.deps,
      pusher: async () => null,
    }
    const { closing } = await leaveAccount(here.deps, ACCOUNT)
    expect(await closing).toEqual({ pusher: 'none', loggedOut: true })
    expect(here.sent.map(sent => sent.url)).toEqual([
      'https://bench.example/_matrix/client/v3/logout',
    ])
  })

  it('still ends the session when the server will not take the pusher away', async () => {
    const here = device(async path => ({
      status: path.endsWith('/pushers/set') ? 403 : 200,
      body: {},
    }))
    const { closing } = await leaveAccount(here.deps, ACCOUNT)
    expect(await closing).toEqual({ pusher: 'refused', loggedOut: true })
  })
})
