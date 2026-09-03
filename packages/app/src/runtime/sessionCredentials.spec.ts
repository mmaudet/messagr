import { afterEach, describe, expect, it, vi } from 'vitest'

import { computeSessionCredentials } from './sessionCredentials'

describe('computeSessionCredentials', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('reads a restored session from a complete environment', () => {
    expect(
      computeSessionCredentials({
        homeserver: 'https://example.invalid',
        userId: '@alice:example.invalid',
        deviceId: 'ABCDEFGH',
        accessToken: 'syt_secret',
      }),
    ).toEqual({
      baseUrl: 'https://example.invalid',
      userId: '@alice:example.invalid',
      deviceId: 'ABCDEFGH',
      accessToken: 'syt_secret',
    })
  })

  it('is null when nothing is configured', () => {
    expect(computeSessionCredentials({})).toBeNull()
  })

  it.each(['homeserver', 'userId', 'deviceId', 'accessToken'] as const)(
    'is null when only %s is missing',
    field => {
      const complete = {
        homeserver: 'https://example.invalid',
        userId: '@alice:example.invalid',
        deviceId: 'ABCDEFGH',
        accessToken: 'syt_secret',
      }
      const partial = { ...complete, [field]: undefined }
      expect(computeSessionCredentials(partial)).toBeNull()
    },
  )

  it('is null when a field is present but empty', () => {
    expect(
      computeSessionCredentials({
        homeserver: '',
        userId: '@alice:example.invalid',
        deviceId: 'ABCDEFGH',
        accessToken: 'syt_secret',
      }),
    ).toBeNull()
  })

  it('reads real process.env when called with no argument', () => {
    vi.stubEnv('MESSAGR_SESSION_HOMESERVER', 'https://from-env.invalid')
    vi.stubEnv('MESSAGR_SESSION_USER_ID', '@bob:from-env.invalid')
    vi.stubEnv('MESSAGR_SESSION_DEVICE_ID', 'FROMENVID')
    vi.stubEnv('MESSAGR_SESSION_ACCESS_TOKEN', 'syt_from_env')
    expect(computeSessionCredentials()).toEqual({
      baseUrl: 'https://from-env.invalid',
      userId: '@bob:from-env.invalid',
      deviceId: 'FROMENVID',
      accessToken: 'syt_from_env',
    })
  })
})
