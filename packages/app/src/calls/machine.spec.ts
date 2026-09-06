import { describe, expect, it } from 'vitest'

import {
  CallError,
  CallMachine,
  callConfig,
  DEFAULT_CONNECT_TIMEOUT_MS,
  DEFAULT_INVITE_LIFETIME_MS,
  DEFAULT_NEGOTIATE_LIFETIME_MS,
  DEFAULT_RECONNECT_WINDOW_MS,
  type CallAction,
  type CallState,
  type IncomingCallEvent,
} from './machine'
import {
  VERSION_1,
  type CallEvent,
  type Candidate,
  type SessionDescription,
} from './wire'

// The scenario suite. Every one of these replays a race that cannot be
// produced on demand on a device -- a sibling device answering first, an
// invite expiring between being displayed and being accepted, a connection
// lost for nineteen seconds and recovered -- and it can only be written
// because the machine takes its clock and its identifiers as parameters.

const ALICE = '@alice:example.org'
const BOB = '@bob:example.org'
/** A third member of the room who is not a party to any of these calls. */
const MALLORY = '@mallory:example.org'

function sdp(type: string, text: string): SessionDescription {
  return { type, sdp: text }
}

function offer(): SessionDescription {
  return sdp('offer', 'v=0 offer-sdp')
}

function answerSdp(): SessionDescription {
  return sdp('answer', 'v=0 answer-sdp')
}

function machineFor(own: string, peer: string): CallMachine {
  return new CallMachine(callConfig(own, peer))
}

function received(
  sender: string,
  event: CallEvent,
  ageMs = 0,
): IncomingCallEvent {
  return { sender, event, ageMs }
}

function inviteFrom(
  sender: string,
  callId: string,
  partyId: string,
  lifetimeMs = DEFAULT_INVITE_LIFETIME_MS,
  ageMs = 0,
): IncomingCallEvent {
  return received(
    sender,
    {
      type: 'm.call.invite',
      content: {
        call_id: callId,
        party_id: partyId,
        lifetime: lifetimeMs,
        offer: offer(),
        version: VERSION_1,
      },
    },
    ageMs,
  )
}

function answerFrom(
  sender: string,
  callId: string,
  partyId: string,
): IncomingCallEvent {
  return received(sender, {
    type: 'm.call.answer',
    content: {
      call_id: callId,
      party_id: partyId,
      answer: answerSdp(),
      version: VERSION_1,
    },
  })
}

function candidatesFrom(
  sender: string,
  callId: string,
  partyId: string,
  lines: readonly string[],
): IncomingCallEvent {
  return received(sender, {
    type: 'm.call.candidates',
    content: {
      call_id: callId,
      party_id: partyId,
      candidates: lines.map(candidate => ({ candidate })),
      version: VERSION_1,
    },
  })
}

function selectAnswerFrom(
  sender: string,
  callId: string,
  partyId: string,
  selectedPartyId: string,
): IncomingCallEvent {
  return received(sender, {
    type: 'm.call.select_answer',
    content: {
      call_id: callId,
      party_id: partyId,
      selected_party_id: selectedPartyId,
      version: VERSION_1,
    },
  })
}

function rejectFrom(
  sender: string,
  callId: string,
  partyId: string,
): IncomingCallEvent {
  return received(sender, {
    type: 'm.call.reject',
    content: { call_id: callId, party_id: partyId, version: VERSION_1 },
  })
}

function hangupFrom(
  sender: string,
  callId: string,
  partyId: string,
  reason = 'ice_failed',
): IncomingCallEvent {
  return received(sender, {
    type: 'm.call.hangup',
    content: {
      call_id: callId,
      party_id: partyId,
      version: VERSION_1,
      reason,
    },
  })
}

function negotiateFrom(
  sender: string,
  callId: string,
  partyId: string,
  sessionType: string,
  lifetimeMs = DEFAULT_NEGOTIATE_LIFETIME_MS,
  ageMs = 0,
): IncomingCallEvent {
  return received(
    sender,
    {
      type: 'm.call.negotiate',
      content: {
        call_id: callId,
        party_id: partyId,
        lifetime: lifetimeMs,
        description: sdp(sessionType, 'v=0 renegotiation-sdp'),
        version: VERSION_1,
      },
    },
    ageMs,
  )
}

/** A machine driven into `inCall` as the callee of `call1`. */
function calleeInCall(
  own: string,
  peer: string,
  ownParty: string,
): CallMachine {
  const machine = machineFor(own, peer)
  machine.handleEvent(inviteFrom(peer, 'call1', 'peerP'), 0)
  machine.accept(ownParty, sdp('answer', 'v=0'), 100)
  machine.mediaConnected(200)
  return machine
}

/**
 * How many protocol events a batch asked to put on the wire.
 *
 * The specification repeats "it does not send any events" verbatim for
 * several paths, and every assertion about one of those is an assertion that
 * this is zero.
 */
function sendCount(actions: readonly CallAction[]): number {
  return actions.filter(action => action.act === 'send').length
}

/**
 * The first event of this type a batch asked to send.
 *
 * It returns the event rather than its content because a caller naming a
 * literal type gets the matching content back typed; reading `.content`
 * inside this function, where the type is still a parameter, would collapse
 * the seven contents into their intersection and type-check as none of them.
 */
function sent<T extends CallEvent['type']>(
  actions: readonly CallAction[],
  type: T,
): Extract<CallEvent, { type: T }> | undefined {
  return actions
    .flatMap(action => (action.act === 'send' ? [action.event] : []))
    .find(
      (event): event is Extract<CallEvent, { type: T }> => event.type === type,
    )
}

function sentHangupReason(actions: readonly CallAction[]): string | undefined {
  return sent(actions, 'm.call.hangup')?.content.reason
}

function did(actions: readonly CallAction[], act: CallAction['act']): boolean {
  return actions.some(action => action.act === act)
}

function stateChanges(actions: readonly CallAction[]): CallState[] {
  return actions.flatMap(action =>
    action.act === 'stateChanged' ? [action.state] : [],
  )
}

function lastState(actions: readonly CallAction[]): CallState {
  const changes = stateChanges(actions)
  const last = changes[changes.length - 1]
  if (last === undefined) throw new Error('the batch reported no state change')
  return last
}

/** Every candidate line a batch handed the media layer, in order. */
function candidatesReaching(actions: readonly CallAction[]): string[] {
  return actions.flatMap(action =>
    action.act === 'remoteCandidates'
      ? action.candidates.map((c: Candidate) => c.candidate)
      : [],
  )
}

