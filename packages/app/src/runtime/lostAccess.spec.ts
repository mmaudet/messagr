import { describe, expect, it } from 'vitest'

import {
  cameBackAs,
  comeBack,
  forgetTheAccount,
  waysOut,
  type CameBack,
  type Regaining,
} from './lostAccess'

const ACCOUNT = {
  baseUrl: 'https://bench.example',
  userId: '@lost:bench.example',
  deviceId: 'OLDDEVICE',
  accessToken: 'syt_refused',
}

const NEW_SESSION = {
  baseUrl: 'https://bench.example',
  userId: '@lost:bench.example',
  deviceId: 'NEWDEVICE',
  accessToken: 'syt_fresh',
}

/**
 * A device whose token its homeserver refuses, and what that homeserver
 * answers to its kept password. What reaches the server and what this device
 * writes down are recorded in one list, in order.
 */
function device(
  options: {
    /** `null` for an account claimed before its password was kept (#190). */
    readonly password?: null | 'unreadable'
    /** What `/login` answers to the kept password. */
    readonly login?:
      | 'accepted'
      | 'deactivated'
      | 'wrong-password'
      | 'busy'
      | 'no-code'
      | 'unreachable'
    /** A step on this device, or the retirement, that throws. */
    readonly failing?: 'keep' | 'retire' | 'mark'
  } = {},
) {
  const happened: string[] = []
  const refusal = (errcode?: string) => ({
    reentered: false as const,
    reason: 'the homeserver refused to log in',
    ...(errcode === undefined ? {} : { errcode }),
  })
  const regaining: Regaining = {
    password: async () => {
      if (options.password === 'unreadable') throw new Error('keystore')
      return options.password === null ? null : 'the-kept-password'
    },
    logIn: async (account, password) => {
      happened.push(`log ${account.userId} in with ${password}`)
      switch (options.login ?? 'accepted') {
        case 'accepted':
          return { reentered: true, session: NEW_SESSION }
        case 'deactivated':
          return refusal('M_USER_DEACTIVATED')
        case 'wrong-password':
          return refusal('M_FORBIDDEN')
        case 'busy':
          return refusal('M_LIMIT_EXCEEDED')
        case 'no-code':
          return refusal()
        case 'unreachable':
          throw new Error('network is unreachable')
      }
    },
    keepNewDevice: async (session, old) => {
      if (options.failing === 'keep') throw new Error('keystore')
      happened.push(
        `keep ${session.deviceId} in place of ${old.deviceId} for the next launch`,
      )
    },
    retire: async (old, session) => {
      if (options.failing === 'retire') throw new Error('network')
      happened.push(`retire ${old.deviceId} as ${session.deviceId}`)
      return true
    },
    markForgotten: async account => {
      if (options.failing === 'mark') throw new Error('keystore')
      happened.push(`mark ${account.userId} to be forgotten here`)
    },
  }
  return { regaining, happened }
}

