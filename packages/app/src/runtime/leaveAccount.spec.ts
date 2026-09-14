import { describe, expect, it } from 'vitest'

import { leaveAccount, type Departure } from './leaveAccount'
import type { SecretStore } from './sessionStore'

const ACCOUNT = {
  baseUrl: 'https://bench.example',
  userId: '@old:bench.example',
  deviceId: 'OLDDEVICE',
  accessToken: 'syt_old',
}

/** An entry the next account has already written, which leaving must spare. */
const WRITTEN_BY_THE_NEXT_ACCOUNT: SecretStore = {
  read: async () => 'the next account',
  write: async () => undefined,
}

/**
 * A device holding one account, and what its server answers.
 *
 * The pushkey is kept on the device and goes when the account is forgotten, so
 * a test can tell whether it was read in time.
 */
function device(
  server: {
    readonly stopWaking?: () => Promise<void>
    readonly logOut?: () => Promise<void>
  } = {},
) {
  const sent: string[] = []
  const forgotten: Array<{
    readonly deviceId: string
    readonly keeping: readonly SecretStore[]
  }> = []
  let pushkey: string | null = 'pushkey-of-this-device'
  const deps: Departure = {
    pusher: async () =>
      pushkey === null ? null : { token: pushkey, road: 'android' },
    stopWaking: async (account, pusher) => {
      sent.push(
        `${pusher.token} taken away on ${account.baseUrl} with ${account.accessToken}`,
      )
      await server.stopWaking?.()
    },
    logOut: async account => {
      sent.push(
        `session ended on ${account.baseUrl} with ${account.accessToken}`,
      )
      await server.logOut?.()
    },
    forgetPassword: async () => undefined,
    forget: async (account, keeping) => {
      forgotten.push({ deviceId: account.deviceId, keeping })
      pushkey = null
    },
  }
  return { deps, sent, forgotten }
}

describe('leaving the account this device holds', () => {
  it('takes its pusher away, then ends its session, with its own credentials', async () => {
    // In that order, and the order is the protocol: once the session has
    // ended, the token that could take the pusher away opens nothing. And the
    // pushkey is read before the account is forgotten, since forgetting the
    // account takes the pushkey with it.
    const here = device()
    const { closing } = await leaveAccount(here.deps, ACCOUNT, [
      WRITTEN_BY_THE_NEXT_ACCOUNT,
    ])
    expect(await closing).toEqual({ pusher: 'removed', loggedOut: true })
    expect(here.sent).toEqual([
      'pushkey-of-this-device taken away on https://bench.example with syt_old',
      'session ended on https://bench.example with syt_old',
    ])
  })

  it('forgets the account, sparing what it is told to, without waiting for its server', async () => {
    // A server that never answers is the one this is for: a bench switched
    // off, a telephone on a train. The person asked to leave, and leaving does
    // not hang on a server that will not say goodbye.
    const here = device({ stopWaking: () => new Promise(() => {}) })
    let left = false
    leaveAccount(here.deps, ACCOUNT, [WRITTEN_BY_THE_NEXT_ACCOUNT]).then(() => {
      left = true
    })
    await new Promise(resolve => setImmediate(resolve))
    expect(left).toBe(true)
    expect(here.forgotten).toEqual([
      { deviceId: 'OLDDEVICE', keeping: [WRITTEN_BY_THE_NEXT_ACCOUNT] },
    ])
  })

  it('forgets the account all the same when its server cannot be reached', async () => {
    const unreachable = async () => {
      throw new Error('network is unreachable')
    }
    const here = device({ stopWaking: unreachable, logOut: unreachable })
    const { closing } = await leaveAccount(here.deps, ACCOUNT, [])
    expect(here.forgotten).toHaveLength(1)
    expect(await closing).toEqual({ pusher: 'failed', loggedOut: false })
  })

  it('still ends the session when this device never wrote a pusher down', async () => {
    // A build older than the pushkey's own entry, or notifications refused:
    // nothing to take away, and the session still has to end.
    const here = device()
    const { closing } = await leaveAccount(
      { ...here.deps, pusher: async () => null },
      ACCOUNT,
      [],
    )
    expect(await closing).toEqual({ pusher: 'none', loggedOut: true })
    expect(here.sent).toEqual([
      'session ended on https://bench.example with syt_old',
    ])
  })
})
