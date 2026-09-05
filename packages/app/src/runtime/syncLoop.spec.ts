import { describe, expect, it, vi } from 'vitest'

import type { SecretStore } from './sessionStore'
import {
  startSyncLoop,
  type RunningSyncLoop,
  type SyncLoopDeps,
  type SyncLoopMachine,
  type SyncLoopState,
  type SyncTick,
} from './syncLoop'

/**
 * Every test drives the loop to a fixed number of polls and stops it from
 * inside the fake homeserver, so nothing here depends on a timer. `sleep` is
 * injected and only records what it was asked to wait.
 *
 * The poll that stops the loop has its response discarded by design (see
 * `RunningSyncLoop.stop`), so a script of N responses exercises N-1 of them
 * and leaves the Nth as the one whose *request* is asserted on.
 */
interface Harness {
  readonly loop: RunningSyncLoop
  readonly requests: Array<Record<string, string>>
  readonly states: SyncLoopState[]
  readonly ticks: SyncTick[]
  readonly waits: number[]
  readonly events: string[]
  readonly cursor: { held: string | null }
}

interface HarnessOptions {
  readonly responses: Array<string | Error>
  readonly storedCursor?: string | null
  readonly receiveSyncChanges?: (delta: unknown) => Promise<void>
  readonly writeCursor?: (value: string) => Promise<void>
  readonly takeOutgoingRequests?: SyncLoopMachine['takeOutgoingRequests']
}

function drive(options: HarnessOptions): Harness {
  const requests: Array<Record<string, string>> = []
  const states: SyncLoopState[] = []
  const ticks: SyncTick[] = []
  const waits: number[] = []
  // One ordered trace across the machine, the store and the wire, because
  // several of the properties under test are about order rather than value.
  const events: string[] = []
  const cursor = { held: options.storedCursor ?? null }

  const box: { loop: RunningSyncLoop | null } = { loop: null }

  const store: SecretStore = {
    read: async () => cursor.held,
    write:
      options.writeCursor ??
      (async value => {
        events.push(`cursor:${value}`)
        cursor.held = value
      }),
  }

  const machine: SyncLoopMachine = {
    receiveSyncChanges: async delta => {
      events.push('receive')
      await options.receiveSyncChanges?.(delta)
    },
    takeOutgoingRequests:
      options.takeOutgoingRequests ??
      (async () => {
        events.push('drain')
        return []
      }),
    markRequestSent: async () => {},
    markRequestFailed: async () => {},
  }

  const deps: SyncLoopDeps = {
    http: {
      authedRequest: async (_method, _path, queryParams) => {
        requests.push(queryParams)
        events.push(`poll:${queryParams.since ?? 'none'}`)
        if (requests.length >= options.responses.length) box.loop?.stop()
        const scripted = options.responses[requests.length - 1]
        if (scripted instanceof Error) throw scripted
        return scripted ?? '{}'
      },
    },
    machine,
    encryptionSlice: (sync: Record<string, unknown>) =>
      sync as unknown as ReturnType<SyncLoopDeps['encryptionSlice']>,
    cursorStore: store,
    onTick: tick => ticks.push(tick),
    onState: state => states.push(state),
    sleep: async ms => {
      waits.push(ms)
    },
  }

  const loop = startSyncLoop(deps)
  box.loop = loop
  return { loop, requests, states, ticks, waits, events, cursor }
}

