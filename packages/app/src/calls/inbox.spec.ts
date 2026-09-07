import { describe, expect, it } from 'vitest'

import type { HttpRequester } from '../runtime/pump'
import { fetchTurnServer } from './ice'
import { openCallEvents, type OpeningDeps } from './inbox'

/**
 * Which events out of a poll are a call at all, and where the relay
 * credentials come from.
 *
 * The rest of `callPump.ts` is one shape of wiring, proved by the thing it
 * wires. These two are decisions, so they live in modules with no native
 * import in them and are tested with no homeserver, no microphone and no
 * device.
 */

const encode = (text: string) => new TextEncoder().encode(text)
const decodeUtf8 = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

/**
 * A crypto machine that opens what it was told to and refuses the rest.
 *
 * `eventType` is the field this whole module turns on: an encrypted event's
 * outer type is `m.room.encrypted` and says nothing, so the inner type off
 * the envelope is the only place the answer exists.
 */
function opener(
  opens: Record<string, { eventType: string; content: unknown } | Error>,
) {
  const asked: string[] = []
  return {
    asked,
    decodeUtf8,
    machine: {
      decryptEvent: async (_scope: string, rawEvent: unknown) => {
        const id = (rawEvent as { event_id: string }).event_id
        asked.push(id)
        const answer = opens[id]
        if (answer === undefined || answer instanceof Error) {
          throw answer ?? new Error('no session')
        }
        return {
          eventType: answer.eventType,
          ciphertext: encode(JSON.stringify(answer.content)),
        }
      },
    },
  }
}

const sealed = (id: string, sender = '@her:messagr.eu') => ({
  type: 'm.room.encrypted',
  event_id: id,
  sender,
  content: { algorithm: 'm.megolm.v1.aes-sha2', ciphertext: 'x' },
})

const deps = (built: ReturnType<typeof opener>): OpeningDeps => built

describe('fetchTurnServer', () => {
  it('asks the endpoint the specification names', async () => {
    const asked: string[] = []
    const http: HttpRequester = {
      authedRequest: async (_method, path) => {
        asked.push(path)
        return JSON.stringify({ uris: [] })
      },
    }
    await fetchTurnServer(http)
    expect(asked).toEqual(['/_matrix/client/v3/voip/turnServer'])
  })

  it('hands the body on without reading it', async () => {
    // `iceConfigFrom` is what decides whether these credentials can carry a
    // call, and it reads every field defensively because this came off a
    // network. A second opinion here would be a second place to disagree.
    const answer = {
      uris: ['turn:relay.example.org:3478'],
      ttl: 'not a number',
    }
    const http: HttpRequester = {
      authedRequest: async () => JSON.stringify(answer),
    }
    expect(await fetchTurnServer(http)).toEqual(answer)
  })
  it('reads a 404 as a homeserver with no relay, not as a failed request', async () => {
    // The endpoint's own error table: a homeserver with no TURN SHOULD
    // answer 404 `M_NOT_FOUND`. Left as a throw it reached the screen as a
    // raw `MatrixError: [404]`, which is what messagr-fork answers today.
    const http: HttpRequester = {
      authedRequest: async () => {
        throw Object.assign(new Error('[404] Not Found'), { httpStatus: 404 })
      },
    }
    expect(await fetchTurnServer(http)).toEqual({ uris: [] })
  })

  it('lets any other failure through, because it is not an answer', async () => {
    const http: HttpRequester = {
      authedRequest: async () => {
        throw Object.assign(new Error('gateway timed out'), { httpStatus: 504 })
      },
    }
    await expect(fetchTurnServer(http)).rejects.toThrow('gateway timed out')
  })
})

describe('openCallEvents', () => {
  it('keeps the call events and drops everything else in the poll', async () => {
    const built = opener({
      $msg: { eventType: 'm.room.message', content: { body: 'bonjour' } },
      $invite: { eventType: 'm.call.invite', content: { call_id: 'c1' } },
    })
    const opened = await openCallEvents(deps(built), '!room:x', [
      sealed('$msg'),
      sealed('$invite'),
    ])
    expect(opened).toEqual([
      {
        type: 'm.call.invite',
        sender: '@her:messagr.eu',
        content: { call_id: 'c1' },
      },
    ])
  })

  it('keeps them in the order they arrived', async () => {
    // Signalling is a conversation: an answer before its invite is not the
    // same call, and candidates applied out of order are candidates applied
    // to a connection that has not been told where to send them.
    const built = opener({
      $a: { eventType: 'm.call.invite', content: { n: 1 } },
      $b: { eventType: 'm.call.candidates', content: { n: 2 } },
      $c: { eventType: 'm.call.hangup', content: { n: 3 } },
    })
    const opened = await openCallEvents(deps(built), '!room:x', [
      sealed('$a'),
      sealed('$b'),
      sealed('$c'),
    ])
    const order = opened.map(
      event => (event as { content: { n: number } }).content.n,
    )
    expect(order).toEqual([1, 2, 3])
  })

  it('does not let one event that will not open cost the others', async () => {
    // ICE needs one path to work, so half a candidate list is worth having.
    // And this runs on the sync loop's own thread, where a throw belongs to
    // nobody.
    const built = opener({
      $lost: new Error('crypto error: undecryptable'),
      $kept: { eventType: 'm.call.candidates', content: { call_id: 'c1' } },
    })
    const opened = await openCallEvents(deps(built), '!room:x', [
      sealed('$lost'),
      sealed('$kept'),
    ])
    expect(opened).toHaveLength(1)
  })

  it('does not ask the crypto machine about an event that was never sealed', async () => {
    // A room can carry unencrypted events. Handing one to a decryptor is a
    // failure logged for a reason that has nothing to do with what happened.
    const built = opener({})
    await openCallEvents(deps(built), '!room:x', [
      { type: 'm.room.member', event_id: '$m', sender: '@her:messagr.eu' },
    ])
    expect(built.asked).toEqual([])
  })

  it('refuses an event with no sender, because a call is between two people', async () => {
    const built = opener({
      $anon: { eventType: 'm.call.invite', content: {} },
    })
    const opened = await openCallEvents(deps(built), '!room:x', [
      { ...sealed('$anon'), sender: undefined },
    ])
    expect(opened).toEqual([])
    expect(built.asked).toEqual([])
  })
})