describe('the nominal flows', () => {
  it('places a call, selects the answer, connects and hangs up', () => {
    const alice = machineFor(ALICE, BOB)

    const placed = alice.placeCall('call1', 'aliceP', offer(), 0)
    const invite = sent(placed, 'm.call.invite')?.content
    expect(invite?.call_id).toBe('call1')
    expect(invite?.party_id).toBe('aliceP')
    expect(invite?.lifetime).toBe(DEFAULT_INVITE_LIFETIME_MS)
    // "The invitee field should be added whenever the call is intended for
    // one specific user."
    expect(invite?.invitee).toBe(BOB)
    expect(invite?.version).toBe('1')
    expect(lastState(placed)).toEqual({
      call: 'outgoingInvite',
      callId: 'call1',
    })

    // The callee's candidates arrive before its answer: buffered, not
    // forwarded, because no party has been selected yet.
    const early = alice.handleEvent(
      candidatesFrom(BOB, 'call1', 'bobP', ['candidate:1']),
      100,
    )
    expect(early).toEqual([])

    const answered = alice.handleEvent(answerFrom(BOB, 'call1', 'bobP'), 200)
    expect(
      sent(answered, 'm.call.select_answer')?.content.selected_party_id,
    ).toBe('bobP')
    expect(did(answered, 'remoteAnswer')).toBe(true)
    expect(candidatesReaching(answered)).toEqual(['candidate:1'])
    expect(did(answered, 'startMedia')).toBe(true)
    expect(lastState(answered)).toEqual({ call: 'connecting', callId: 'call1' })

    const up = alice.mediaConnected(500)
    expect(lastState(up)).toEqual({ call: 'inCall', callId: 'call1' })

    const down = alice.hangup('user_hangup', 600)
    expect(sentHangupReason(down)).toBe('user_hangup')
    expect(did(down, 'stopMedia')).toBe(true)
    expect(lastState(down)).toEqual({
      call: 'ended',
      reason: { ended: 'hangup', reason: 'user_hangup' },
    })
  })

  it('rings, answers, and ends when the caller hangs up', () => {
    const bob = machineFor(BOB, ALICE)

    const rang = bob.handleEvent(inviteFrom(ALICE, 'call1', 'aliceP'), 1_000)
    expect(sendCount(rang)).toBe(0)
    expect(lastState(rang)).toEqual({
      call: 'incomingInvite',
      callId: 'call1',
      autoAccept: false,
      offer: offer(),
    })

    const accepted = bob.accept('bobP', answerSdp(), 2_000)
    const answer = sent(accepted, 'm.call.answer')?.content
    expect(answer?.call_id).toBe('call1')
    expect(answer?.party_id).toBe('bobP')
    expect(did(accepted, 'startMedia')).toBe(true)
    expect(lastState(accepted)).toEqual({ call: 'connecting', callId: 'call1' })

    // The caller's candidates now pass straight through to the media layer.
    const flowing = bob.handleEvent(
      candidatesFrom(ALICE, 'call1', 'aliceP', ['candidate:2']),
      2_100,
    )
    expect(candidatesReaching(flowing)).toEqual(['candidate:2'])

    bob.mediaConnected(3_000)

    const ended = bob.handleEvent(hangupFrom(ALICE, 'call1', 'aliceP'), 5_000)
    expect(sendCount(ended)).toBe(0)
    expect(did(ended, 'stopMedia')).toBe(true)
    expect(lastState(ended)).toEqual({
      call: 'ended',
      reason: { ended: 'hangup', reason: 'ice_failed' },
    })
  })

  it('starts a new call after an ending, while stragglers of the old one stay dropped', () => {
    const alice = machineFor(ALICE, BOB)
    alice.placeCall('call1', 'aliceP', offer(), 0)
    alice.hangup('user_hangup', 100)

    expect(alice.handleEvent(answerFrom(BOB, 'call1', 'bobP'), 200)).toEqual([])

    const again = alice.placeCall('call2', 'aliceP', offer(), 300)
    expect(lastState(again)).toEqual({
      call: 'outgoingInvite',
      callId: 'call2',
    })
  })
})

describe('the microphone an outgoing call opened', () => {
  // The caller's microphone is open while the invite rings, and this machine
  // used to believe it was not. Measured on the predecessor of this
  // application: a call nobody answered left the record permission `running`
  // three and a half minutes after the screen said "no answer". WebRTC needs
  // a local audio track to produce an offer at all, so the microphone opens
  // when the offer is built, whatever the machine's model says.

  it('is stopped when an unanswered invite times out', () => {
    const alice = machineFor(ALICE, BOB)
    alice.placeCall('call1', 'aliceP', offer(), 0)

    const expired = alice.tick(DEFAULT_INVITE_LIFETIME_MS + 1)
    expect(did(expired, 'stopMedia')).toBe(true)
  })

  it('is stopped when the caller hangs up while it is still ringing', () => {
    const alice = machineFor(ALICE, BOB)
    alice.placeCall('call1', 'aliceP', offer(), 0)

    const cancelled = alice.hangup('user_hangup', 1_000)
    expect(did(cancelled, 'stopMedia')).toBe(true)
  })
})

describe('liveness and expiry', () => {
  it('ends an unanswered outgoing invite with invite_timeout', () => {
    const alice = machineFor(ALICE, BOB)
    alice.placeCall('call1', 'aliceP', offer(), 0)

    expect(alice.tick(DEFAULT_INVITE_LIFETIME_MS - 1)).toEqual([])
    // At exactly the lifetime the age does not yet "exceed" it.
    expect(alice.tick(DEFAULT_INVITE_LIFETIME_MS)).toEqual([])

    const expired = alice.tick(DEFAULT_INVITE_LIFETIME_MS + 1)
    expect(sentHangupReason(expired)).toBe('invite_timeout')
    expect(lastState(expired)).toEqual({
      call: 'ended',
      reason: { ended: 'hangup', reason: 'invite_timeout' },
    })
  })

  it('counts an incoming invite down from the age the sync reported, not from the sender clock', () => {
    const bob = machineFor(BOB, ALICE)
    // 85 s of age on a 90 s lifetime: five seconds remain, on this clock.
    const rang = bob.handleEvent(
      inviteFrom(ALICE, 'call1', 'aliceP', 90_000, 85_000),
      1_000,
    )
    expect(lastState(rang)).toEqual({
      call: 'incomingInvite',
      callId: 'call1',
      autoAccept: false,
      offer: offer(),
    })

    expect(bob.tick(6_000)).toEqual([])
    const gone = bob.tick(6_001)
    // Callee-side expiry sends nothing: "clients should discard it".
    expect(sendCount(gone)).toBe(0)
    expect(lastState(gone)).toEqual({
      call: 'ended',
      reason: { ended: 'inviteExpired' },
    })
  })

  it('never rings for an invite that was already dead when it arrived', () => {
    const bob = machineFor(BOB, ALICE)
    const dead = bob.handleEvent(
      inviteFrom(ALICE, 'call1', 'aliceP', 60_000, 60_001),
      0,
    )
    expect(dead).toEqual([])
    expect(bob.state()).toEqual({ call: 'idle' })
  })

  it('refuses an accept that arrives after the lifetime, and ends the call', () => {
    const bob = machineFor(BOB, ALICE)
    bob.handleEvent(inviteFrom(ALICE, 'call1', 'aliceP'), 0)

    expect(() => bob.accept('bobP', sdp('answer', 'v=0'), 90_001)).toThrow(
      CallError,
    )
    expect(bob.state()).toEqual({
      call: 'ended',
      reason: { ended: 'inviteExpired' },
    })
  })

  it('ignores an answer that lands after the caller gave up', () => {
    const alice = machineFor(ALICE, BOB)
    alice.placeCall('call1', 'aliceP', offer(), 0)
    alice.tick(DEFAULT_INVITE_LIFETIME_MS + 1)

    expect(
      alice.handleEvent(answerFrom(BOB, 'call1', 'bobP'), 100_000),
    ).toEqual([])
    expect(alice.state()).toMatchObject({ call: 'ended' })
  })
})

describe('refusing a call', () => {
  it('refuses a version-1 invite with m.call.reject rather than a hangup', () => {
    const bob = machineFor(BOB, ALICE)
    bob.handleEvent(inviteFrom(ALICE, 'call1', 'aliceP'), 0)

    const refused = bob.reject('bobP', 1_000)
    const reject = sent(refused, 'm.call.reject')?.content
    expect(reject?.call_id).toBe('call1')
    expect(reject?.party_id).toBe('bobP')
    expect(lastState(refused)).toEqual({
      call: 'ended',
      reason: { ended: 'rejected' },
    })
  })

  it('selects the reject like an answer, so any device that answered is released', () => {
    const alice = machineFor(ALICE, BOB)
    alice.placeCall('call1', 'aliceP', offer(), 0)

    const refused = alice.handleEvent(rejectFrom(BOB, 'call1', 'bobP'), 1_000)
    expect(
      sent(refused, 'm.call.select_answer')?.content.selected_party_id,
    ).toBe('bobP')
    expect(lastState(refused)).toEqual({
      call: 'ended',
      reason: { ended: 'rejected' },
    })
  })

  it('ends the device that answered when the caller selects a sibling reject instead', () => {
    const bob = machineFor(BOB, ALICE)
    bob.handleEvent(inviteFrom(ALICE, 'call1', 'aliceP'), 0)
    bob.accept('bobP', sdp('answer', 'v=0'), 100)

    // The caller selected the reject sent by our sibling, party bobP2.
    const released = bob.handleEvent(
      selectAnswerFrom(ALICE, 'call1', 'aliceP', 'bobP2'),
      200,
    )
    expect(sendCount(released)).toBe(0)
    expect(did(released, 'stopMedia')).toBe(true)
    expect(lastState(released)).toEqual({
      call: 'ended',
      reason: { ended: 'answeredElsewhere' },
    })
  })

  it('disregards a reject that lands after an answer', () => {
    const alice = machineFor(ALICE, BOB)
    alice.placeCall('call1', 'aliceP', offer(), 0)
    alice.handleEvent(answerFrom(BOB, 'call1', 'bobP'), 100)

    expect(alice.handleEvent(rejectFrom(BOB, 'call1', 'bobP2'), 200)).toEqual(
      [],
    )
    expect(alice.state()).toEqual({ call: 'connecting', callId: 'call1' })
  })
})

