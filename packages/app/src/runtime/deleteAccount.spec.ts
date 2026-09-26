import { describe, expect, it } from 'vitest'

import { deleteAccount, type Ending } from './deleteAccount'

const ACCOUNT = {
  baseUrl: 'https://bench.example',
  userId: '@gone:bench.example',
  deviceId: 'THISDEVICE',
  accessToken: 'syt_gone',
}

/**
 * A device holding one account, its kept password, and what its server
 * answers. What reaches the server and what this device writes down are
 * recorded in one list, so a test reads the order they happened in.
 */
function device(
  options: {
    /** `null` for an account claimed before its password was kept (#190). */
    readonly password?: null
    readonly server?: 'refuses' | 'unreachable'
    /**
     * What the server says when asked, after a failed deactivation, whether
     * it still knows this session: `false` when it says the token is unknown,
     * `null` when it does not answer.
     */
    readonly known?: boolean | null
    readonly keystore?: 'refuses'
  } = {},
) {
  const happened: string[] = []
  const ending: Ending = {
    password: async () =>
      options.password === null ? null : 'the-kept-password',
    deactivate: async (account, password) => {
      happened.push(
        `deactivate ${account.userId} on ${account.baseUrl} with ${password}`,
      )
      if (options.server === 'refuses') throw new Error('403 M_FORBIDDEN')
      if (options.server === 'unreachable') {
        throw new Error('network is unreachable')
      }
    },
    stillKnown: async account => {
      happened.push(
        `ask whether ${account.baseUrl} still knows ${account.userId}`,
      )
      return options.known === undefined ? true : options.known
    },
    markDeleted: async account => {
      happened.push(`mark ${account.userId} deleted on this device`)
      if (options.keystore === 'refuses') throw new Error('keystore full')
    },
  }
  return { ending, happened }
}

describe('deleting the account this device holds', () => {
  it('deactivates the account on its own server with its own password, then marks it deleted here', async () => {
    // In that order, and the order is the promise: the device writes down that
    // the account is gone only once its server has said so. A mark written
    // first would have the next launch forget an account that still exists.
    const here = device()
    expect(await deleteAccount(here.ending, ACCOUNT)).toEqual({
      deleted: true,
      marked: true,
    })
    expect(here.happened).toEqual([
      'deactivate @gone:bench.example on https://bench.example with the-kept-password',
      'mark @gone:bench.example deleted on this device',
    ])
  })

  it('marks nothing, and says nothing was deleted, when the server refuses or cannot be reached', async () => {
    // The account is still there, so is everything this device keeps of it,
    // and the screen says so: the person can try again with nothing half done.
    for (const server of ['refuses', 'unreachable'] as const) {
      const here = device({ server })
      expect(await deleteAccount(here.ending, ACCOUNT)).toEqual({
        deleted: false,
        reason: 'the server did not deactivate this account',
      })
      expect(here.happened).toEqual([
        'deactivate @gone:bench.example on https://bench.example with the-kept-password',
        'ask whether https://bench.example still knows @gone:bench.example',
      ])
    }
  })

  it('counts the account deleted when, after an answer that got lost, its server no longer knows it', async () => {
    // The server deactivated the account and the answer never came back, so
    // the attempt looks failed -- and every later one would meet a token the
    // server has forgotten. Asked whether it still knows this session, the
    // server says no: that is the answer that was lost, and the device marks
    // the account deleted rather than leaving it half undone.
    const here = device({ server: 'unreachable', known: false })
    expect(await deleteAccount(here.ending, ACCOUNT)).toEqual({
      deleted: true,
      marked: true,
    })
    expect(here.happened).toEqual([
      'deactivate @gone:bench.example on https://bench.example with the-kept-password',
      'ask whether https://bench.example still knows @gone:bench.example',
      'mark @gone:bench.example deleted on this device',
    ])
  })

  it('says nothing was deleted when the server does not answer that question either', async () => {
    const here = device({ server: 'unreachable', known: null })
    expect(await deleteAccount(here.ending, ACCOUNT)).toEqual({
      deleted: false,
      reason: 'the server did not deactivate this account',
    })
  })

  it('sends nothing at all when this device kept no password', async () => {
    // The server refuses a deactivation without it, so asking would only
    // spend a request to be told no. #384 says what the screen offers then.
    const here = device({ password: null })
    expect(await deleteAccount(here.ending, ACCOUNT)).toEqual({
      deleted: false,
      reason: 'this device kept no password for this account',
    })
    expect(here.happened).toEqual([])
  })

  it('says the account is deleted even when this device cannot write it down', async () => {
    // The server has said so, and that is the fact. What is lost is only the
    // mark the next launch reads, and the screen must not claim the account
    // is still there when it is not.
    const here = device({ keystore: 'refuses' })
    expect(await deleteAccount(here.ending, ACCOUNT)).toEqual({
      deleted: true,
      marked: false,
    })
  })
})
