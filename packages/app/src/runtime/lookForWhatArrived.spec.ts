import { describe, expect, it, vi } from 'vitest'

import { lookForWhatArrived, type Looking } from './lookForWhatArrived'
import type { HttpRequester } from './pump'

const ME = '@me:messagr.eu'
const HER = '@maria:messagr.eu'

/**
 * A sync response shaped the way `readChangedScopes` reads one: a room counts
 * as changed only when its timeline actually carries events. The first
 * version of this helper returned bare objects, and every "found something"
 * case answered nothing -- the test was wrong and the code was stricter.
 */
function syncing(scopes: readonly string[]): HttpRequester {
  const join = Object.fromEntries(
    scopes.map(scope => [
      scope,
      { timeline: { events: [{ type: 'm.room.encrypted' }] } },
    ]),
  )
  return {
    authedRequest: async () => JSON.stringify({ rooms: { join } }),
  } as unknown as HttpRequester
}

function looking(over: Partial<Looking> = {}): Looking {
  return {
    http: syncing(['!a:x']),
    since: 's_1',
    readConversation: async () => [
      { claimedSender: HER, sentAt: 200, body: 'see you at eight' },
    ],
    // No calls unless a test says so: every assertion in this file below
    // the ringing block is about messages.
    openCalls: async () => [],
    takeTheKeys: async () => {},
    now: () => 1_700_000_000_000,
    names: { all: async () => new Map(), set: async () => true },
    selfUserId: ME,
    lastRead: new Map(),
    ...over,
  }
}

describe('the room key that came with it', () => {
  it('hands the sync to the crypto machine before opening anything', async () => {
    // THE ONE THAT WOULD HAVE CAUGHT IT. A Megolm event is unreadable
    // without its room key, and that key arrives as a to-device message in
    // the very same sync response as the event it unlocks --
    // `receiveDecrypt.ts` records the same defect on the probe's path. The
    // wake read the ciphertext and ignored the key beside it, and reported
    // `missing_key` on the demonstration Pixel.
    const order: string[] = []
    await lookForWhatArrived(
      looking({
        takeTheKeys: async () => {
          order.push('keys')
        },
        readConversation: async () => {
          order.push('read')
          return []
        },
        openCalls: async () => {
          order.push('calls')
          return []
        },
      }),
    )
    expect(order[0]).toBe('keys')
  })

  it('still reports what it can read when the keys could not be taken', async () => {
    // A device that could not take them may still hold the session for
    // something older, and there is no screen here to tell either way.
    const { messages } = await lookForWhatArrived(
      looking({
        takeTheKeys: async () => {
          throw new Error('the machine refused')
        },
      }),
    )
    expect(messages).toHaveLength(1)
  })
})