describe('a send that never left the device', () => {
  it('ends an outgoing invite at once rather than after ninety seconds of silence', () => {
    const alice = machineFor(ALICE, BOB)
    alice.placeCall('call1', 'aliceP', offer(), 0)

    const failed = alice.sendFailed('call1')
    expect(sendCount(failed)).toBe(0)
    expect(did(failed, 'stopMedia')).toBe(false)
    expect(lastState(failed)).toEqual({
      call: 'ended',
      reason: { ended: 'sendFailed' },
    })
  })

  it('tears down media when it happens mid-call', () => {
    const bob = calleeInCall(BOB, ALICE, 'bobP')

    const failed = bob.sendFailed('call1')
    expect(did(failed, 'stopMedia')).toBe(true)
    expect(lastState(failed)).toEqual({
      call: 'ended',
      reason: { ended: 'sendFailed' },
    })
  })

  it('says nothing when there is nothing left to fail', () => {
    const alice = machineFor(ALICE, BOB)
    expect(alice.sendFailed('call1')).toEqual([])
    expect(alice.state()).toEqual({ call: 'idle' })

    alice.placeCall('call1', 'aliceP', offer(), 0)
    alice.hangup('user_hangup', 100)
    // A transport learns of a failure after the hangup that ended the call
    // went out; that ordering must be a no-op, not a second ending.
    expect(alice.sendFailed('call1')).toEqual([])
    expect(alice.state()).toEqual({
      call: 'ended',
      reason: { ended: 'hangup', reason: 'user_hangup' },
    })
  })

  it('names the call it belongs to, so a later call is untouched', () => {
    // Every step is a legitimate gesture: place A, cancel A, place B -- and
    // only then does the send queue resolve A's invite with an error.
    const alice = machineFor(ALICE, BOB)
    alice.placeCall('call1', 'aliceP', offer(), 0)
    alice.hangup('user_hangup', 100)
    alice.placeCall('call2', 'aliceP2', offer(), 200)

    expect(alice.sendFailed('call1')).toEqual([])
    expect(alice.state()).toEqual({ call: 'outgoingInvite', callId: 'call2' })
  })

  it('is not the same ending as the peer not answering', () => {
    // Two different sentences on a screen: "we could not reach them" and
    // "they did not pick up".
    const unreachable = machineFor(ALICE, BOB)
    unreachable.placeCall('call1', 'aliceP', offer(), 0)
    unreachable.sendFailed('call1')

    const unanswered = machineFor(ALICE, BOB)
    unanswered.placeCall('call1', 'aliceP', offer(), 0)
    unanswered.tick(DEFAULT_INVITE_LIFETIME_MS + 1)

    expect(unreachable.state()).toEqual({
      call: 'ended',
      reason: { ended: 'sendFailed' },
    })
    expect(unanswered.state()).toEqual({
      call: 'ended',
      reason: { ended: 'hangup', reason: 'invite_timeout' },
    })
    expect(unreachable.state()).not.toEqual(unanswered.state())
  })
})

describe('a room member who is not a party to the call', () => {
  // The call id is not a secret. It travels in the room, so every member
  // reads it, and the party id does too. Neither can carry any weight of its
  // own: the only thing separating the callee from a bystander is who sent
  // the event.

  it('cannot answer, refuse, cancel or glare with a call it is not part of', () => {
    const alice = machineFor(ALICE, BOB)
    alice.placeCall('call1', 'aliceP', offer(), 0)

    expect(
      alice.handleEvent(answerFrom(MALLORY, 'call1', 'malloryP'), 100),
    ).toEqual([])
    expect(
      alice.handleEvent(rejectFrom(MALLORY, 'call1', 'malloryP'), 200),
    ).toEqual([])
    // A hangup from a bystander must not cancel a call it is not part of:
    // the invite is still out and the callee can still pick up.
    expect(
      alice.handleEvent(hangupFrom(MALLORY, 'call1', 'malloryP'), 300),
    ).toEqual([])
    // The glare tie-break is not a door a stranger may knock on. A lesser
    // call id would abort our invite and make us the auto-accepting callee
    // of the stranger's call -- answered with no ringing at all, which is the
    // worst outcome available here.
    expect(
      alice.handleEvent(inviteFrom(MALLORY, 'call0', 'malloryP'), 400),
    ).toEqual([])
    expect(alice.state()).toEqual({ call: 'outgoingInvite', callId: 'call1' })
  })

  it('cannot smuggle candidates in under the party id the real callee will answer with', () => {
    const alice = machineFor(ALICE, BOB)
    alice.placeCall('call1', 'aliceP', offer(), 0)

    // Mallory reads bobP off the room like anybody else. If the buffer keeps
    // these, they flush into the media layer as though the callee had
    // gathered them.
    alice.handleEvent(
      candidatesFrom(MALLORY, 'call1', 'bobP', ['candidate:mallory']),
      500,
    )
    const answered = alice.handleEvent(answerFrom(BOB, 'call1', 'bobP'), 600)
    expect(candidatesReaching(answered)).not.toContain('candidate:mallory')
  })

  it('never makes the telephone ring, from idle or from an ended call', () => {
    // The machine is configured for one peer, and the ringing state carries
    // no caller identity -- so a stranger's invite would ring under the
    // peer's name and the answer SDP would go to the room.
    const fromIdle = machineFor(BOB, ALICE)
    expect(
      fromIdle.handleEvent(inviteFrom(MALLORY, 'call1', 'malloryP'), 0),
    ).toEqual([])
    expect(fromIdle.state()).toEqual({ call: 'idle' })

    const fromEnded = machineFor(BOB, ALICE)
    fromEnded.handleEvent(inviteFrom(ALICE, 'call0', 'aliceP'), 0)
    fromEnded.reject('bobP', 100)
    expect(
      fromEnded.handleEvent(inviteFrom(MALLORY, 'call1', 'malloryP'), 200),
    ).toEqual([])
    expect(fromEnded.state()).toEqual({
      call: 'ended',
      reason: { ended: 'rejected' },
    })

    // And the door still opens for the peer: a check that also refused the
    // legitimate next call would trade one defect for another.
    const next = fromEnded.handleEvent(
      inviteFrom(ALICE, 'call2', 'aliceP'),
      300,
    )
    expect(lastState(next)).toEqual({
      call: 'incomingInvite',
      callId: 'call2',
      autoAccept: false,
      offer: offer(),
    })
  })

  it('has its candidates refused on the callee side too, where the buffer keys on nothing', () => {
    const bob = machineFor(BOB, ALICE)
    bob.handleEvent(inviteFrom(ALICE, 'call1', 'aliceP'), 0)
    expect(
      bob.handleEvent(
        candidatesFrom(MALLORY, 'call1', 'malloryP', ['candidate:mallory']),
        50,
      ),
    ).toEqual([])

    const accepted = bob.accept('bobP', sdp('answer', 'v=0'), 100)
    expect(candidatesReaching(accepted)).not.toContain('candidate:mallory')
  })

  it('has its candidates refused on an established call even with the party id spoofed', () => {
    const alice = machineFor(ALICE, BOB)
    alice.placeCall('call2', 'aliceP', offer(), 0)
    alice.handleEvent(answerFrom(BOB, 'call2', 'bobP'), 100)

    // The party comparison passes; only the sender tells the two apart.
    expect(
      alice.handleEvent(
        candidatesFrom(MALLORY, 'call2', 'bobP', ['candidate:spoof']),
        200,
      ),
    ).toEqual([])
  })

  it('has its candidates refused against a version-0 peer, where there is no party to compare', () => {
    const alice = machineFor(ALICE, BOB)
    alice.placeCall('call3', 'aliceP', offer(), 0)
    alice.handleEvent(
      received(BOB, {
        type: 'm.call.answer',
        content: { call_id: 'call3', answer: answerSdp(), version: 0 },
      }),
      100,
    )
    expect(alice.state()).toEqual({ call: 'connecting', callId: 'call3' })

    // With no remote party id, the party comparison admits every party there
    // is, and the sender check is the only check there is.
    expect(
      alice.handleEvent(
        candidatesFrom(MALLORY, 'call3', 'anything', ['candidate:v0']),
        200,
      ),
    ).toEqual([])
  })
})

