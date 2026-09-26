import { describe, expect, it } from 'vitest'

import { comeBack, forgetIt, waysOut, type Regaining } from './lostAccess'

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
    readonly password?: null
    /** What `/login` answers to the kept password. */
    readonly login?:
      'accepted' | 'deactivated' | 'wrong-password' | 'unreachable'
  } = {},
) {
  const happened: string[] = []
  const regaining: Regaining = {
    password: async () =>
      options.password === null ? null : 'the-kept-password',
    logIn: async (account, password) => {
      happened.push(`log ${account.userId} in with ${password}`)
      switch (options.login ?? 'accepted') {
        case 'accepted':
          return { reentered: true, session: NEW_SESSION }
        case 'deactivated':
          return {
            reentered: false,
            reason: 'the homeserver refused to log in',
            errcode: 'M_USER_DEACTIVATED',
          }
        case 'wrong-password':
          return {
            reentered: false,
            reason: 'the homeserver refused to log in',
            errcode: 'M_FORBIDDEN',
          }
        case 'unreachable':
          throw new Error('network is unreachable')
      }
    },
    keepNewDevice: async session => {
      happened.push(`keep ${session.deviceId} for the next launch`)
    },
    retire: async (old, session) => {
      happened.push(`retire ${old.deviceId} as ${session.deviceId}`)
      return true
    },
    markForgotten: async account => {
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

  it('comes back as a new device, kept for the next launch, and retires the old one', async () => {
    // This telephone was taken off the account, or its token lost: the account
    // is alive, and the person asked to come back. Only then -- never on its
    // own, so that a telephone taken off an account stays off.
    const here = device()
    expect(await comeBack(here.regaining, ACCOUNT)).toBe('back')
    expect(here.happened).toEqual([
      'log @lost:bench.example in with the-kept-password',
      'keep NEWDEVICE for the next launch',
      'retire OLDDEVICE as NEWDEVICE',
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

  it('keeps nothing when the password is refused for another reason', async () => {
    const here = device({ login: 'wrong-password' })
    expect(await comeBack(here.regaining, ACCOUNT)).toBe('refused')
    expect(here.happened).toEqual([
      'log @lost:bench.example in with the-kept-password',
    ])
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
    expect(await forgetIt(here.regaining, ACCOUNT)).toBe(true)
    expect(here.happened).toEqual([
      'mark @lost:bench.example to be forgotten here',
    ])
  })
})