describe('lookForWhatArrived', () => {
  it('says who and what', async () => {
    const { messages: found } = await lookForWhatArrived(
      looking({
        names: {
          all: async () => new Map([[HER, 'Maria']]),
          set: async () => true,
        },
      }),
    )
    expect(found).toEqual([
      { scope: '!a:x', shown: 'Maria', preview: 'see you at eight' },
    ])
  })

  it('falls back to the identifier when nobody has named them', async () => {
    // Shortened to the localpart, which is exactly what a list row shows for
    // somebody unnamed. A notification that spelled out the homeserver where
    // the list does not would read as a different person.
    const { messages: found } = await lookForWhatArrived(looking())
    expect(found[0]?.shown).toBe('@maria')
  })

  it('finds nothing when nothing changed', async () => {
    expect(
      (await lookForWhatArrived(looking({ http: syncing([]) }))).messages,
    ).toEqual([])
  })

  it('does not announce this account’s own message', async () => {
    // Sent from another device of the same account. A notification for
    // something you just wrote says the notifications mean nothing.
    const { messages: found } = await lookForWhatArrived(
      looking({
        readConversation: async () => [
          { claimedSender: ME, sentAt: 300, body: 'sent from my laptop' },
        ],
      }),
    )
    expect(found).toEqual([])
  })

  it('does not announce what was already read here', async () => {
    const { messages: found } = await lookForWhatArrived(
      looking({ lastRead: new Map([['!a:x', 200]]) }),
    )
    expect(found).toEqual([])
  })

  it('announces one per conversation, the newest', async () => {
    // Not one per message: a phone that buzzes eleven times for a
    // conversation somebody is in the middle of.
    const { messages: found } = await lookForWhatArrived(
      looking({
        readConversation: async () => [
          { claimedSender: HER, sentAt: 100, body: 'first' },
          { claimedSender: HER, sentAt: 200, body: 'second' },
          { claimedSender: HER, sentAt: 300, body: 'third' },
        ],
      }),
    )
    expect(found).toHaveLength(1)
    expect(found[0]?.preview).toBe('third')
  })

  it('announces a message it cannot read, with nothing quoted', async () => {
    // Still a message that arrived. The conversation itself does the same
    // with the same event.
    const { messages: found } = await lookForWhatArrived(
      looking({
        readConversation: async () => [
          { claimedSender: HER, sentAt: 300, body: null },
        ],
      }),
    )
    expect(found[0]?.preview).toBe('')
    expect(found[0]?.shown).toBe('@maria')
  })

  it('keeps the conversations it can read when one refuses', async () => {
    // In a headless context there is no screen on which to notice that one
    // conversation silenced the rest.
    const readConversation = vi
      .fn<
        (
          scope: string,
        ) => Promise<
          | never[]
          | { claimedSender: string; sentAt: number; body: string | null }[]
        >
      >()
      .mockImplementation(async (scope: string) => {
        if (scope === '!bad:x') throw new Error('no key for this one')
        return [{ claimedSender: HER, sentAt: 300, body: 'readable' }]
      })
    const { messages: found } = await lookForWhatArrived(
      looking({
        http: syncing(['!bad:x', '!good:x']),
        readConversation,
      }),
    )
    expect(found.map(a => a.scope)).toEqual(['!good:x'])
  })

  it('asks for no long poll, because a wake has seconds', async () => {
    let asked = ''
    const { messages: found } = await lookForWhatArrived(
      looking({
        http: {
          authedRequest: async (_m: string, path: string) => {
            asked = path
            return JSON.stringify({ rooms: { join: {} } })
          },
        } as unknown as HttpRequester,
      }),
    )
    expect(asked).toContain('timeout=0')
    expect(asked).toContain('since=s_1')
    expect(found).toEqual([])
  })

  it('syncs from the beginning on a device that has never synced', async () => {
    let asked = ''
    await lookForWhatArrived(
      looking({
        since: null,
        http: {
          authedRequest: async (_m: string, path: string) => {
            asked = path
            return JSON.stringify({ rooms: { join: {} } })
          },
        } as unknown as HttpRequester,
      }),
    )
    expect(asked).not.toContain('since=')
  })
})

describe('a ringing call that carries a picture', () => {
  /** An invitation as the homeserver hands one back, with its offer. */
  function invitation(sdp?: string) {
    return {
      type: 'm.call.invite',
      sender: HER,
      ...(sdp === undefined ? {} : { content: { offer: { sdp } } }),
    }
  }

  it('is marked video when the offer sends one', async () => {
    const { ringing } = await lookForWhatArrived(
      looking({
        openCalls: async () => [
          invitation(
            'v=0\r\nm=audio 9 RTP 111\r\nm=video 9 RTP 96\r\na=sendrecv',
          ),
        ],
      }),
    )
    expect(ringing[0]?.video).toBe(true)
  })

  it('is not marked for an audio call', async () => {
    const { ringing } = await lookForWhatArrived(
      looking({
        openCalls: async () => [invitation('v=0\r\nm=audio 9 RTP 111')],
      }),
    )
    expect(ringing[0]?.video).toBeUndefined()
  })

  it('is not marked when the invitation carries no offer at all', async () => {
    // Another client, or a malformed event. The notification says "appel"
    // rather than guessing at a picture.
    const { ringing } = await lookForWhatArrived(
      looking({ openCalls: async () => [invitation()] }),
    )
    expect(ringing[0]?.video).toBeUndefined()
  })
})