describe('candidates that arrive before their call is usable', () => {
  it('are buffered while the callee is still ringing and flushed on accept', () => {
    const bob = machineFor(BOB, ALICE)
    bob.handleEvent(inviteFrom(ALICE, 'call1', 'aliceP'), 0)
    expect(
      bob.handleEvent(
        candidatesFrom(ALICE, 'call1', 'aliceP', ['candidate:1']),
        100,
      ),
    ).toEqual([])

    const accepted = bob.accept('bobP', sdp('answer', 'v=0'), 200)
    expect(candidatesReaching(accepted)).toEqual(['candidate:1'])
  })

  it('flush only for the answering device the caller selected', () => {
    const alice = machineFor(ALICE, BOB)
    alice.placeCall('call2', 'aliceP', offer(), 0)
    alice.handleEvent(
      candidatesFrom(BOB, 'call2', 'bobP', ['candidate:chosen']),
      100,
    )
    alice.handleEvent(
      candidatesFrom(BOB, 'call2', 'bobP2', ['candidate:loser']),
      110,
    )

    const answered = alice.handleEvent(answerFrom(BOB, 'call2', 'bobP'), 200)
    expect(candidatesReaching(answered)).toEqual(['candidate:chosen'])
  })
})

describe('glare', () => {
  // "the client should perform a lexicographical comparison of the call IDs
  // of the two calls and use the lesser of the two calls, aborting the
  // greater. If the incoming call is the lesser, the client should accept
  // this call on behalf of the user."

  it('makes both sides converge on the lesser call id, and only one of them speaks', () => {
    const alice = machineFor(ALICE, BOB)
    const bob = machineFor(BOB, ALICE)

    alice.placeCall('aaa', 'aliceP', offer(), 0)
    bob.placeCall('bbb', 'bobP', offer(), 0)

    // Alice receives Bob's invite: hers is the lesser, so it survives. She
    // sends nothing and keeps waiting -- Bob's machine runs the same
    // comparison and does the aborting.
    const forAlice = alice.handleEvent(inviteFrom(BOB, 'bbb', 'bobP'), 10)
    expect(forAlice).toEqual([])
    expect(alice.state()).toEqual({ call: 'outgoingInvite', callId: 'aaa' })

    // Bob receives Alice's invite: hers is the lesser. Bob aborts his own
    // with a hangup and adopts Alice's call, marked for auto-accept.
    const forBob = bob.handleEvent(inviteFrom(ALICE, 'aaa', 'aliceP'), 10)
    expect(sent(forBob, 'm.call.hangup')?.content.call_id).toBe('bbb')
    expect(lastState(forBob)).toEqual({
      call: 'incomingInvite',
      callId: 'aaa',
      autoAccept: true,
      offer: offer(),
    })

    // From here the surviving call runs its nominal course, and the two
    // machines name the same call at the end.
    expect(lastState(bob.accept('bobP2', sdp('answer', 'v=0'), 20))).toEqual({
      call: 'connecting',
      callId: 'aaa',
    })
    expect(
      lastState(alice.handleEvent(answerFrom(BOB, 'aaa', 'bobP2'), 30)),
    ).toEqual({ call: 'connecting', callId: 'aaa' })

    alice.mediaConnected(40)
    bob.mediaConnected(40)
    expect(alice.state()).toEqual({ call: 'inCall', callId: 'aaa' })
    expect(bob.state()).toEqual({ call: 'inCall', callId: 'aaa' })
  })

  it('leaves the obligation to accept on behalf of the user to whoever holds a media layer', () => {
    // The machine raises the flag and stops. It cannot accept: an accept
    // needs an answer SDP, and an answer SDP is media work.
    const bob = machineFor(BOB, ALICE)
    bob.placeCall('bbb', 'bobP', offer(), 0)
    const forBob = bob.handleEvent(inviteFrom(ALICE, 'aaa', 'aliceP'), 10)

    expect(lastState(forBob)).toMatchObject({ autoAccept: true })
    // Nothing was answered, and the offer needed to answer is in the state.
    expect(sent(forBob, 'm.call.answer')).toBeUndefined()
    expect(bob.pendingOffer()).toEqual(offer())
  })
})

describe('the other devices of an account', () => {
  it('ends this device when a sibling answers while it is still ringing', () => {
    const bob = machineFor(BOB, ALICE)
    bob.handleEvent(inviteFrom(ALICE, 'call1', 'aliceP'), 0)

    const elsewhere = bob.handleEvent(answerFrom(BOB, 'call1', 'bobP2'), 100)
    expect(sendCount(elsewhere)).toBe(0)
    expect(lastState(elsewhere)).toEqual({
      call: 'ended',
      reason: { ended: 'answeredElsewhere' },
    })
  })

  it('ends this device when a sibling refuses, because a reject refuses on all devices', () => {
    const bob = machineFor(BOB, ALICE)
    bob.handleEvent(inviteFrom(ALICE, 'call1', 'aliceP'), 0)

    const elsewhere = bob.handleEvent(rejectFrom(BOB, 'call1', 'bobP2'), 100)
    expect(sendCount(elsewhere)).toBe(0)
    expect(lastState(elsewhere)).toEqual({
      call: 'ended',
      reason: { ended: 'rejectedElsewhere' },
    })
  })

  it('ignores a sibling reject that arrives after this device answered', () => {
    const bob = machineFor(BOB, ALICE)
    bob.handleEvent(inviteFrom(ALICE, 'call1', 'aliceP'), 0)
    bob.accept('bobP', sdp('answer', 'v=0'), 100)

    expect(bob.handleEvent(rejectFrom(BOB, 'call1', 'bobP2'), 200)).toEqual([])
    expect(bob.state()).toEqual({ call: 'connecting', callId: 'call1' })
  })

  it('ends this device when a select_answer names a party that is not its own', () => {
    const bob = machineFor(BOB, ALICE)
    bob.handleEvent(inviteFrom(ALICE, 'call1', 'aliceP'), 0)
    bob.accept('bobP', sdp('answer', 'v=0'), 100)

    const elsewhere = bob.handleEvent(
      selectAnswerFrom(ALICE, 'call1', 'aliceP', 'bobP2'),
      200,
    )
    expect(sendCount(elsewhere)).toBe(0)
    expect(did(elsewhere, 'stopMedia')).toBe(true)
    expect(lastState(elsewhere)).toEqual({
      call: 'ended',
      reason: { ended: 'answeredElsewhere' },
    })
  })

  it('does nothing at all when a select_answer confirms this device', () => {
    const bob = machineFor(BOB, ALICE)
    bob.handleEvent(inviteFrom(ALICE, 'call1', 'aliceP'), 0)
    bob.accept('bobP', sdp('answer', 'v=0'), 100)

    expect(
      bob.handleEvent(selectAnswerFrom(ALICE, 'call1', 'aliceP', 'bobP'), 200),
    ).toEqual([])
    expect(bob.state()).toEqual({ call: 'connecting', callId: 'call1' })
  })

  it('ends a ringing device when the caller selects an answer it never saw', () => {
    // A plain sync race: the caller selected the sibling's answer before this
    // device even saw that answer.
    const bob = machineFor(BOB, ALICE)
    bob.handleEvent(inviteFrom(ALICE, 'call1', 'aliceP'), 0)

    const elsewhere = bob.handleEvent(
      selectAnswerFrom(ALICE, 'call1', 'aliceP', 'bobP2'),
      100,
    )
    expect(lastState(elsewhere)).toEqual({
      call: 'ended',
      reason: { ended: 'answeredElsewhere' },
    })
  })

  it('steps aside when another device of this account is running the call we placed', () => {
    const alice = machineFor(ALICE, BOB)
    alice.placeCall('call1', 'aliceP', offer(), 0)

    const elsewhere = alice.handleEvent(
      selectAnswerFrom(ALICE, 'call1', 'aliceP2', 'bobP'),
      100,
    )
    expect(sendCount(elsewhere)).toBe(0)
    expect(lastState(elsewhere)).toEqual({
      call: 'ended',
      reason: { ended: 'answeredElsewhere' },
    })
  })

  it('drops the remote echo of its own invite', () => {
    const alice = machineFor(ALICE, BOB)
    alice.placeCall('call1', 'aliceP', offer(), 0)

    // Same user, same party: this is our own event coming back.
    expect(alice.handleEvent(inviteFrom(ALICE, 'call1', 'aliceP'), 10)).toEqual(
      [],
    )
    expect(alice.state()).toEqual({ call: 'outgoingInvite', callId: 'call1' })
  })
})

