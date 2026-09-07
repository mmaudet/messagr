import { describe, expect, it, vi } from 'vitest'

import type { CallState } from './machine'
import type { AudioTrackLike, PeerConnectionLike } from './media'
import {
  CallSessionError,
  startCallSession,
  type CallSessionPorts,
} from './session'
import type { CallEvent, Candidate, SessionDescription } from './wire'

/**
 * The wiring, tested without a homeserver and without a telephone.
 *
 * Nothing here re-tests a rule that lives elsewhere: the machine's
 * transitions have their own file, so do the media layer's buffers and the
 * relay policy. What is checked below is only what joining them decides --
 * which failures stop a call from being placed, which of the machine's
 * actions reaches which method, and what a teardown waits for.
 */

const RELAY = {
  uris: ['turn:relay.example.org:3478'],
  username: 'u',
  password: 'p',
  ttl: 86400,
}

function description(type: string): SessionDescription {
  return { type, sdp: `v=0 ${type}` }
}

function fakeConnection() {
  const seen = { candidates: [] as Candidate[], closed: 0 }
  const pc: PeerConnectionLike = {
    createOffer: async () => description('offer'),
    createAnswer: async () => description('answer'),
    setLocalDescription: async () => undefined,
    setRemoteDescription: async () => undefined,
    addIceCandidate: async c => {
      seen.candidates.push(c)
    },
    addAudio: () => undefined,
    close: () => {
      seen.closed += 1
    },
  }
  return { pc, seen }
}

function fakeTrack(): AudioTrackLike {
  let enabled = true
  return {
    setEnabled: next => {
      enabled = next
      return enabled
    },
    stop: () => undefined,
  }
}

function build(
  overrides: Partial<CallSessionPorts> = {},
  connection = fakeConnection(),
) {
  const sent: CallEvent[] = []
  const states: CallState[] = []
  let clock = 1_000
  const ports: CallSessionPorts = {
    sendCallEvent: async event => {
      sent.push(event)
    },
    turnServer: async () => RELAY,
    media: {
      createConnection: () => connection.pc,
      captureAudio: async () => fakeTrack(),
    },
    now: () => clock,
    newCallId: () => 'call-1',
    // Never fires on its own: a test that wants a tick drives it.
    repeat: () => () => undefined,
    onState: state => states.push(state),
    ...overrides,
  }
  const session = startCallSession(ports, {
    ownUserId: '@me:example.org',
    peerUserId: '@them:example.org',
    ownPartyId: 'DEVICE1',
  })
  return {
    session,
    sent,
    states,
    connection,
    advance: (ms: number) => {
      clock += ms
    },
  }
}

describe('a call that cannot be placed is not placed', () => {
  it('refuses a homeserver that offers no relay', async () => {
    // RFC 8827 §6.4: the alternative to refusing is putting the device's own
    // address on the wire under an interface that promised the opposite.
    const { session, sent } = build({ turnServer: async () => ({}) })
    await expect(session.place()).rejects.toBeInstanceOf(CallSessionError)
    expect(sent).toEqual([])
  })

  it('names the relay failure rather than a generic one', async () => {
    const { session } = build({ turnServer: async () => ({}) })
    const refusal = await session.place().catch((e: unknown) => e)
    expect(refusal).toBeInstanceOf(CallSessionError)
    expect((refusal as CallSessionError).failure.kind).toBe('no-relay')
  })

  it('refuses a relay that only offers STUN', async () => {
    // STUN discovers an address; it does not carry media. An operator who
    // configured one meant to configure a relay.
    const { session } = build({
      turnServer: async () => ({ ...RELAY, uris: ['stun:stun.example.org'] }),
    })
    const refusal = await session.place().catch((e: unknown) => e)
    expect((refusal as CallSessionError).failure.kind).toBe('no-relay')
  })

  it('reports a microphone that was refused, and sends nothing', async () => {
    const { session, sent } = build({
      media: {
        createConnection: () => fakeConnection().pc,
        captureAudio: async () => {
          throw new Error('permission denied')
        },
      },
    })
    const refusal = await session.place().catch((e: unknown) => e)
    expect((refusal as CallSessionError).failure.kind).toBe('no-microphone')
    expect(sent).toEqual([])
  })

  it('does not open the microphone to answer a call that is not ringing', async () => {
    // The machine would refuse the intent too. Refusing first is what keeps
    // the recording indicator dark for a gesture that cannot work.
    const captureAudio = vi.fn(async () => fakeTrack())
    const { session } = build({
      media: { createConnection: () => fakeConnection().pc, captureAudio },
    })
    await expect(session.answer()).rejects.toThrow('no ringing call')
    expect(captureAudio).not.toHaveBeenCalled()
  })
})

describe('placing a call', () => {
  it("puts an invite in the room, carrying the media layer's offer", async () => {
    const { session, sent } = build()
    await session.place()
    expect(sent).toHaveLength(1)
    expect(sent[0]?.type).toBe('m.call.invite')
  })

  it('asks the homeserver for relay credentials once per call', async () => {
    // They are short-lived on purpose and nothing caches them; asking twice
    // for one call would be asking for two different sets.
    const turnServer = vi.fn(async () => RELAY)
    const { session } = build({ turnServer })
    await session.place()
    expect(turnServer).toHaveBeenCalledTimes(1)
  })

  it('reports its states to whoever draws', async () => {
    const { session, states } = build()
    await session.place()
    expect(states.map(s => s.call)).toContain('outgoingInvite')
  })
})

