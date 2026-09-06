import { describe, expect, it } from 'vitest'

import { PumpHttpError, type HttpRequester } from './pump'
import {
  PROMOTED_LEVEL,
  theOtherMember,
  vouchFor,
  type HistoryMachine,
  type MediaUploader,
} from './vouch'

const SCOPE = '!scope:example.org'
const ENTRANT = '@entrant:example.org'

/** What a conversation this product created looks like, before promotion. */
function rules() {
  return {
    users: { '@inviter:example.org': 100 },
    users_default: 0,
    invite: 50,
  }
}

/**
 * A world in which everything works, recording the order things happened in.
 * The order is what most of these tests are about, so it is the fixture's
 * first responsibility rather than an afterthought.
 */
function world(
  overrides: {
    readonly shared?: number
    readonly withheld?: number
    readonly toDeviceSends?: boolean
    readonly uploadFails?: boolean
    readonly announceFails?: boolean
    /**
     * The drain has a request to send and the send is refused. Different
     * from `toDeviceSends: false`, which is the machine having nothing to
     * send at all -- and telling those two apart is what #119 is about.
     */
    readonly drainRefuses?: boolean
  } = {},
) {
  const log: string[] = []
  const uploaded: Uint8Array[] = []
  const announced: { url: string; secret: string; userId: string }[] = []
  const state = { content: rules() as Record<string, unknown> }

  const http: HttpRequester = {
    authedRequest: async (method, path, _query, body) => {
      if (path.includes('/sendToDevice/')) {
        if (overrides.drainRefuses === true) {
          throw new PumpHttpError('the homeserver refused it', 502)
        }
        log.push('to-device sent')
        return '{}'
      }
      if (path.includes('m.room.power_levels')) {
        if (method === 'GET') return JSON.stringify(state.content)
        log.push('power level raised')
        state.content = JSON.parse(body ?? '{}') as Record<string, unknown>
        return JSON.stringify({ event_id: '$put' })
      }
      return '{}'
    },
  }

  const machine: HistoryMachine = {
    buildHistoryBundle: async () => {
      log.push('bundle built')
      return {
        ciphertext: new Uint8Array([7, 7, 7]),
        secret: '{"v":"v2","key":{"k":"opaque"}}',
        shared: overrides.shared ?? 4,
        withheld: overrides.withheld ?? 1,
      }
    },
    shareHistoryBundle: async (_scope, userId, url, secret) => {
      if (overrides.announceFails === true) throw new Error('announce refused')
      log.push('announcement queued')
      announced.push({ url, secret, userId })
    },
    takeOutgoingRequests: async () =>
      overrides.toDeviceSends === false && overrides.drainRefuses !== true
        ? []
        : [
            {
              id: 'txn-1',
              kind: 'to_device',
              body: JSON.stringify({
                event_type: 'm.room.encrypted',
                txn_id: 'txn-1',
                messages: {},
              }),
            },
          ],
    markRequestSent: async () => undefined,
    markRequestFailed: async () => undefined,
  }

  const media: MediaUploader = {
    upload: async bytes => {
      if (overrides.uploadFails === true) throw new Error('repository full')
      log.push('ciphertext uploaded')
      uploaded.push(bytes)
      return 'mxc://example.org/abc'
    },
  }

  return {
    http,
    machine,
    media,
    log,
    uploaded,
    announced,
    rulesNow: () => state.content,
  }
}

