import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AppleToken } from './applePushToken'
import { pushTokenForThisDevice } from './pushDevice'

/**
 * The two roads, now that only one of them goes through Google.
 *
 * # WHY THIS FILE EXISTS AT ALL, HAVING NOT EXISTED BEFORE
 *
 * `pushDevice.ts` said "nothing worth unit-testing lives in it", and that was
 * true while every line of it was a call into somebody else's SDK. It stopped
 * being true when iOS stopped having one: the case of the token, which road a
 * platform takes, and which of five silences a launch reports are decisions
 * this module makes, and each of them is invisible from a device until a
 * tester locks their telephone and waits.
 *
 * The token still travels untouched -- `applePushToken.ts` is where the case
 * is held to its contract, and this file asserts that nothing here undoes it.
 */

const platform = vi.hoisted(() => ({ OS: 'ios' as string, Version: 34 }))

const notifee = vi.hoisted(() => ({ status: 1 }))

const apple = vi.hoisted(() => ({
  answer: { token: null, unread: 'noAnswer' } as AppleToken,
}))

const android = vi.hoisted(() => ({ token: 'fcm-token' }))

vi.mock('react-native', () => ({
  Platform: platform,
  PermissionsAndroid: {
    PERMISSIONS: { POST_NOTIFICATIONS: 'POST_NOTIFICATIONS' },
    RESULTS: { GRANTED: 'granted' },
    request: async () => 'granted',
  },
}))

// The permission, and nothing else: notifee answers the same four statuses
// Firebase did, drawn from the same UNAuthorizationStatus underneath.
vi.mock('@notifee/react-native', () => ({
  default: {
    requestPermission: async () => ({ authorizationStatus: notifee.status }),
  },
  AuthorizationStatus: {
    NOT_DETERMINED: -1,
    DENIED: 0,
    AUTHORIZED: 1,
    PROVISIONAL: 2,
  },
}))

vi.mock('@react-native-firebase/messaging', () => ({
  getMessaging: () => ({}),
  getToken: async () => android.token,
}))

vi.mock('./applePushToken', () => ({
  applePushToken: async () => apple.answer,
}))

/** Thirty-two bytes, as Apple hands them over, in the case UIKit gives. */
const TOKEN = '7A6B1F0C2D3E4F5061728394A5B6C7D8E9FA0B1C2D3E4F5061728394A5B6C7D8'

beforeEach(() => {
  platform.OS = 'ios'
  platform.Version = 34
  notifee.status = 1
  apple.answer = { token: TOKEN, unread: null }
  android.token = 'fcm-token'
})

describe('an iPhone', () => {
  it('takes Apple road with the token exactly as UIKit spelled it', async () => {
    expect(await pushTokenForThisDevice()).toEqual({
      token: TOKEN,
      road: 'ios',
    })
  })

  it('counts a provisional authorisation as a yes, quietly given', async () => {
    notifee.status = 2
    expect(await pushTokenForThisDevice()).toEqual({
      token: TOKEN,
      road: 'ios',
    })
  })

  it('stops at a refusal, and never asks Apple for a token', async () => {
    notifee.status = 0
    expect(await pushTokenForThisDevice()).toEqual({
      token: null,
      reason: 'notifications were not permitted',
    })
  })

  it('stops when nobody has decided yet either', async () => {
    notifee.status = -1
    expect(await pushTokenForThisDevice()).toEqual({
      token: null,
      reason: 'notifications were not permitted',
    })
  })
})

describe('the silence an iPhone reports', () => {
  /**
   * Each of the five reads differently, and that is the point of naming them.
   * A token that never arrived because this build has no native half is not a
   * token that has not arrived yet, and the second sentence is the one every
   * one of them used to get.
   */
  const sentences: ReadonlyArray<readonly [AppleToken, string]> = [
    [
      { token: null, unread: 'noAnswer' },
      'Apple has not answered with a token yet',
    ],
    [
      { token: null, unread: 'noModule' },
      'this build carries nothing that can ask Apple',
    ],
    [
      { token: null, unread: 'appleRefused' },
      'Apple refused to register this device',
    ],
    [
      { token: null, unread: 'notHex' },
      'Apple answered a token that is not upper case hexadecimal',
    ],
    [{ token: null, unread: 'threw' }, 'asking Apple threw'],
  ]

  for (const [answer, reason] of sentences) {
    it(`says "${reason}"`, async () => {
      apple.answer = answer
      expect(await pushTokenForThisDevice()).toEqual({ token: null, reason })
    })
  }

  it('gives every silence a sentence of its own', async () => {
    expect(new Set(sentences.map(([, reason]) => reason)).size).toBe(
      sentences.length,
    )
  })
})

describe('an Android telephone', () => {
  beforeEach(() => {
    platform.OS = 'android'
  })

  it('still goes through Firebase, which is its only road', async () => {
    expect(await pushTokenForThisDevice()).toEqual({
      token: 'fcm-token',
      road: 'android',
    })
  })

  it('treats a device with no Google on it as nothing to register', async () => {
    android.token = ''
    expect(await pushTokenForThisDevice()).toEqual({
      token: null,
      reason: 'no token',
    })
  })
})
