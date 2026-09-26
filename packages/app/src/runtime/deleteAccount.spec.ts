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
    /** `null` when this device never wrote a pushkey down. */
    readonly pusher?: null
    readonly waking?: 'refuses'
    /** `null` for an account with no key backup. */
    readonly backup?: null | 'unanswered'
    readonly backupDeletion?: 'refuses'
  } = {},
) {
  const happened: string[] = []
  const ending: Ending = {
    password: async () =>
      options.password === null ? null : 'the-kept-password',
    pusher: async () =>
      options.pusher === null
        ? null
        : { token: 'the-pushkey', road: 'android' },
    stopWaking: async (account, pusher) => {
      happened.push(
        `stop waking this device (${pusher.token} by ${pusher.road}) on ${account.baseUrl}`,
      )
      if (options.waking === 'refuses') throw new Error('500')
    },
    backup: async account => {
      happened.push(
        `ask ${account.baseUrl} for the key backup of ${account.userId}`,
      )
      if (options.backup === 'unanswered') {
        throw new Error('network is unreachable')
      }
      return options.backup === null ? null : '4711'
    },
    deleteBackup: async (account, version) => {
      happened.push(
        `delete key backup ${version} of ${account.userId} on ${account.baseUrl}`,
      )
      if (options.backupDeletion === 'refuses') throw new Error('500')
    },
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
  it("takes this device's pusher away, then the key backup, before the deactivation that makes the token worthless", async () => {
    // #383. After the deactivation the token opens nothing: it is before or
    // never. The conversations are not left here -- the server makes a
    // deactivated account leave them itself, measured on 26 September 2026,
    // so leaving first would only mutilate an account whose deactivation then
    // failed.
    const here = device()
    expect(await deleteAccount(here.ending, ACCOUNT)).toEqual({
      deleted: true,
      marked: true,
      undone: { pusher: 'removed', backup: 'deleted' },
    })
    expect(here.happened).toEqual([
      'stop waking this device (the-pushkey by android) on https://bench.example',
      'ask https://bench.example for the key backup of @gone:bench.example',
      'delete key backup 4711 of @gone:bench.example on https://bench.example',
      'deactivate @gone:bench.example on https://bench.example with the-kept-password',
      'mark @gone:bench.example deleted on this device',
    ])
  })

  it('with nothing to take away first, deactivates the account with its own password, then marks it deleted here', async () => {
    // In that order, and the order is the promise: the device writes down that
    // the account is gone only once its server has said so. A mark written
    // first would have the next launch forget an account that still exists.
    // No pushkey written down and no backup on the account: the one question
    // left is whether there is a backup, which only the server can answer.
    const here = device({ pusher: null, backup: null })
    expect(await deleteAccount(here.ending, ACCOUNT)).toEqual({
      deleted: true,
      marked: true,
      undone: { pusher: 'none', backup: 'none' },
    })
    expect(here.happened).toEqual([
      'ask https://bench.example for the key backup of @gone:bench.example',
      'deactivate @gone:bench.example on https://bench.example with the-kept-password',
      'mark @gone:bench.example deleted on this device',
    ])
  })

  it('goes on to the backup and the deactivation when the pusher will not go', async () => {
    // A pusher left behind wakes nobody for long: the account is about to
    // leave everything that could make it fire. It is noted, not waited on.
    const here = device({ waking: 'refuses' })
    expect(await deleteAccount(here.ending, ACCOUNT)).toEqual({
      deleted: true,
      marked: true,
      undone: { pusher: 'failed', backup: 'deleted' },
    })
    expect(here.happened).toEqual([
      'stop waking this device (the-pushkey by android) on https://bench.example',
      'ask https://bench.example for the key backup of @gone:bench.example',
      'delete key backup 4711 of @gone:bench.example on https://bench.example',
      'deactivate @gone:bench.example on https://bench.example with the-kept-password',
      'mark @gone:bench.example deleted on this device',
    ])
  })

  it('goes on to the deactivation when the server does not say whether there is a backup', async () => {
    const here = device({ backup: 'unanswered' })
    expect(await deleteAccount(here.ending, ACCOUNT)).toEqual({
      deleted: true,
      marked: true,
      undone: { pusher: 'removed', backup: 'failed' },
    })
    expect(here.happened).toEqual([
      'stop waking this device (the-pushkey by android) on https://bench.example',
      'ask https://bench.example for the key backup of @gone:bench.example',
      'deactivate @gone:bench.example on https://bench.example with the-kept-password',
      'mark @gone:bench.example deleted on this device',
    ])
  })

  it('goes on to the deactivation when the backup will not be deleted', async () => {
    const here = device({ backupDeletion: 'refuses' })
    expect(await deleteAccount(here.ending, ACCOUNT)).toEqual({
      deleted: true,
      marked: true,
      undone: { pusher: 'removed', backup: 'failed' },
    })
    expect(here.happened.slice(3)).toEqual([
      'deactivate @gone:bench.example on https://bench.example with the-kept-password',
      'mark @gone:bench.example deleted on this device',
    ])
  })

  it('marks nothing, and says the account is still there, when the server refuses or cannot be reached', async () => {
    // The account is still there, and so is everything this device keeps of
    // it; the screen says so, and trying again finishes what this attempt
    // began. Its pusher and its backup may already be gone, which is why the
    // screen no longer says the account is as it was (#383).
    for (const server of ['refuses', 'unreachable'] as const) {
      const here = device({ server })
      expect(await deleteAccount(here.ending, ACCOUNT)).toEqual({
        deleted: false,
        reason: 'the server did not deactivate this account',
        undone: { pusher: 'removed', backup: 'deleted' },
      })
      expect(here.happened).toEqual([
        'stop waking this device (the-pushkey by android) on https://bench.example',
        'ask https://bench.example for the key backup of @gone:bench.example',
        'delete key backup 4711 of @gone:bench.example on https://bench.example',
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
      undone: { pusher: 'removed', backup: 'deleted' },
    })
    expect(here.happened.slice(3)).toEqual([
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
      undone: { pusher: 'removed', backup: 'deleted' },
    })
  })

  it('sends nothing at all when this device kept no password', async () => {
    // The server refuses a deactivation without it, so asking would only
    // spend a request to be told no. #384 says what the screen offers then.
    // Nor is anything taken away first: this device has a pusher written down
    // and its account a backup, and neither is touched for a deletion that
    // cannot happen.
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
      undone: { pusher: 'removed', backup: 'deleted' },
    })
  })
})