describe('startSyncLoop', () => {
  it('polls without a since token on the first launch of an install', async () => {
    const harness = drive({ responses: ['{"next_batch":"s_1"}'] })
    await harness.loop.stopped
    expect(harness.requests[0]).toEqual({ timeout: '30000' })
  })

  it('resumes from the cursor a previous launch persisted', async () => {
    const harness = drive({ responses: ['{}'], storedCursor: 's_earlier' })
    await harness.loop.stopped
    expect(harness.requests[0]).toEqual({
      timeout: '30000',
      since: 's_earlier',
    })
  })

  it('carries the token forward from one poll to the next', async () => {
    const harness = drive({ responses: ['{"next_batch":"s_2"}', '{}'] })
    await harness.loop.stopped
    expect(harness.requests.map(r => r.since)).toEqual([undefined, 's_2'])
  })

  it('persists the cursor so a relaunch does not replay from the beginning', async () => {
    const harness = drive({ responses: ['{"next_batch":"s_2"}', '{}'] })
    await harness.loop.stopped
    expect(harness.cursor.held).toBe('s_2')
  })

  it('advances the cursor only once the events it covers have been handled', async () => {
    const harness = drive({ responses: ['{"next_batch":"s_2"}', '{}'] })
    await harness.loop.stopped
    expect(harness.events).toEqual([
      'poll:none',
      'receive',
      'drain',
      'cursor:s_2',
      'poll:s_2',
    ])
  })

  it('does not advance the cursor when the machine could not take the changes', async () => {
    const harness = drive({
      responses: ['{"next_batch":"s_2"}', '{}'],
      receiveSyncChanges: async () => {
        throw new Error('the store is locked')
      },
    })
    await harness.loop.stopped
    expect(harness.cursor.held).toBeNull()
    // And the poll that follows asks for the same events again.
    expect(harness.requests.map(r => r.since)).toEqual([undefined, undefined])
  })

  it('sends whatever receiving the changes queued, before moving on', async () => {
    const takeOutgoingRequests = vi.fn(async () => [])
    const harness = drive({ responses: ['{}', '{}'], takeOutgoingRequests })
    await harness.loop.stopped
    expect(takeOutgoingRequests).toHaveBeenCalled()
  })

  it('reports the conversation spaces that moved', async () => {
    const harness = drive({
      responses: [
        '{"next_batch":"s_2","rooms":{"join":{"!a:x":{"timeline":{"events":[{}]}}}}}',
        '{}',
      ],
    })
    await harness.loop.stopped
    expect(harness.ticks[0]?.changedScopes).toEqual(['!a:x'])
  })

  it('reports a quiet poll as a tick with nothing in it, not as a failure', async () => {
    const harness = drive({ responses: ['{"next_batch":"s_2"}', '{}'] })
    await harness.loop.stopped
    expect(harness.ticks).toEqual([
      { changedScopes: [], cursorPersisted: true },
    ])
  })

  it('says so when the cursor could not be persisted, and keeps going', async () => {
    const harness = drive({
      responses: ['{"next_batch":"s_2"}', '{"next_batch":"s_3"}', '{}'],
      writeCursor: async () => {
        throw new Error('the keystore refused')
      },
    })
    await harness.loop.stopped
    expect(harness.ticks.map(t => t.cursorPersisted)).toEqual([false, false])
    // Held in memory even though it never reached the keystore, so this
    // launch stays live and only the next one replays.
    expect(harness.requests.map(r => r.since)).toEqual([
      undefined,
      's_2',
      's_3',
    ])
  })

  it('reports starting, then running once the homeserver has answered', async () => {
    const harness = drive({ responses: ['{}', '{}'] })
    await harness.loop.stopped
    expect(harness.states).toEqual(['starting', 'running', 'stopped'])
  })

  it('reports reconnecting when a poll fails, and running again when one works', async () => {
    const harness = drive({
      responses: [new Error('network changed'), '{}', '{}'],
    })
    await harness.loop.stopped
    expect(harness.states).toEqual([
      'starting',
      'reconnecting',
      'running',
      'stopped',
    ])
  })

  it('backs off further on each successive failure rather than spinning', async () => {
    const harness = drive({
      responses: [
        new Error('down'),
        new Error('down'),
        new Error('down'),
        '{}',
      ],
    })
    await harness.loop.stopped
    expect(harness.waits).toEqual([1_000, 2_000, 4_000])
  })

  it('caps the backoff so a loop that is waiting is still a loop that is trying', async () => {
    const harness = drive({
      responses: Array.from({ length: 8 }, () => new Error('down')),
    })
    await harness.loop.stopped
    expect(harness.waits[harness.waits.length - 1]).toBe(30_000)
  })

  it('starts backing off from the beginning again after a poll that worked', async () => {
    const harness = drive({
      responses: [
        new Error('down'),
        new Error('down'),
        '{}',
        new Error('down'),
        '{}',
      ],
    })
    await harness.loop.stopped
    expect(harness.waits).toEqual([1_000, 2_000, 1_000])
  })

  it('says it stopped, so nothing can show a live screen over a loop that is gone', async () => {
    const harness = drive({ responses: ['{}'] })
    await harness.loop.stopped
    expect(harness.states[harness.states.length - 1]).toBe('stopped')
  })

  it('makes no further poll once stopped', async () => {
    const harness = drive({ responses: ['{}', '{}', '{}'] })
    await harness.loop.stopped
    expect(harness.requests).toHaveLength(3)
  })

  it('discards a response that arrives after the loop was stopped', async () => {
    const harness = drive({ responses: ['{"next_batch":"s_late"}'] })
    await harness.loop.stopped
    expect(harness.cursor.held).toBeNull()
    expect(harness.ticks).toEqual([])
  })

  it('stops without waiting out a backoff it no longer needs', async () => {
    const harness = drive({ responses: [new Error('down')] })
    await harness.loop.stopped
    expect(harness.waits).toEqual([])
  })
})
