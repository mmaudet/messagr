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
    names: { all: async () => new Map(), set: async () => true },
    selfUserId: ME,
    lastRead: new Map(),
    ...over,
  }
}

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
