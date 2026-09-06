import { describe, expect, it } from 'vitest'

import type { HttpRequester } from './pump'
import { reactTo, unreact, type ReactingDeps } from './react'

interface Call {
  method: string
  path: string
  body: string | undefined
}

function harness(options: { refuse?: boolean } = {}) {
  const calls: Call[] = []
  const http: HttpRequester = {
    authedRequest: async (method, path, _query, body) => {
      calls.push({ method, path, body })
      if (options.refuse === true) throw new Error('the homeserver refused')
      return JSON.stringify({ event_id: '$sent' })
    },
  }
  const deps: ReactingDeps = {
    http,
    machine: {
      // Echoes what it was asked to encrypt, which is what lets the test
      // assert on the payload that crossed the boundary rather than on a
      // ciphertext nothing here can read.
      encryptEvent: async (_scope, eventType, payload) => ({
        ciphertext: new TextEncoder().encode(
          JSON.stringify({ eventType, payload }),
        ),
      }),
    },
    decodeUtf8: bytes => new TextDecoder().decode(bytes),
    newTransactionId: () => 'txn-1',
  }
  return { deps, calls }
}

describe('reactTo', () => {
  it('sends the reaction and names the event it made', async () => {
    const { deps } = harness()
    expect(await reactTo(deps, '!a:x', '$m1', '👍')).toEqual({
      reacted: true,
      eventId: '$sent',
    })
  })

  it('carries Matrix’s own annotation shape, inside the ciphertext', async () => {
    // The shape is standard even though nothing outside this application
    // reads it: the day it has to be legible elsewhere, only the boundary
    // moves and not the payload.
    const { deps, calls } = harness()
    await reactTo(deps, '!a:x', '$m1', '👍')
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({
      eventType: 'm.reaction',
      payload: {
        'm.relates_to': {
          rel_type: 'm.annotation',
          event_id: '$m1',
          key: '👍',
        },
      },
    })
  })

  it('sends as an encrypted event, which is the only type on the wire', async () => {
    const { deps, calls } = harness()
    await reactTo(deps, '!a:x', '$m1', '👍')
    expect(calls[0]?.path).toContain('/send/m.room.encrypted/')
  })

  it('refuses to react with nothing rather than sending an empty key', async () => {
    const { deps, calls } = harness()
    const reacted = await reactTo(deps, '!a:x', '$m1', '')
    expect(reacted.reacted).toBe(false)
    expect(calls).toEqual([])
  })

  it('reports a refusal rather than throwing it at the screen', async () => {
    const { deps } = harness({ refuse: true })
    const reacted = await reactTo(deps, '!a:x', '$m1', '👍')
    expect(reacted.reacted).toBe(false)
    if (!reacted.reacted) expect(reacted.reason).toContain('refused')
  })
})

describe('unreact', () => {
  it('redacts the event that made the reaction', async () => {
    const { deps, calls } = harness()
    expect(await unreact(deps, '!a:x', '$r1')).toEqual({ removed: true })
    expect(calls[0]?.method).toBe('PUT')
    expect(calls[0]?.path).toContain('/redact/%24r1/')
  })

  it('reports a redaction that did not happen, rather than throwing', async () => {
    // A chip that will not come off is something a person can act on. It is
    // not a reason to lose the conversation it is attached to.
    const { deps } = harness({ refuse: true })
    const removed = await unreact(deps, '!a:x', '$r1')
    expect(removed.removed).toBe(false)
    expect(removed.reason).toContain('refused')
  })
})