describe('invites that are not this device to answer', () => {
  it('ignores an invite addressed to somebody else', () => {
    const bob = machineFor(BOB, ALICE)
    const event: IncomingCallEvent = received(ALICE, {
      type: 'm.call.invite',
      content: {
        call_id: 'call1',
        party_id: 'aliceP',
        lifetime: 90_000,
        offer: offer(),
        version: VERSION_1,
        invitee: '@carol:example.org',
      },
    })

    expect(bob.handleEvent(event, 0)).toEqual([])
    expect(bob.state()).toEqual({ call: 'idle' })
  })

  it('ignores a second invite arriving mid-call rather than answering user_busy for the user', () => {
    const bob = machineFor(BOB, ALICE)
    bob.handleEvent(inviteFrom(ALICE, 'call1', 'aliceP'), 0)
    bob.accept('bobP', sdp('answer', 'v=0'), 100)
    bob.mediaConnected(200)

    expect(bob.handleEvent(inviteFrom(ALICE, 'call2', 'aliceP'), 300)).toEqual(
      [],
    )
    expect(bob.state()).toEqual({ call: 'inCall', callId: 'call1' })
  })
})

describe('local intents in impossible states', () => {
  // A machine that silently ignored a local decision would hang a screen:
  // somebody presses answer and nothing happens, for ever.

  it('refuse loudly and name the state that refused them', () => {
    const bob = machineFor(BOB, ALICE)
    expect(() => bob.accept('bobP', sdp('answer', 'v=0'), 0)).toThrow(
      /accept is not allowed while the call machine is idle/,
    )
    expect(() => bob.hangup('user_hangup', 0)).toThrow(CallError)
    expect(() => bob.mediaConnected(0)).toThrow(CallError)
    expect(() => bob.sendCandidates([{ candidate: 'candidate:1' }], 0)).toThrow(
      CallError,
    )
  })

  it('refuse a second outgoing call while one is waiting for an answer', () => {
    const alice = machineFor(ALICE, BOB)
    alice.placeCall('call1', 'aliceP', offer(), 0)
    expect(() => alice.placeCall('call2', 'aliceP', offer(), 1)).toThrow(
      CallError,
    )
  })

  it('carry the intent that was refused, so a caller can tell which one it was', () => {
    const bob = machineFor(BOB, ALICE)
    try {
      bob.accept('bobP', sdp('answer', 'v=0'), 0)
      expect.unreachable('accept from idle must throw')
    } catch (thrown) {
      expect(thrown).toBeInstanceOf(CallError)
      expect((thrown as CallError).kind).toBe('wrongState')
      expect((thrown as CallError).action).toBe('accept')
    }
  })
})

describe('the connect deadline', () => {
  // A call that never connects must not ring for ever. `connecting` is left
  // by `mediaConnected` or `mediaFailed`, and a media layer that reports
  // neither -- wedged, or an agent still fruitlessly checking -- used to
  // leave the machine there with no deadline of any kind.

  it('ends a call whose media never came up, with ice_failed', () => {
    const bob = machineFor(BOB, ALICE)
    bob.handleEvent(inviteFrom(ALICE, 'call1', 'aliceP'), 0)
    bob.accept('bobP', sdp('answer', 'v=0'), 1_000)
    expect(bob.state()).toEqual({ call: 'connecting', callId: 'call1' })

    // The deadline instant itself has not been exceeded yet.
    expect(bob.tick(1_000 + DEFAULT_CONNECT_TIMEOUT_MS)).toEqual([])
    expect(bob.state()).toEqual({ call: 'connecting', callId: 'call1' })

    const gone = bob.tick(1_000 + DEFAULT_CONNECT_TIMEOUT_MS + 1)
    // No media ever flowed, so it is ice_failed and not ice_timeout.
    expect(sentHangupReason(gone)).toBe('ice_failed')
    expect(did(gone, 'stopMedia')).toBe(true)
    expect(lastState(gone)).toEqual({
      call: 'ended',
      reason: { ended: 'hangup', reason: 'ice_failed' },
    })
  })

  it('never fires on a call that connected with a second to spare', () => {
    // The guard that matters most is the one that does not fire: a call that
    // came up is a healthy call, and a counter that killed it would be worse
    // than the defect it fixes.
    const bob = machineFor(BOB, ALICE)
    bob.handleEvent(inviteFrom(ALICE, 'call1', 'aliceP'), 0)
    bob.accept('bobP', sdp('answer', 'v=0'), 0)
    bob.mediaConnected(29_000)

    for (const now of [30_001, 60_000, 3_600_000]) {
      expect(bob.tick(now)).toEqual([])
      expect(bob.state()).toEqual({ call: 'inCall', callId: 'call1' })
    }
  })

  it('is armed on the caller side too, and runs from the answer rather than the invite', () => {
    const alice = machineFor(ALICE, BOB)
    alice.placeCall('call1', 'aliceP', offer(), 0)
    alice.handleEvent(answerFrom(BOB, 'call1', 'bobP'), 5_000)
    expect(alice.state()).toEqual({ call: 'connecting', callId: 'call1' })

    // Thirty seconds after the invite is not yet thirty after the answer.
    expect(alice.tick(DEFAULT_CONNECT_TIMEOUT_MS)).toEqual([])
    expect(alice.state()).toEqual({ call: 'connecting', callId: 'call1' })

    const gone = alice.tick(5_000 + DEFAULT_CONNECT_TIMEOUT_MS + 1)
    expect(sentHangupReason(gone)).toBe('ice_failed')
  })

  it('does not swallow a renegotiation timer, nor is swallowed by one', () => {
    const bob = machineFor(BOB, ALICE)
    bob.handleEvent(inviteFrom(ALICE, 'call1', 'aliceP'), 0)
    bob.accept('bobP', sdp('answer', 'v=0'), 0)
    bob.requestNegotiation(sdp('offer', 'v=0 with-video'), 1_000)

    // At twelve seconds the renegotiation has timed out; the call has not.
    const negotiation = bob.tick(12_000)
    expect(did(negotiation, 'negotiationTimedOut')).toBe(true)
    expect(bob.state()).toEqual({ call: 'connecting', callId: 'call1' })

    // And the connect deadline still ends the call at its own instant.
    const gone = bob.tick(DEFAULT_CONNECT_TIMEOUT_MS + 1)
    expect(sentHangupReason(gone)).toBe('ice_failed')
  })
})

