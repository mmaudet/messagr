import { describe, expect, it } from 'vitest'

import type { HttpRequester } from './pump'
import { verifyDeviceKeysPublished } from './verifyPublishedKeys'

function fakeHttp(responseJson: string): HttpRequester & {
  calls: Array<{ path: string; body: string | undefined }>
} {
  const calls: Array<{ path: string; body: string | undefined }> = []
  return {
    authedRequest: async (_m, path, _q, body) => {
      calls.push({ path, body })
      return responseJson
    },
    calls,
  }
}

const USER_ID = '@alice:example.org'
const DEVICE_ID = 'DEVICE1'
const IDENTITY = { userId: USER_ID, deviceId: DEVICE_ID }

describe('verifyDeviceKeysPublished', () => {
  it('queries /keys/query for exactly this account, every device', async () => {
    const http = fakeHttp(
      JSON.stringify({
        device_keys: {
          [USER_ID]: {
            [DEVICE_ID]: {
              keys: {
                [`curve25519:${DEVICE_ID}`]: 'c-key',
                [`ed25519:${DEVICE_ID}`]: 'e-key',
              },
            },
          },
        },
      }),
    )
    await verifyDeviceKeysPublished(http, IDENTITY)
    expect(http.calls).toEqual([
      {
        path: '/_matrix/client/v3/keys/query',
        body: JSON.stringify({ device_keys: { [USER_ID]: [] } }),
      },
    ])
  })

  it('is true when the device carries both a curve25519 and an ed25519 key', async () => {
    const http = fakeHttp(
      JSON.stringify({
        device_keys: {
          [USER_ID]: {
            [DEVICE_ID]: {
              keys: {
                [`curve25519:${DEVICE_ID}`]: 'c-key',
                [`ed25519:${DEVICE_ID}`]: 'e-key',
              },
            },
          },
        },
      }),
    )
    await expect(verifyDeviceKeysPublished(http, IDENTITY)).resolves.toBe(true)
  })

  it('is false when the account has no answer at all', async () => {
    const http = fakeHttp(JSON.stringify({ device_keys: {} }))
    await expect(verifyDeviceKeysPublished(http, IDENTITY)).resolves.toBe(false)
  })

  it('is false when the account answers but not this device', async () => {
    const http = fakeHttp(
      JSON.stringify({ device_keys: { [USER_ID]: { OTHERDEVICE: {} } } }),
    )
    await expect(verifyDeviceKeysPublished(http, IDENTITY)).resolves.toBe(false)
  })

  it('is false when the device is named but carries only one of the two algorithms', async () => {
    const http = fakeHttp(
      JSON.stringify({
        device_keys: {
          [USER_ID]: {
            [DEVICE_ID]: { keys: { [`curve25519:${DEVICE_ID}`]: 'c-key' } },
          },
        },
      }),
    )
    await expect(verifyDeviceKeysPublished(http, IDENTITY)).resolves.toBe(false)
  })

  it('is false rather than throwing on a malformed response', async () => {
    const http = fakeHttp('not json')
    await expect(verifyDeviceKeysPublished(http, IDENTITY)).resolves.toBe(false)
  })
})
