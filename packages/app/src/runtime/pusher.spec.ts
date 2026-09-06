import { describe, expect, it } from 'vitest'

import {
  describePusher,
  forgetPusher,
  registerPusher,
  type PusherPoster,
} from './pusher'

const TOKEN = 'fcm-token-abc'

describe('describePusher', () => {
  it('points the homeserver at this deployment’s own gateway', () => {
    const body = describePusher(TOKEN, 'https://messagr.eu/_messagr')
    expect(body.data.url).toBe(
      'https://messagr.eu/_messagr/_matrix/push/v1/notify',
    )
  })

  it('is keyed by the device token, which is what identifies the device', () => {
    const body = describePusher(TOKEN, 'https://messagr.eu/_messagr')
    expect(body.pushkey).toBe(TOKEN)
    expect(body.kind).toBe('http')
  })

  it('asks for the quietest format the protocol has', () => {
    // Belt as well as braces. The gateway strips everything regardless, but a
    // homeserver that sends less has less to be stripped, and one day this
    // pusher may point at a gateway somebody else runs.
    expect(describePusher(TOKEN, 'https://h/_m').data.format).toBe(
      'event_id_only',
    )
  })

  it('carries no default payload', () => {
    // `default_payload` is merged into the push by sygnal. Anything here
    // would be content this application put on the wire itself, which is the
    // one leak the gateway cannot prevent on its own behalf.
    expect(
      'default_payload' in describePusher(TOKEN, 'https://h/_m').data,
    ).toBe(false)
  })

  it('appends the gateway path exactly once, whatever the base looks like', () => {
    expect(describePusher(TOKEN, 'https://h/_m/').data.url).toBe(
      'https://h/_m/_matrix/push/v1/notify',
    )
  })

  it('names this build’s own application id, which sygnal keys on', () => {
    // A disagreement between this, the Gradle applicationId and sygnal's
    // `apps:` key produces no error anywhere -- the homeserver finds no
    // pushkin and drops the notification. Pinned here because nothing else
    // would notice.
    expect(describePusher(TOKEN, 'https://h/_m').app_id).toBe('eu.messagr')
  })

  it('carries no wildcard, which sygnal’s matching would accept', () => {
    const body = describePusher(TOKEN, 'https://h/_m')
    expect(body.app_id).not.toMatch(/[*?]/)
  })

  it('names the device in a way that names nobody', () => {
    // The homeserver shows `device_display_name` in the account's device
    // list, and it crosses no push infrastructure. It still says the product
    // and not the person, because a device list is a thing somebody may show
    // somebody else.
    const body = describePusher(TOKEN, 'https://h/_m')
    expect(body.device_display_name).toBe('Messagr')
    expect(body.app_display_name).toBe('Messagr')
  })
})

describe('registerPusher', () => {
  it('reports what it registered', async () => {
    let sent: unknown = null
    const poster: PusherPoster = async body => {
      sent = body
    }
    expect(await registerPusher(poster, TOKEN, 'https://h/_m')).toEqual({
      registered: true,
    })
    expect((sent as { pushkey: string }).pushkey).toBe(TOKEN)
  })

  it('says what went wrong rather than throwing into a launch', async () => {
    // A launch that failed because a notification could not be arranged is a
    // launch nobody can read their messages from.
    const poster: PusherPoster = async () => {
      throw new Error('the homeserver refused')
    }
    expect(await registerPusher(poster, TOKEN, 'https://h/_m')).toEqual({
      registered: false,
      reason: 'the homeserver refused',
    })
  })

  it('refuses to register a device with no token', async () => {
    let called = false
    const poster: PusherPoster = async () => {
      called = true
    }
    expect(await registerPusher(poster, '', 'https://h/_m')).toEqual({
      registered: false,
      reason: 'this device has no push token',
    })
    expect(called).toBe(false)
  })
})

describe('forgetPusher', () => {
  it('is the same application and key, with no kind', () => {
    // How a pusher is taken away: same route, `kind: null`. Without it,
    // turning notifications off would only stop the next launch registering
    // and the existing pusher would keep firing.
    expect(forgetPusher(TOKEN)).toEqual({
      app_id: 'eu.messagr',
      pushkey: TOKEN,
      kind: null,
    })
  })
})