describe('a device its homeserver no longer lets in (#391)', () => {
  it('offers to come back only when it kept the password', async () => {
    expect(await waysOut(device().regaining)).toEqual({ comeBack: true })
    expect(await waysOut(device({ password: null }).regaining)).toEqual({
      comeBack: false,
    })
  })

  it('offers only to forget when the kept password cannot be read', async () => {
    expect(await waysOut(device({ password: 'unreadable' }).regaining)).toEqual(
      { comeBack: false },
    )
  })

  it('comes back as a new device, kept for the next launch, and retires the old one', async () => {
    // This telephone was taken off the account, or its token lost: the account
    // is alive, and the person asked to come back. Only then -- never on its
    // own, so that a telephone taken off an account stays off.
    const here = device()
    expect(await comeBack(here.regaining, ACCOUNT)).toBe('back')
    expect(here.happened).toEqual([
      'log @lost:bench.example in with the-kept-password',
      'keep NEWDEVICE in place of OLDDEVICE for the next launch',
      'retire OLDDEVICE as NEWDEVICE',
    ])
  })

  it('is back even when the old device will not retire', async () => {
    // The new device is already kept: saying otherwise would have the person
    // try again, and make yet another one.
    const here = device({ failing: 'retire' })
    expect(await comeBack(here.regaining, ACCOUNT)).toBe('back')
    expect(here.happened).toEqual([
      'log @lost:bench.example in with the-kept-password',
      'keep NEWDEVICE in place of OLDDEVICE for the next launch',
    ])
  })

  it('says to try again when this device cannot keep the new session, and retires nothing', async () => {
    const here = device({ failing: 'keep' })
    expect(await comeBack(here.regaining, ACCOUNT)).toBe('unreachable')
    expect(here.happened).toEqual([
      'log @lost:bench.example in with the-kept-password',
    ])
  })

  it('says the account is deleted when its server says it is deactivated, and marks it to be forgotten', async () => {
    const here = device({ login: 'deactivated' })
    expect(await comeBack(here.regaining, ACCOUNT)).toBe('deleted')
    expect(here.happened).toEqual([
      'log @lost:bench.example in with the-kept-password',
      'mark @lost:bench.example to be forgotten here',
    ])
  })

  it('says the account is deleted even when the mark will not write', async () => {
    // The server has spoken. The next launch meets the same refused token,
    // and the same answer.
    const here = device({ login: 'deactivated', failing: 'mark' })
    expect(await comeBack(here.regaining, ACCOUNT)).toBe('deleted')
  })

  it('keeps nothing when the password itself is refused', async () => {
    const here = device({ login: 'wrong-password' })
    expect(await comeBack(here.regaining, ACCOUNT)).toBe('refused')
    expect(here.happened).toEqual([
      'log @lost:bench.example in with the-kept-password',
    ])
  })

  it('says to try again when the server refuses for a reason that passes', async () => {
    // Too many attempts, or a refusal without a code: nothing says this
    // telephone can never come back, so « Revenir » stays offered.
    for (const login of ['busy', 'no-code'] as const) {
      const here = device({ login })
      expect(await comeBack(here.regaining, ACCOUNT)).toBe('unreachable')
      expect(here.happened).toEqual([
        'log @lost:bench.example in with the-kept-password',
      ])
    }
  })

  it('says the server could not be reached, and keeps nothing', async () => {
    const here = device({ login: 'unreachable' })
    expect(await comeBack(here.regaining, ACCOUNT)).toBe('unreachable')
    expect(here.happened).toEqual([
      'log @lost:bench.example in with the-kept-password',
    ])
  })

  it('sends nothing to come back without a kept password', async () => {
    const here = device({ password: null })
    expect(await comeBack(here.regaining, ACCOUNT)).toBe('refused')
    expect(here.happened).toEqual([])
  })

  it('forgets the account at the next launch when asked, sending nothing', async () => {
    const here = device()
    expect(await forgetTheAccount(here.regaining, ACCOUNT)).toBe(true)
    expect(here.happened).toEqual([
      'mark @lost:bench.example to be forgotten here',
    ])
  })

  it('says so when the mark to forget will not write', async () => {
    const here = device({ failing: 'mark' })
    expect(await forgetTheAccount(here.regaining, ACCOUNT)).toBe(false)
  })
})

/**
 * The launch after « Revenir sur ce compte »: the mark it left, as written,
 * and what the launch does with it, in order.
 */
function launch(mark: string | null, running: boolean = false) {
  const happened: string[] = []
  const cameBack: CameBack = {
    mark: async () => mark,
    aMachineIsRunning: () => running,
    clearMark: async () => {
      happened.push('clear the mark')
    },
    eraseStore: async deviceId => {
      happened.push(`erase the store of ${deviceId}`)
    },
  }
  return { cameBack, happened }
}

const CAME_BACK = JSON.stringify({ now: 'NEWDEVICE', was: 'OLDDEVICE' })

describe('the launch after coming back (#391)', () => {
  it('is the device it came back as while that device has no store yet, and erases the one the telephone had', async () => {
    // The old store holds the keys of a device that no longer exists, which
    // nothing here reads again, and which forgetting the account later would
    // not find. The mark stays until the new store exists: a launch killed
    // before would otherwise take the next one for a reinstall.
    const here = launch(CAME_BACK)
    expect(await cameBackAs(here.cameBack, NEW_SESSION, false)).toBe(true)
    expect(here.happened).toEqual(['erase the store of OLDDEVICE'])
  })

  it('leaves the old store alone while a machine still runs on it in this process', async () => {
    // A link opened over « Fermez complètement Messagr » runs the launch again
    // while the old device's machine still holds its store. The mark stays, so
    // the next cold launch erases it.
    const here = launch(CAME_BACK, true)
    expect(await cameBackAs(here.cameBack, NEW_SESSION, false)).toBe(true)
    expect(here.happened).toEqual([])
  })

  it('clears the mark once the new device has its store', async () => {
    const here = launch(CAME_BACK)
    expect(await cameBackAs(here.cameBack, NEW_SESSION, true)).toBe(false)
    expect(here.happened).toEqual([
      'erase the store of OLDDEVICE',
      'clear the mark',
    ])
  })

  it('clears a mark naming another device, and erases nothing', async () => {
    // The mark was written and the session was not: this launch holds the old
    // device, whose store is the one in use.
    const here = launch(CAME_BACK)
    expect(await cameBackAs(here.cameBack, ACCOUNT, true)).toBe(false)
    expect(here.happened).toEqual(['clear the mark'])
  })

  it('reads a mark it cannot make sense of as no mark, and clears it', async () => {
    for (const unreadable of ['NEWDEVICE', '{"now":"NEWDEVICE"}']) {
      const here = launch(unreadable)
      expect(await cameBackAs(here.cameBack, NEW_SESSION, false)).toBe(false)
      expect(here.happened).toEqual(['clear the mark'])
    }
  })

  it('is an ordinary launch without a mark', async () => {
    const here = launch(null)
    expect(await cameBackAs(here.cameBack, NEW_SESSION, false)).toBe(false)
    expect(here.happened).toEqual([])
  })
})
