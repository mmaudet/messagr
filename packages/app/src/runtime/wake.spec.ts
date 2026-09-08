import { describe, expect, it, vi } from 'vitest'

import { readNotification, type Notification } from './notifying'
import { wake, type Arrival, type Calling, type WakeDeps } from './wake'

function deps(over: Partial<WakeDeps> = {}): WakeDeps & {
  readonly drawn: Notification[]
  readonly rang: Calling[]
} {
  const drawn: Notification[] = []
  const rang: Calling[] = []
  return {
    drawn,
    rang,
    lookForWhatArrived: async () => ({ messages: [], ringing: [] }),
    draw: async notification => {
      drawn.push(notification)
    },
    ring: async calling => {
      rang.push(calling)
    },
    describe: (arrival: Arrival) =>
      readNotification(arrival.scope, arrival.shown, arrival.preview),
    ...over,
  }
}

const ARRIVAL: Arrival = {
  scope: '!a:messagr.eu',
  shown: 'Maria',
  preview: 'see you at eight',
}

const CALLING: Calling = {
  scope: '!a:messagr.eu',
  shown: 'Maria',
  from: '@maria:messagr.eu',
}

describe('a telephone that is ringing', () => {
  it('rings, rather than drawing a line about it', async () => {
    const d = deps({
      lookForWhatArrived: async () => ({ messages: [], ringing: [CALLING] }),
    })
    expect(await wake(d)).toEqual({ drew: 'ringing', count: 1 })
    expect(d.rang).toEqual([CALLING])
    expect(d.drawn).toEqual([])
  })

  it('comes first, and alone, when messages arrived in the same poll', async () => {
    // Somebody is holding a telephone with ninety seconds on it. Drawing
    // message notifications first spends that budget on lines nobody is
    // waiting on, and a message notification over a ringing call is a call
    // somebody misses. The messages are still there at the next wake.
    const d = deps({
      lookForWhatArrived: async () => ({
        messages: [ARRIVAL],
        ringing: [CALLING],
      }),
    })
    expect(await wake(d)).toEqual({ drew: 'ringing', count: 1 })
    expect(d.drawn).toEqual([])
  })

  it('still rings the second when the first will not ring', async () => {
    const d = deps({
      lookForWhatArrived: async () => ({
        messages: [],
        ringing: [CALLING, { ...CALLING, scope: '!b:messagr.eu' }],
      }),
      ring: vi
        .fn<(calling: Calling) => Promise<void>>()
        .mockRejectedValueOnce(new Error('the channel is gone'))
        .mockResolvedValue(undefined),
    })
    expect(await wake(d)).toEqual({ drew: 'ringing', count: 2 })
  })
})

describe('wake', () => {
  it('says who and what once the store opened', async () => {
    const d = deps({
      lookForWhatArrived: async () => ({ messages: [ARRIVAL], ringing: [] }),
    })
    expect(await wake(d)).toEqual({ drew: 'read', count: 1 })
    expect(d.drawn[0]).toEqual({
      id: '!a:messagr.eu',
      title: 'Maria',
      body: 'see you at eight',
    })
  })

  it('names nobody when the store will not open', async () => {
    // The case ADR-0008 bounds: a phone not unlocked since it was switched on.
    const d = deps({ lookForWhatArrived: async () => null })
    const outcome = await wake(d)
    expect(outcome.drew).toBe('blind')
    const wire = `${d.drawn[0]!.title} ${d.drawn[0]!.body}`
    expect(wire).not.toContain('Maria')
    expect(wire).not.toContain('!a:messagr.eu')
  })

  it('still says something arrived when the look itself failed', async () => {
    // The homeserver woke this device because it had something to deliver.
    // Failing to fetch it does not unmake that, and silence would lose the
    // notification entirely -- which is what a person actually notices.
    const d = deps({
      lookForWhatArrived: async () => {
        throw new Error('the homeserver was unreachable')
      },
    })
    expect(await wake(d)).toEqual({
      drew: 'blind',
      reason: 'the homeserver was unreachable',
    })
    expect(d.drawn).toHaveLength(1)
  })

  it('draws nothing at all when nothing is waiting', async () => {
    // Ordinary: the message may have been read on another device between the
    // push and this. "Something arrived" for it would be about nothing.
    const d = deps({
      lookForWhatArrived: async () => ({ messages: [], ringing: [] }),
    })
    expect(await wake(d)).toEqual({ drew: 'nothing' })
    expect(d.drawn).toHaveLength(0)
  })

  it('draws one per conversation', async () => {
    const d = deps({
      lookForWhatArrived: async () => ({
        messages: [
          ARRIVAL,
          { scope: '!b:messagr.eu', shown: 'Jo', preview: 'on my way' },
        ],
        ringing: [],
      }),
    })
    expect(await wake(d)).toEqual({ drew: 'read', count: 2 })
    expect(d.drawn.map(n => n.id)).toEqual(['!a:messagr.eu', '!b:messagr.eu'])
  })

  it('does not let a drawing failure lose the others', async () => {
    // A `draw` that throws is a platform refusing one notification. The rest
    // still have to arrive, so this is asserted rather than assumed.
    const draw = vi
      .fn<(n: Notification) => Promise<void>>()
      .mockRejectedValueOnce(new Error('channel gone'))
      .mockResolvedValue(undefined)
    const d = deps({
      draw,
      lookForWhatArrived: async () => ({
        messages: [
          ARRIVAL,
          { scope: '!b:messagr.eu', shown: 'Jo', preview: 'on my way' },
        ],
        ringing: [],
      }),
    })
    await expect(wake(d)).resolves.toEqual({ drew: 'read', count: 2 })
    expect(draw).toHaveBeenCalledTimes(2)
  })
})
