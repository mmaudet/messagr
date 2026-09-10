import { describe, expect, it } from 'vitest'

import { reenterWithPassword, retireDevice, type Reentering } from './reenter'

const ACCOUNT = {
  baseUrl: 'https://h.test',
  userId: '@her:h.test',
  password: 'a-drawn-password',
}

type Call = { path: string; body: unknown; bearer?: string }

function reentering(answers: Partial<Reentering> = {}): {
  deps: Reentering
  calls: Call[]
} {
  const calls: Call[] = []
  const deps: Reentering = {
    post: async (path, body, bearer) => {
      calls.push({ path, body, bearer })
      return {
        status: 200,
        body: {
          user_id: '@her:h.test',
          device_id: 'NEWDEVICE',
          access_token: 'a-new-token',
        },
      }
    },
    remove: async (path, body, bearer) => {
      calls.push({ path, body, bearer })
      return { status: 200, body: {} }
    },
    ...answers,
  }
  return { deps, calls }
}

describe('coming back after a reinstall', () => {
  it('logs in and answers a session for a new device', async () => {
    const { deps, calls } = reentering()
    expect(await reenterWithPassword(deps, ACCOUNT)).toEqual({
      reentered: true,
      session: {
        baseUrl: 'https://h.test',
        userId: '@her:h.test',
        deviceId: 'NEWDEVICE',
        accessToken: 'a-new-token',
      },
    })
    expect(calls[0]?.path).toBe('/_matrix/client/v3/login')
    expect(calls[0]?.body).toEqual({
      type: 'm.login.password',
      identifier: { type: 'm.id.user', user: 'her' },
      password: 'a-drawn-password',
    })
  })

  it('sends the local part, which is what /login wants', async () => {
    // `@her:h.test` is not a username. A homeserver handed the whole
    // identifier answers 403 and says nothing useful about why.
    const { deps, calls } = reentering()
    await reenterWithPassword(deps, { ...ACCOUNT, userId: '@a.b-c:h.test' })
    expect(
      (calls[0]?.body as { identifier: { user: string } }).identifier.user,
    ).toBe('a.b-c')
  })

  it('carries no bearer, because there is nothing to be yet', async () => {
    const { deps, calls } = reentering()
    await reenterWithPassword(deps, ACCOUNT)
    expect(calls[0]?.bearer).toBeUndefined()
  })

  it('reports a refusal rather than throwing', async () => {
    const { deps } = reentering({
      post: async () => ({ status: 403, body: { errcode: 'M_FORBIDDEN' } }),
    })
    const answer = await reenterWithPassword(deps, ACCOUNT)
    expect(answer.reentered).toBe(false)
  })

  it('refuses a half-session rather than storing one', async () => {
    const { deps } = reentering({
      post: async () => ({ status: 200, body: { user_id: '@her:h.test' } }),
    })
    const answer = await reenterWithPassword(deps, ACCOUNT)
    expect(answer).toEqual({
      reentered: false,
      reason: 'the homeserver answered no session',
    })
  })
})

describe('retiring the device left behind', () => {
  const DEVICE = {
    deviceId: 'OLDDEVICE',
    userId: '@her:h.test',
    password: 'a-drawn-password',
    accessToken: 'a-new-token',
  }

  it('answers the 401 with the password, which is the protocol', async () => {
    // Measured in this order on the bench: 401 with a session, then 200.
    // A caller reading the first answer as "no" leaves a dead device
    // standing on every reinstall.
    let asked = 0
    const { deps, calls } = reentering({
      remove: async (path, body, bearer) => {
        calls.push({ path, body, bearer })
        asked += 1
        return asked === 1
          ? { status: 401, body: { session: 'a-uia-session' } }
          : { status: 200, body: {} }
      },
    })
    expect(await retireDevice(deps, DEVICE)).toBe(true)
    expect(calls).toHaveLength(2)
    expect(calls[0]?.path).toBe('/_matrix/client/v3/devices/OLDDEVICE')
    expect(calls[1]?.body).toEqual({
      auth: {
        type: 'm.login.password',
        session: 'a-uia-session',
        identifier: { type: 'm.id.user', user: 'her' },
        password: 'a-drawn-password',
      },
    })
  })

  it('is content with a homeserver that simply says yes', async () => {
    const { deps, calls } = reentering()
    expect(await retireDevice(deps, DEVICE)).toBe(true)
    expect(calls).toHaveLength(1)
  })

  it('gives up on a 401 that names no session to answer', async () => {
    const { deps } = reentering({
      remove: async () => ({ status: 401, body: { flows: [] } }),
    })
    expect(await retireDevice(deps, DEVICE)).toBe(false)
  })

  it('gives up on any other refusal without a second attempt', async () => {
    let asked = 0
    const { deps } = reentering({
      remove: async () => {
        asked += 1
        return { status: 404, body: {} }
      },
    })
    expect(await retireDevice(deps, DEVICE)).toBe(false)
    expect(asked).toBe(1)
  })

  it('escapes an identifier rather than pasting it into a path', async () => {
    const { deps, calls } = reentering()
    await retireDevice(deps, { ...DEVICE, deviceId: 'a/b' })
    expect(calls[0]?.path).toBe('/_matrix/client/v3/devices/a%2Fb')
  })
})