describe('the reconnection window', () => {
  // The sibling of the connect deadline and deliberately kept apart from it:
  // the two answer different questions, are armed by different things, and
  // end with opposite wire reasons.

  it('opens with the full countdown showing, the moment the connection drops', () => {
    const bob = calleeInCall(BOB, ALICE, 'bobP')
    expect(bob.state()).toEqual({ call: 'inCall', callId: 'call1' })

    const dropped = bob.mediaDisconnected(1_000)
    expect(bob.state()).toEqual({
      call: 'reconnecting',
      callId: 'call1',
      secondsLeft: 20,
    })
    expect(lastState(dropped)).toEqual({
      call: 'reconnecting',
      callId: 'call1',
      secondsLeft: 20,
    })
    expect(sendCount(dropped)).toBe(0)
  })

  it('counts down on the injected clock, and reports every second it moves', () => {
    const bob = calleeInCall(BOB, ALICE, 'bobP')
    bob.mediaDisconnected(1_000)

    for (let elapsed = 1; elapsed <= 19; elapsed += 1) {
      const ticked = bob.tick(1_000 + elapsed * 1_000)
      const expected = {
        call: 'reconnecting',
        callId: 'call1',
        secondsLeft: 20 - elapsed,
      }
      expect(bob.state()).toEqual(expected)
      expect(lastState(ticked)).toEqual(expected)
    }
  })

  it('reports the countdown once per second it changes, whatever the tick rate', () => {
    const bob = calleeInCall(BOB, ALICE, 'bobP')
    bob.mediaDisconnected(1_000)

    // 400 ms in, the countdown still reads 20: nothing has changed.
    expect(stateChanges(bob.tick(1_400))).toHaveLength(0)
    expect(stateChanges(bob.tick(2_000))).toHaveLength(1)
    expect(stateChanges(bob.tick(2_600))).toHaveLength(0)
  })

  it('ends a connection that never comes back with ice_timeout, because media had flowed', () => {
    const bob = calleeInCall(BOB, ALICE, 'bobP')
    bob.mediaDisconnected(1_000)

    bob.tick(1_000 + DEFAULT_RECONNECT_WINDOW_MS)
    expect(bob.state()).toMatchObject({ call: 'reconnecting' })

    const gone = bob.tick(1_000 + DEFAULT_RECONNECT_WINDOW_MS + 1)
    expect(sentHangupReason(gone)).toBe('ice_timeout')
    expect(did(gone, 'stopMedia')).toBe(true)
    expect(lastState(gone)).toEqual({
      call: 'ended',
      reason: { ended: 'hangup', reason: 'ice_timeout' },
    })
  })

  it('never kills a call that recovered inside it, because the window is cleared and not ignored', () => {
    const bob = calleeInCall(BOB, ALICE, 'bobP')
    bob.mediaDisconnected(1_000)

    const back = bob.mediaReconnected(20_000)
    expect(bob.state()).toEqual({ call: 'inCall', callId: 'call1' })
    expect(lastState(back)).toEqual({ call: 'inCall', callId: 'call1' })
    expect(sendCount(back)).toBe(0)

    expect(bob.tick(1_000 + DEFAULT_RECONNECT_WINDOW_MS + 1)).toEqual([])
    expect(bob.tick(3_600_000)).toEqual([])
    expect(bob.state()).toEqual({ call: 'inCall', callId: 'call1' })
  })

  it('gives a second drop a full window rather than the remains of the first', () => {
    const bob = calleeInCall(BOB, ALICE, 'bobP')
    bob.mediaDisconnected(1_000)
    bob.mediaReconnected(15_000)

    bob.mediaDisconnected(16_000)
    expect(bob.state()).toEqual({
      call: 'reconnecting',
      callId: 'call1',
      secondsLeft: 20,
    })
    bob.tick(16_000 + DEFAULT_RECONNECT_WINDOW_MS)
    expect(bob.state()).toMatchObject({ call: 'reconnecting' })
    expect(
      sentHangupReason(bob.tick(16_000 + DEFAULT_RECONNECT_WINDOW_MS + 1)),
    ).toBe('ice_timeout')
  })

  it('is not re-armed by a repeated report, or a flapping connection would hold a dead call open for ever', () => {
    const bob = calleeInCall(BOB, ALICE, 'bobP')
    bob.mediaDisconnected(1_000)
    expect(bob.mediaDisconnected(10_000)).toEqual([])

    // The window still expires twenty seconds after the first drop.
    expect(
      sentHangupReason(bob.tick(1_000 + DEFAULT_RECONNECT_WINDOW_MS + 1)),
    ).toBe('ice_timeout')
  })

  it('is silent about a recovery on a call that never lost its connection', () => {
    const bob = calleeInCall(BOB, ALICE, 'bobP')
    expect(bob.mediaReconnected(1_000)).toEqual([])
    expect(bob.state()).toEqual({ call: 'inCall', callId: 'call1' })
  })

  it('is not opened by a drop while the call is still connecting, which would shorten the other deadline', () => {
    const bob = machineFor(BOB, ALICE)
    bob.handleEvent(inviteFrom(ALICE, 'call1', 'aliceP'), 0)
    bob.accept('bobP', sdp('answer', 'v=0'), 1_000)

    expect(bob.mediaDisconnected(2_000)).toEqual([])
    // A call that never came up cannot be re-connecting.
    expect(bob.state()).toEqual({ call: 'connecting', callId: 'call1' })

    // Past the reconnection window, well short of the connect deadline.
    expect(bob.tick(2_000 + DEFAULT_RECONNECT_WINDOW_MS + 1)).toEqual([])
    expect(bob.state()).toEqual({ call: 'connecting', callId: 'call1' })

    const gone = bob.tick(1_000 + DEFAULT_CONNECT_TIMEOUT_MS + 1)
    expect(sentHangupReason(gone)).toBe('ice_failed')
  })

  it('does not share a wire reason with the connect deadline, because the split is whether media flowed', () => {
    const never = machineFor(BOB, ALICE)
    never.handleEvent(inviteFrom(ALICE, 'call1', 'aliceP'), 0)
    never.accept('bobP', sdp('answer', 'v=0'), 0)
    const neverUp = never.tick(DEFAULT_CONNECT_TIMEOUT_MS + 1)

    const died = calleeInCall(BOB, ALICE, 'bobP')
    died.mediaDisconnected(1_000)
    const cameDown = died.tick(1_000 + DEFAULT_RECONNECT_WINDOW_MS + 1)

    expect(sentHangupReason(neverUp)).toBe('ice_failed')
    expect(sentHangupReason(cameDown)).toBe('ice_timeout')
  })

  it('keeps every gesture working, so hanging up mid-countdown is a user hangup', () => {
    // The sentence on the other screen must not blame the network for a
    // decision a person made.
    const bob = calleeInCall(BOB, ALICE, 'bobP')
    bob.mediaDisconnected(1_000)

    const down = bob.hangup('user_hangup', 5_000)
    expect(sentHangupReason(down)).toBe('user_hangup')
    expect(lastState(down)).toEqual({
      call: 'ended',
      reason: { ended: 'hangup', reason: 'user_hangup' },
    })
  })

  it('is absent from a call that never drops, by construction rather than by a rule', () => {
    const bob = calleeInCall(BOB, ALICE, 'bobP')
    expect(bob.tick(3_600_000)).toEqual([])
    expect(bob.state()).toEqual({ call: 'inCall', callId: 'call1' })
  })

  it('lets a report about a call that is over say nothing at all', () => {
    // The window's own expiry ends the call because the media layer is
    // unhappy, which is exactly when that layer is emitting state changes. A
    // refusal here would be routed to a technical failure screen and would
    // replace the ending the reader was just shown with a false sentence.
    const idle = machineFor(BOB, ALICE)
    expect(idle.mediaDisconnected(0)).toEqual([])
    expect(idle.mediaReconnected(0)).toEqual([])
    expect(idle.state()).toEqual({ call: 'idle' })

    const bob = calleeInCall(BOB, ALICE, 'bobP')
    bob.mediaDisconnected(1_000)
    bob.tick(1_000 + DEFAULT_RECONNECT_WINDOW_MS + 1)

    expect(bob.mediaDisconnected(30_000)).toEqual([])
    expect(bob.mediaReconnected(30_000)).toEqual([])
    expect(bob.state()).toEqual({
      call: 'ended',
      reason: { ended: 'hangup', reason: 'ice_timeout' },
    })
  })

  it('is not doubled by the media layer giving up during it', () => {
    const bob = calleeInCall(BOB, ALICE, 'bobP')
    bob.mediaDisconnected(1_000)

    const gone = bob.mediaFailed('ice_timeout', 5_000)
    expect(sentHangupReason(gone)).toBe('ice_timeout')
    expect(lastState(gone)).toEqual({
      call: 'ended',
      reason: { ended: 'hangup', reason: 'ice_timeout' },
    })

    // And the window does not fire a second hangup afterwards.
    expect(bob.tick(1_000 + DEFAULT_RECONNECT_WINDOW_MS + 1)).toEqual([])
  })

  it('does not swallow a renegotiation timer, nor is swallowed by one', () => {
    const bob = calleeInCall(BOB, ALICE, 'bobP')
    bob.requestNegotiation(sdp('offer', 'v=0 with-video'), 1_000)
    bob.mediaDisconnected(2_000)

    // The renegotiation's own lifetime runs out first, well inside the window.
    const negotiation = bob.tick(1_000 + DEFAULT_NEGOTIATE_LIFETIME_MS + 1)
    expect(did(negotiation, 'negotiationTimedOut')).toBe(true)
    expect(bob.state()).toMatchObject({ call: 'reconnecting' })

    expect(
      sentHangupReason(bob.tick(2_000 + DEFAULT_RECONNECT_WINDOW_MS + 1)),
    ).toBe('ice_timeout')
  })
})

