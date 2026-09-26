import { describe, expect, it } from 'vitest'

import { deleteAccount, type Ending, wayToDelete } from './deleteAccount'

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
    /**
     * The key backup versions the account's server holds, newest first: `[]`
     * for none, `'unanswered'` for a server that does not say.
     */
    readonly backups?: readonly string[] | 'unanswered'
    /** `'ignored'`: the server answers the deletion and keeps the version. */
    readonly backupDeletion?: 'refuses' | 'ignored'
  } = {},
) {
  const happened: string[] = []
  const held =
    options.backups === 'unanswered'
      ? 'unanswered'
      : [...(options.backups ?? ['4711'])]
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
    backupVersion: async account => {
      happened.push(
        `ask ${account.baseUrl} for the key backup of ${account.userId}`,
      )
      if (held === 'unanswered') throw new Error('network is unreachable')
      return held[0] ?? null
    },
    deleteBackup: async (account, version) => {
      happened.push(
        `delete key backup ${version} of ${account.userId} on ${account.baseUrl}`,
      )
      if (options.backupDeletion === 'refuses') throw new Error('500')
      if (options.backupDeletion === 'ignored' || held === 'unanswered') return
      held.splice(held.indexOf(version), 1)
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
      outcome: 'deleted',
      marked: true,
      takenAway: { pusher: 'removed', backup: 'deleted' },
    })
    expect(here.happened).toEqual([
      'stop waking this device (the-pushkey by android) on https://bench.example',
      'ask https://bench.example for the key backup of @gone:bench.example',
      'delete key backup 4711 of @gone:bench.example on https://bench.example',
      'ask https://bench.example for the key backup of @gone:bench.example',
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
    const here = device({ pusher: null, backups: [] })
    expect(await deleteAccount(here.ending, ACCOUNT)).toEqual({
      outcome: 'deleted',
      marked: true,
      takenAway: { pusher: 'none', backup: 'none' },
    })
    expect(here.happened).toEqual([
      'ask https://bench.example for the key backup of @gone:bench.example',
      'deactivate @gone:bench.example on https://bench.example with the-kept-password',
      'mark @gone:bench.example deleted on this device',
    ])
  })

  it('deletes every backup version its server still holds, newest first', async () => {
    // `GET /room_keys/version` names only the newest. A replaced restore key
    // whose old version would not go (`replaceBackup.ts`) leaves an older one
    // behind, and the server would keep it: asked again after each deletion,
    // the server names the next one, until it has none.
    const here = device({ backups: ['4712', '4711'] })
    expect(await deleteAccount(here.ending, ACCOUNT)).toEqual({
      outcome: 'deleted',
      marked: true,
      takenAway: { pusher: 'removed', backup: 'deleted' },
    })
    expect(here.happened).toEqual([
      'stop waking this device (the-pushkey by android) on https://bench.example',
      'ask https://bench.example for the key backup of @gone:bench.example',
      'delete key backup 4712 of @gone:bench.example on https://bench.example',
      'ask https://bench.example for the key backup of @gone:bench.example',
      'delete key backup 4711 of @gone:bench.example on https://bench.example',
      'ask https://bench.example for the key backup of @gone:bench.example',
      'deactivate @gone:bench.example on https://bench.example with the-kept-password',
      'mark @gone:bench.example deleted on this device',
    ])
  })

  it('stops asking, and goes on, when the server keeps a version it was told to delete', async () => {
    // Asking again would get the same answer: the version is noted as not
    // gone, and the deactivation is not held up by it.
    const here = device({ backupDeletion: 'ignored' })
    expect(await deleteAccount(here.ending, ACCOUNT)).toEqual({
      outcome: 'deleted',
      marked: true,
      takenAway: { pusher: 'removed', backup: 'failed' },
    })
    expect(here.happened).toEqual([
      'stop waking this device (the-pushkey by android) on https://bench.example',
      'ask https://bench.example for the key backup of @gone:bench.example',
      'delete key backup 4711 of @gone:bench.example on https://bench.example',
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
      outcome: 'deleted',
      marked: true,
      takenAway: { pusher: 'failed', backup: 'deleted' },
    })
    expect(here.happened).toEqual([
      'stop waking this device (the-pushkey by android) on https://bench.example',
      'ask https://bench.example for the key backup of @gone:bench.example',
      'delete key backup 4711 of @gone:bench.example on https://bench.example',
      'ask https://bench.example for the key backup of @gone:bench.example',
      'deactivate @gone:bench.example on https://bench.example with the-kept-password',
      'mark @gone:bench.example deleted on this device',
    ])
  })

  it('goes on to the deactivation when the server does not say whether there is a backup', async () => {
    const here = device({ backups: 'unanswered' })
    expect(await deleteAccount(here.ending, ACCOUNT)).toEqual({
      outcome: 'deleted',
      marked: true,
      takenAway: { pusher: 'removed', backup: 'failed' },
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
      outcome: 'deleted',
      marked: true,
      takenAway: { pusher: 'removed', backup: 'failed' },
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
        outcome: 'failed',
        reason: 'the server did not deactivate this account',
        takenAway: { pusher: 'removed', backup: 'deleted' },
      })
      expect(here.happened).toEqual([
        'stop waking this device (the-pushkey by android) on https://bench.example',
        'ask https://bench.example for the key backup of @gone:bench.example',
        'delete key backup 4711 of @gone:bench.example on https://bench.example',
        'ask https://bench.example for the key backup of @gone:bench.example',
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
      outcome: 'deleted',
      marked: true,
      takenAway: { pusher: 'removed', backup: 'deleted' },
    })
    expect(here.happened.slice(4)).toEqual([
      'deactivate @gone:bench.example on https://bench.example with the-kept-password',
      'ask whether https://bench.example still knows @gone:bench.example',
      'mark @gone:bench.example deleted on this device',
    ])
  })

  it('counts nothing deleted when the server does not answer that question either', async () => {
    const here = device({ server: 'unreachable', known: null })
    expect(await deleteAccount(here.ending, ACCOUNT)).toEqual({
      outcome: 'failed',
      reason: 'the server did not deactivate this account',
      takenAway: { pusher: 'removed', backup: 'deleted' },
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
      outcome: 'by-email',
    })
    expect(here.happened).toEqual([])
  })

  it('says the account is deleted even when this device cannot write it down', async () => {
    // The server has said so, and that is the fact. What is lost is only the
    // mark the next launch reads, and the screen must not claim the account
    // is still there when it is not.
    const here = device({ keystore: 'refuses' })
    expect(await deleteAccount(here.ending, ACCOUNT)).toEqual({
      outcome: 'deleted',
      marked: false,
      takenAway: { pusher: 'removed', backup: 'deleted' },
    })
  })
})

describe('the way to delete, known before the screen offers anything (#384)', () => {
  it('is e-mail for a device that kept no password, and nothing is sent to find out', async () => {
    // The screen of facts then offers no « Oui, supprimer mon compte »: the
    // server would refuse the deactivation, and the person would learn it
    // only after deciding.
    const here = device({ password: null })
    expect(await wayToDelete(here.ending)).toBe('by-email')
    expect(here.happened).toEqual([])
  })

  it('is this device for one that kept it, and nothing is sent either', async () => {
    const here = device()
    expect(await wayToDelete(here.ending)).toBe('here')
    expect(here.happened).toEqual([])
  })
})