describe('what the machine asks for reaches the media layer', () => {
  /** A session with a call in flight, and the peer about to answer it. */
  async function placed() {
    const built = build()
    await built.session.place()
    const invite = built.sent[0]
    if (invite?.type !== 'm.call.invite') throw new Error('no invite')
    return { ...built, callId: invite.content.call_id }
  }

  it('applies the answer the peer selected', async () => {
    const { session, callId, connection } = await placed()
    session.receive([
      {
        type: 'm.call.answer',
        sender: '@them:example.org',
        content: {
          call_id: callId,
          version: '1',
          party_id: 'THEIRS',
          answer: description('answer'),
        },
      },
    ])
    // The peer's candidates now have somewhere to go, which is the observable
    // consequence of the answer having been applied.
    session.receive([
      {
        type: 'm.call.candidates',
        sender: '@them:example.org',
        content: {
          call_id: callId,
          version: '1',
          party_id: 'THEIRS',
          candidates: [{ candidate: 'candidate:x', sdpMid: '0' }],
        },
      },
    ])
    await new Promise(resolve => setImmediate(resolve))
    expect(connection.seen.candidates).toHaveLength(1)
  })

  it('answers a renegotiation the peer offered, as the specification requires', async () => {
    const { session, callId, sent } = await placed()
    session.receive([
      {
        type: 'm.call.answer',
        sender: '@them:example.org',
        content: {
          call_id: callId,
          version: '1',
          party_id: 'THEIRS',
          answer: description('answer'),
        },
      },
      {
        type: 'm.call.negotiate',
        sender: '@them:example.org',
        content: {
          call_id: callId,
          version: '1',
          party_id: 'THEIRS',
          lifetime: 10000,
          description: description('offer'),
        },
      },
    ])
    await new Promise(resolve => setImmediate(resolve))
    await new Promise(resolve => setImmediate(resolve))
    expect(sent.some(e => e.type === 'm.call.negotiate')).toBe(true)
  })
})

describe('what the media layer reports reaches the machine', () => {
  it('turns a gathered candidate into an event in the room', async () => {
    const connection = fakeConnection()
    const built = build({}, connection)
    await built.session.place()
    const invite = built.sent[0]
    if (invite?.type !== 'm.call.invite') throw new Error('no invite')
    built.session.receive([
      {
        type: 'm.call.answer',
        sender: '@them:example.org',
        content: {
          call_id: invite.content.call_id,
          version: '1',
          party_id: 'THEIRS',
          answer: description('answer'),
        },
      },
    ])
    await new Promise(resolve => setImmediate(resolve))

    connection.pc.onCandidate?.({ candidate: 'candidate:mine', sdpMid: '0' })
    await new Promise(resolve => setImmediate(resolve))
    expect(built.sent.some(e => e.type === 'm.call.candidates')).toBe(true)
  })

  it('ends the call when the connection fails after it was answered', async () => {
    const connection = fakeConnection()
    const built = build({}, connection)
    await built.session.place()
    const invite = built.sent[0]
    if (invite?.type !== 'm.call.invite') throw new Error('no invite')
    built.session.receive([
      {
        type: 'm.call.answer',
        sender: '@them:example.org',
        content: {
          call_id: invite.content.call_id,
          version: '1',
          party_id: 'THEIRS',
          answer: description('answer'),
        },
      },
    ])
    connection.pc.onConnectionState?.('failed')
    expect(built.session.state().call).toBe('ended')
  })

  it('survives a failure that arrives while the invite is still ringing', async () => {
    // ICE does not wait for the protocol: gathering and connectivity checks
    // start when the local description is set, so `failed` can land before
    // any answer. The machine refuses `mediaFailed` there, on purpose, and
    // this runs on the library's own callback -- so the refusal must stop
    // here rather than becoming a throw nobody can catch.
    const connection = fakeConnection()
    const built = build({}, connection)
    await built.session.place()
    expect(() => connection.pc.onConnectionState?.('failed')).not.toThrow()
    // Still ringing: the invite's own lifetime is what ends a call nobody
    // answered.
    expect(built.session.state().call).toBe('outgoingInvite')
  })
})

describe('mute', () => {
  it('answers what the microphone holds once there is one', async () => {
    const { session } = build()
    await session.place()
    expect(session.setMuted(true)).toBe(true)
    expect(session.muted()).toBe(true)
  })

  it('answers the request when there is no call yet, and nothing throws', () => {
    // A screen may draw the control before a call exists. Reporting the
    // intent is honest: there is no hardware to disagree with.
    const { session } = build()
    expect(session.setMuted(true)).toBe(true)
    expect(session.muted()).toBe(false)
  })
})

describe('teardown', () => {
  it('lets the outbox drain before it closes anything', async () => {
    // The last thing a teardown queues is usually the hangup that tells the
    // peer, and dropping it leaves somebody's telephone ringing for ninety
    // seconds.
    const built = build()
    await built.session.place()
    built.session.hangup()
    await built.session.stop()
    expect(built.sent.some(e => e.type === 'm.call.hangup')).toBe(true)
  })

  it('closes the connection', async () => {
    const connection = fakeConnection()
    const built = build({}, connection)
    await built.session.place()
    await built.session.stop()
    expect(connection.seen.closed).toBe(1)
  })

  it('can be stopped before anything was ever started', async () => {
    const { session } = build()
    await expect(session.stop()).resolves.toBeUndefined()
  })
})