describe('renegotiation', () => {
  it('completes a round trip in both directions without leaving the call', () => {
    const bob = calleeInCall(BOB, ALICE, 'bobP')

    const ours = bob.requestNegotiation(sdp('offer', 'v=0 with-video'), 1_000)
    const negotiate = sent(ours, 'm.call.negotiate')?.content
    expect(negotiate?.call_id).toBe('call1')
    expect(negotiate?.party_id).toBe('bobP')
    expect(negotiate?.description.type).toBe('offer')
    expect(negotiate?.lifetime).toBe(DEFAULT_NEGOTIATE_LIFETIME_MS)
    expect(bob.state()).toEqual({ call: 'inCall', callId: 'call1' })

    // A second offer while the first is unanswered is refused: the flow is
    // strictly offer then answer, one at a time.
    expect(() =>
      bob.requestNegotiation(sdp('offer', 'v=0 again'), 1_100),
    ).toThrow(CallError)

    const theirAnswer = bob.handleEvent(
      negotiateFrom(ALICE, 'call1', 'peerP', 'answer'),
      2_000,
    )
    expect(did(theirAnswer, 'applyRenegotiationAnswer')).toBe(true)
    expect(sendCount(theirAnswer)).toBe(0)

    const theirOffer = bob.handleEvent(
      negotiateFrom(ALICE, 'call1', 'peerP', 'offer'),
      3_000,
    )
    expect(did(theirOffer, 'remoteRenegotiationOffer')).toBe(true)

    const ourAnswer = bob.answerNegotiation(sdp('answer', 'v=0 ours'), 3_100)
    expect(sent(ourAnswer, 'm.call.negotiate')?.content.description.type).toBe(
      'answer',
    )
    expect(bob.state()).toEqual({ call: 'inCall', callId: 'call1' })
  })

  it('ignores an offer whose party and user tuple is not the one the call was agreed with', () => {
    const bob = calleeInCall(BOB, ALICE, 'bobP')

    // Right user, wrong party.
    expect(
      bob.handleEvent(
        negotiateFrom(ALICE, 'call1', 'notPeerP', 'offer'),
        1_000,
      ),
    ).toEqual([])
    // Right party, wrong user.
    expect(
      bob.handleEvent(negotiateFrom(MALLORY, 'call1', 'peerP', 'offer'), 1_000),
    ).toEqual([])
    expect(bob.state()).toEqual({ call: 'inCall', callId: 'call1' })
  })

  it('times an unanswered offer out without ending the call', () => {
    const bob = calleeInCall(BOB, ALICE, 'bobP')
    bob.requestNegotiation(sdp('offer', 'v=0 with-video'), 1_000)

    expect(bob.tick(1_000 + DEFAULT_NEGOTIATE_LIFETIME_MS)).toEqual([])
    const timedOut = bob.tick(1_000 + DEFAULT_NEGOTIATE_LIFETIME_MS + 1)
    expect(did(timedOut, 'negotiationTimedOut')).toBe(true)
    expect(bob.state()).toEqual({ call: 'inCall', callId: 'call1' })

    // And an answer arriving after the timeout is a leftover.
    expect(
      bob.handleEvent(
        negotiateFrom(ALICE, 'call1', 'peerP', 'answer'),
        2_001 + DEFAULT_NEGOTIATE_LIFETIME_MS,
      ),
    ).toEqual([])
  })

  it('honours the lifetime of an offer it received, on arrival and afterwards', () => {
    const bob = calleeInCall(BOB, ALICE, 'bobP')

    // Dead on arrival: the age has passed the lifetime, strictly.
    expect(
      bob.handleEvent(
        negotiateFrom(ALICE, 'call1', 'peerP', 'offer', 10_000, 10_001),
        0,
      ),
    ).toEqual([])

    // Alive on arrival with five seconds left, but answered too late.
    const alive = bob.handleEvent(
      negotiateFrom(ALICE, 'call1', 'peerP', 'offer', 10_000, 5_000),
      0,
    )
    expect(did(alive, 'remoteRenegotiationOffer')).toBe(true)
    bob.tick(5_001)
    expect(() =>
      bob.answerNegotiation(sdp('answer', 'v=0 too-late'), 5_100),
    ).toThrow(CallError)
  })

  it('is legal from connecting on, because the accepted answer already exists there', () => {
    const bob = machineFor(BOB, ALICE)
    bob.handleEvent(inviteFrom(ALICE, 'call1', 'peerP'), 0)
    bob.accept('bobP', sdp('answer', 'v=0'), 100)
    expect(bob.state()).toEqual({ call: 'connecting', callId: 'call1' })

    const theirs = bob.handleEvent(
      negotiateFrom(ALICE, 'call1', 'peerP', 'offer'),
      200,
    )
    expect(did(theirs, 'remoteRenegotiationOffer')).toBe(true)
    expect(
      sent(
        bob.answerNegotiation(sdp('answer', 'v=0'), 300),
        'm.call.negotiate',
      ),
    ).toBeDefined()

    const ours = bob.requestNegotiation(sdp('offer', 'v=0 with-video'), 400)
    expect(sent(ours, 'm.call.negotiate')).toBeDefined()
    expect(bob.state()).toEqual({ call: 'connecting', callId: 'call1' })
  })

  it('is refused while the call is merely ringing, where no answer has been accepted yet', () => {
    const bob = machineFor(BOB, ALICE)
    bob.handleEvent(inviteFrom(ALICE, 'call1', 'peerP'), 0)

    expect(() => bob.requestNegotiation(sdp('offer', 'v=0'), 100)).toThrow(
      CallError,
    )
    expect(
      bob.handleEvent(negotiateFrom(ALICE, 'call1', 'peerP', 'offer'), 200),
    ).toEqual([])
    expect(bob.state()).toEqual({
      call: 'incomingInvite',
      callId: 'call1',
      autoAccept: false,
      offer: offer(),
    })
  })

  it('tracks both directions at once when the two sides offer simultaneously', () => {
    // Which SDP survives is the media layer's decision, where the callee is
    // the polite party. The machine drops neither.
    const bob = calleeInCall(BOB, ALICE, 'bobP')

    bob.requestNegotiation(sdp('offer', 'v=0 ours'), 1_000)
    const theirs = bob.handleEvent(
      negotiateFrom(ALICE, 'call1', 'peerP', 'offer'),
      1_100,
    )
    expect(did(theirs, 'remoteRenegotiationOffer')).toBe(true)

    const answeredOurs = bob.handleEvent(
      negotiateFrom(ALICE, 'call1', 'peerP', 'answer'),
      1_200,
    )
    expect(did(answeredOurs, 'applyRenegotiationAnswer')).toBe(true)

    const answeringTheirs = bob.answerNegotiation(
      sdp('answer', 'v=0 to-theirs'),
      1_300,
    )
    expect(sent(answeringTheirs, 'm.call.negotiate')).toBeDefined()
    expect(bob.state()).toEqual({ call: 'inCall', callId: 'call1' })

    // Nothing is left pending, so no timeout fires later.
    expect(bob.tick(1_000 + DEFAULT_NEGOTIATE_LIFETIME_MS + 1)).toEqual([])
  })
})