describe('vouching for an entrant', () => {
  it('reports the history given and the power read back from the room', async () => {
    const w = world()
    const outcome = await vouchFor(w.http, w.machine, w.media, SCOPE, ENTRANT)

    expect(outcome.vouched).toBe(true)
    if (!outcome.vouched) return
    expect(outcome.shared).toBe(4)
    expect(outcome.withheld).toBe(1)
    // Read back from the conversation, not assumed from the request.
    expect(outcome.power.held).toBe(PROMOTED_LEVEL)
    expect(outcome.power.mayInvite).toBe(true)
  })

  it('sends the history before it raises the power level', async () => {
    // THE TEST THIS GESTURE EXISTS FOR. A power level is public state and is
    // what the invitation service reads. Raised first, it would announce a
    // promotion whose keys are still in flight; raised last, it means the
    // keys already went out.
    const w = world()
    await vouchFor(w.http, w.machine, w.media, SCOPE, ENTRANT)

    expect(w.log).toEqual([
      'bundle built',
      'ciphertext uploaded',
      'announcement queued',
      'to-device sent',
      'power level raised',
    ])
  })

  it('refuses to promote when the announcement was queued but not sent', async () => {
    // The failure that looks like success: `shareHistoryBundle` only queues.
    // Promoting after the call but before the drain would raise the level
    // while the announcement sat in a queue -- the exact inversion the order
    // exists to prevent, reached by a route that looks correct.
    const w = world({ toDeviceSends: false })
    const outcome = await vouchFor(w.http, w.machine, w.media, SCOPE, ENTRANT)

    expect(outcome.vouched).toBe(false)
    if (outcome.vouched) return
    expect(outcome.stage).toBe('sending')
    expect(outcome.promoted).toBe(false)
    expect(w.log).not.toContain('power level raised')
  })

  it('says the devices are not known yet, rather than that nothing reported why', async () => {
    // TWO FAILURES USED TO WEAR ONE SENTENCE.
    //
    // A drain that sends no to-device request and reports no failure is not
    // a mystery: the machine had no devices to send to. That is what happens
    // to somebody who entered moments ago, before this device has seen their
    // keys, and the honest answer is "wait and try again".
    //
    // It read "nothing reported why", which sent me looking for a fault that
    // was not there, on two devices (#119). The distinction is pinned here
    // because it is the difference between what the person should do next.
    const w = world({ toDeviceSends: false })
    const outcome = await vouchFor(w.http, w.machine, w.media, SCOPE, ENTRANT)

    expect(outcome.vouched).toBe(false)
    if (outcome.vouched) return
    expect(outcome.reason).toContain('does not know')
    expect(outcome.reason).not.toContain('refused')
  })

  it('says it was refused when something actually refused it', async () => {
    // The other half, and the one that must not say "wait a moment": trying
    // again immediately will be refused the same way.
    const w = world({ toDeviceSends: false, drainRefuses: true })
    const outcome = await vouchFor(w.http, w.machine, w.media, SCOPE, ENTRANT)

    expect(outcome.vouched).toBe(false)
    if (outcome.vouched) return
    expect(outcome.reason).toContain('refused')
    expect(outcome.reason).toContain('to_device')
  })

  it('uploads the ciphertext and never the secret', async () => {
    // The secret is the key to every session in the bundle. Uploading it
    // would put that key in the media repository beside the file it opens.
    const w = world()
    await vouchFor(w.http, w.machine, w.media, SCOPE, ENTRANT)

    expect(w.uploaded).toHaveLength(1)
    expect(Array.from(w.uploaded[0]!)).toEqual([7, 7, 7])
    const asText = new TextDecoder().decode(w.uploaded[0]!)
    expect(asText).not.toContain('opaque')
  })

  it('announces the location the upload returned, with the secret untouched', async () => {
    const w = world()
    await vouchFor(w.http, w.machine, w.media, SCOPE, ENTRANT)

    expect(w.announced).toEqual([
      {
        url: 'mxc://example.org/abc',
        secret: '{"v":"v2","key":{"k":"opaque"}}',
        userId: ENTRANT,
      },
    ])
  })

  it('promotes even when there is no history to give', async () => {
    // A conversation nothing has been said in yet has no past to hand over.
    // Refusing here would make vouching depend on whether anybody had
    // spoken, which is not what the gesture means.
    const w = world({ shared: 0, withheld: 0 })
    const outcome = await vouchFor(w.http, w.machine, w.media, SCOPE, ENTRANT)

    expect(outcome.vouched).toBe(true)
    if (!outcome.vouched) return
    expect(outcome.shared).toBe(0)
    expect(outcome.power.held).toBe(PROMOTED_LEVEL)
  })

  it('leaves the entrant un-promoted when the upload fails', async () => {
    const w = world({ uploadFails: true })
    const outcome = await vouchFor(w.http, w.machine, w.media, SCOPE, ENTRANT)

    expect(outcome.vouched).toBe(false)
    if (outcome.vouched) return
    expect(outcome.stage).toBe('uploading')
    expect(outcome.reason).toContain('repository full')
    expect(w.log).not.toContain('power level raised')
  })

  it('leaves the entrant un-promoted when the announcement is refused', async () => {
    const w = world({ announceFails: true })
    const outcome = await vouchFor(w.http, w.machine, w.media, SCOPE, ENTRANT)

    expect(outcome.vouched).toBe(false)
    if (outcome.vouched) return
    expect(outcome.stage).toBe('announcing')
    expect(w.log).not.toContain('power level raised')
  })

  it('says the promotion did not happen, rather than leaving it to be inferred', async () => {
    // Every failure stops before the promotion, because the promotion is
    // last. Saying so lets a caller tell a person "nothing changed for them"
    // without reasoning about the order themselves.
    for (const overrides of [
      { uploadFails: true },
      { announceFails: true },
      { toDeviceSends: false },
    ]) {
      const w = world(overrides)
      const outcome = await vouchFor(w.http, w.machine, w.media, SCOPE, ENTRANT)
      expect(outcome.vouched).toBe(false)
      if (outcome.vouched) continue
      expect(outcome.promoted).toBe(false)
    }
  })

  it('does not touch the rest of the conversation rules', async () => {
    // The promotion goes through `grantPower`, which carries the content
    // across whole. Asserted here too, because this is the call site where
    // losing `invite` would let every entrant invite.
    const w = world()
    await vouchFor(w.http, w.machine, w.media, SCOPE, ENTRANT)

    const after = w.rulesNow()
    expect(after.invite).toBe(50)
    expect(
      (after.users as Record<string, number>)['@inviter:example.org'],
    ).toBe(100)
  })
})

describe('naming who a gesture is for', () => {
  const SELF = '@me:example.org'

  it('finds the other person in a conversation of two', () => {
    expect(theOtherMember([SELF, ENTRANT], SELF)).toBe(ENTRANT)
    expect(theOtherMember([ENTRANT, SELF], SELF)).toBe(ENTRANT)
  })

  it('refuses to pick one out of three', () => {
    // A conversation of three has no "other person", and choosing one would
    // be this application inventing a target for something irreversible.
    expect(
      theOtherMember([SELF, ENTRANT, '@third:example.org'], SELF),
    ).toBeNull()
  })

  it('refuses a conversation this account is alone in', () => {
    expect(theOtherMember([SELF], SELF)).toBeNull()
    expect(theOtherMember([], SELF)).toBeNull()
  })
})