describe('a version-0 peer', () => {
  function inviteVersionZeroFrom(
    sender: string,
    callId: string,
  ): IncomingCallEvent {
    return received(sender, {
      type: 'm.call.invite',
      content: {
        call_id: callId,
        lifetime: 90_000,
        offer: offer(),
        version: 0,
      },
    })
  }

  it('is refused with a hangup, because it cannot parse an m.call.reject', () => {
    const bob = machineFor(BOB, ALICE)
    const rang = bob.handleEvent(inviteVersionZeroFrom(ALICE, 'call1'), 0)
    expect(lastState(rang)).toEqual({
      call: 'incomingInvite',
      callId: 'call1',
      autoAccept: false,
      offer: offer(),
    })

    const refused = bob.reject('bobP', 100)
    expect(sent(refused, 'm.call.reject')).toBeUndefined()
    const hangup = sent(refused, 'm.call.hangup')?.content
    expect(hangup?.version).toBe(0)
    expect(hangup?.reason).toBe('user_hangup')
    expect(lastState(refused)).toEqual({
      call: 'ended',
      reason: { ended: 'rejected' },
    })
  })

  it('is answered in the version it speaks, with no party id', () => {
    const bob = machineFor(BOB, ALICE)
    bob.handleEvent(inviteVersionZeroFrom(ALICE, 'call1'), 0)

    const accepted = bob.accept('bobP', sdp('answer', 'v=0'), 100)
    const answer = sent(accepted, 'm.call.answer')?.content
    expect(answer?.version).toBe(0)
    expect(answer?.party_id).toBeUndefined()
    expect(lastState(accepted)).toEqual({ call: 'connecting', callId: 'call1' })
  })

  it('gets no select_answer, because it would ignore the event', () => {
    const alice = machineFor(ALICE, BOB)
    alice.placeCall('call1', 'aliceP', offer(), 0)

    const answered = alice.handleEvent(
      received(BOB, {
        type: 'm.call.answer',
        content: { call_id: 'call1', answer: answerSdp(), version: 0 },
      }),
      100,
    )
    expect(sent(answered, 'm.call.select_answer')).toBeUndefined()
    expect(did(answered, 'startMedia')).toBe(true)
    expect(lastState(answered)).toEqual({ call: 'connecting', callId: 'call1' })
  })

  it('has no renegotiation at all, in either direction', () => {
    const bob = machineFor(BOB, ALICE)
    bob.handleEvent(inviteVersionZeroFrom(ALICE, 'call1'), 0)
    bob.accept('bobP', sdp('answer', 'v=0'), 100)

    expect(() => bob.requestNegotiation(sdp('offer', 'v=0'), 200)).toThrow(
      CallError,
    )
    // And a version-0 peer has no party id to validate an incoming one
    // against, so nothing it sends can be attributed to it.
    expect(
      bob.handleEvent(negotiateFrom(ALICE, 'call1', 'peerP', 'offer'), 300),
    ).toEqual([])
  })
})

describe('two machines, talking to each other', () => {
  // The predecessor of this module proved these three against a live
  // homeserver, with two real accounts in an encrypted room. Nothing here
  // needs a network: the machine is pure, so the room can be a function that
  // hands one machine's sends to the other. What is proved is the same
  // thing -- that two of these converge -- and it is proved on every run
  // rather than on the runs somebody remembered to point at production.

  /**
   * Deliver everything one machine asked to send to the other, and return
   * what the other did with it. Live, so the age is zero.
   */
  function deliver(
    from: string,
    actions: readonly CallAction[],
    to: CallMachine,
    nowMs: number,
  ): CallAction[] {
    return actions.flatMap(action =>
      action.act === 'send'
        ? to.handleEvent({ sender: from, event: action.event, ageMs: 0 }, nowMs)
        : [],
    )
  }

  it('converge on a rejection: the callee refuses and the caller selects the reject', () => {
    const alice = machineFor(ALICE, BOB)
    const bob = machineFor(BOB, ALICE)

    deliver(ALICE, alice.placeCall('call1', 'aliceP', offer(), 0), bob, 10)
    expect(bob.state()).toMatchObject({
      call: 'incomingInvite',
      callId: 'call1',
    })

    deliver(BOB, bob.reject('bobP', 20), alice, 30)
    expect(alice.state()).toEqual({
      call: 'ended',
      reason: { ended: 'rejected' },
    })
    expect(bob.state()).toEqual({
      call: 'ended',
      reason: { ended: 'rejected' },
    })
  })

  it('converge on a call answered and then hung up by the caller', () => {
    const alice = machineFor(ALICE, BOB)
    const bob = machineFor(BOB, ALICE)

    deliver(ALICE, alice.placeCall('call2', 'aliceP', offer(), 0), bob, 10)
    deliver(BOB, bob.accept('bobP', answerSdp(), 20), alice, 30)
    expect(bob.state()).toEqual({ call: 'connecting', callId: 'call2' })
    expect(alice.state()).toEqual({ call: 'connecting', callId: 'call2' })

    deliver(ALICE, alice.hangup('user_hangup', 40), bob, 50)
    expect(bob.state()).toEqual({
      call: 'ended',
      reason: { ended: 'hangup', reason: 'user_hangup' },
    })
    expect(alice.state()).toEqual({
      call: 'ended',
      reason: { ended: 'hangup', reason: 'user_hangup' },
    })
  })

  it('converge when the peer leaves the room, once a transport synthesises the hangup', () => {
    // Membership is not an m.call.* event, so the machine never sees a leave
    // and this scenario cannot be driven through it directly. What a
    // transport must do is what is written here: feed the machine a hangup
    // from the peer for the active call. This is the whole of the debt the
    // module header records, expressed as the one line that discharges it.
    const alice = machineFor(ALICE, BOB)
    const bob = machineFor(BOB, ALICE)

    deliver(ALICE, alice.placeCall('call3', 'aliceP', offer(), 0), bob, 10)
    deliver(BOB, bob.accept('bobP', answerSdp(), 20), alice, 30)
    expect(alice.state()).toEqual({ call: 'connecting', callId: 'call3' })

    const synthesised: IncomingCallEvent = {
      sender: BOB,
      event: {
        type: 'm.call.hangup',
        // No party id: the leaver sent none, and inventing one would put a
        // fabricated party on the wire from inside this device. No reason
        // either -- a missing one reads as user_hangup, which is exactly the
        // reading a silent leave wants.
        content: { call_id: 'call3', version: VERSION_1 },
      },
      ageMs: 0,
    }
    const ended = alice.handleEvent(synthesised, 40)

    expect(did(ended, 'stopMedia')).toBe(true)
    expect(alice.state()).toEqual({
      call: 'ended',
      reason: { ended: 'hangup', reason: 'user_hangup' },
    })
  })
})
