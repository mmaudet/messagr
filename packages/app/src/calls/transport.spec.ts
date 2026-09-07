import { describe, expect, it } from 'vitest'

import {
  CallError,
  DEFAULT_INVITE_LIFETIME_MS,
  DEFAULT_RECONNECT_WINDOW_MS,
  type CallAction,
  type CallState,
} from './machine'
import {
  TICK_PERIOD_MS,
  endsCallWhenLost,
  incomingCallEventOf,
  membershipLeaveOf,
  startCallTransport,
  type CallTransport,
} from './transport'
import {
  VERSION_1,
  answerEvent,
  candidatesEvent,
  hangupEvent,
  inviteEvent,
  negotiateEvent,
  rejectEvent,
  selectAnswerEvent,
  type CallEvent,
  type SessionDescription,
} from './wire'

// The transport suite. Everything here runs against injected functions: a
// send that records, a clock that is set rather than read, a timer that fires
// when a test says so, and a glare answer provider that is a script. There is
// no homeserver, no room and no media layer, which is the whole point -- the
// scenarios below are races that cannot be produced on demand on a device.

const NOW = 1_700_000_000_000
/** This account. */
const ALICE = '@alice:example.org'
/** The one other member of the conversation. */
const BOB = '@bob:example.org'
/** The device id this transport runs as, and therefore its `party_id`. */
const DEVICE = 'ALICEDEVICE'

function sdp(type: string, text: string): SessionDescription {
  return { type, sdp: text }
}

function offer(): SessionDescription {
  return sdp('offer', 'v=0 offer-sdp')
}

function answerSdp(): SessionDescription {
  return sdp('answer', 'v=0 answer-sdp')
}

interface ProbeOptions {
  /** The call ids `newCallId` hands out, in order. */
  readonly callIds?: readonly string[]
  /**
   * Runs before an event is recorded as sent. Throwing here is the wire
   * refusing it; awaiting is the wire taking its time.
   */
  readonly send?: (event: CallEvent) => Promise<void>
  /** Replaces the glare answer. Throwing is a media layer that could not. */
  readonly glare?: (offer: SessionDescription) => Promise<SessionDescription>
  /** Replaces the observer. Throwing is a screen that fell over. */
  readonly onAction?: (action: CallAction) => void
}

interface Probe {
  readonly transport: CallTransport
  /** Offered to the wire, in the order the outbox handed them over. */
  readonly attempted: readonly CallEvent[]
  /** Accepted by the wire. */
  readonly sent: readonly CallEvent[]
  /** Everything the observer was handed. */
  readonly actions: readonly CallAction[]
  /** The offers the glare provider was asked to answer. */
  readonly asked: readonly SessionDescription[]
  /** How often the transport asked to be ticked. */
  readonly period: number | undefined
  /** Move the injected clock. */
  readonly advance: (ms: number) => void
  /** One turn of the injected timer, or nothing if it has been stopped. */
  readonly fireTimer: () => void
  readonly timerRunning: () => boolean
  readonly settle: () => Promise<void>
  readonly kinds: () => readonly string[]
  readonly states: () => readonly CallState[]
  /** Every non-state action, by name: the media boundary's half of the batch. */
  readonly mediaCalls: () => readonly string[]
}

function probe(options: ProbeOptions = {}): Probe {
  const attempted: CallEvent[] = []
  const sent: CallEvent[] = []
  const actions: CallAction[] = []
  const asked: SessionDescription[] = []
  const ids = [...(options.callIds ?? ['call-ours'])]
  let nowMs = NOW
  let period: number | undefined
  let timer: (() => void) | undefined

  const transport = startCallTransport(
    { ownUserId: ALICE, peerUserId: BOB, ownPartyId: DEVICE },
    {
      send: async event => {
        attempted.push(event)
        if (options.send !== undefined) await options.send(event)
        sent.push(event)
      },
      now: () => nowMs,
      newCallId: () => ids.shift() ?? 'call-exhausted',
      answerForGlare: async askedOffer => {
        asked.push(askedOffer)
        return options.glare === undefined
          ? answerSdp()
          : await options.glare(askedOffer)
      },
      onAction: action => {
        actions.push(action)
        options.onAction?.(action)
      },
      repeat: (everyMs, run) => {
        period = everyMs
        timer = run
        return () => {
          timer = undefined
        }
      },
    },
  )

  return {
    transport,
    attempted,
    sent,
    actions,
    asked,
    get period() {
      return period
    },
    advance: ms => {
      nowMs += ms
    },
    fireTimer: () => timer?.(),
    timerRunning: () => timer !== undefined,
    settle: () => transport.settled(),
    kinds: () => sent.map(one => one.type),
    states: () => statesOf(actions),
    mediaCalls: () =>
      actions.filter(one => one.act !== 'stateChanged').map(one => one.act),
  }
}

function statesOf(actions: readonly CallAction[]): CallState[] {
  const found: CallState[] = []
  for (const action of actions) {
    if (action.act === 'stateChanged') found.push(action.state)
  }
  return found
}

// ── Raw events, as a sync response carries them ────────────────────────────

function raw(
  type: string,
  sender: string,
  content: Record<string, unknown>,
  ageMs = 0,
): unknown {
  return { type, sender, content, unsigned: { age: ageMs } }
}

function rawInvite(
  sender: string,
  callId: string,
  partyId: string,
  ageMs = 0,
  lifetimeMs: number = DEFAULT_INVITE_LIFETIME_MS,
): unknown {
  return raw(
    'm.call.invite',
    sender,
    {
      call_id: callId,
      party_id: partyId,
      lifetime: lifetimeMs,
      offer: offer(),
      version: VERSION_1,
    },
    ageMs,
  )
}

function rawAnswer(sender: string, callId: string, partyId: string): unknown {
  return raw('m.call.answer', sender, {
    call_id: callId,
    party_id: partyId,
    answer: answerSdp(),
    version: VERSION_1,
  })
}

function rawHangup(sender: string, callId: string, partyId: string): unknown {
  return raw('m.call.hangup', sender, {
    call_id: callId,
    party_id: partyId,
    version: VERSION_1,
    reason: 'user_hangup',
  })
}

function rawLeave(user: string, membership = 'leave'): unknown {
  return {
    type: 'm.room.member',
    // The leaver of an ordinary departure; whoever swung the hammer for a
    // ban or a kick, which is exactly why the reading is on `state_key`.
    sender: user,
    state_key: user,
    content: { membership },
  }
}

/** The wire reason a hangup carried, which is what a screen renders it as. */
function hangupReason(event: CallEvent | undefined): string | undefined {
  return event?.type === 'm.call.hangup' ? event.content.reason : undefined
}

/** Drives a probe to an established call, as the callee. */
async function inACall(one: Probe): Promise<void> {
  one.transport.receive([rawInvite(BOB, 'call-theirs', 'bobparty')])
  one.transport.accept(answerSdp())
  one.transport.mediaConnected()
  await one.settle()
}

describe('an outgoing call', () => {
  it('puts its invite in the room and selects the answer that comes back', async () => {
    // The nominal caller flow, end to end through the transport: the machine
    // decides, the outbox carries, and every event goes out under this
    // device's own party id.
    const one = probe({ callIds: ['call-ours'] })

    const callId = one.transport.placeCall(offer())
    one.transport.receive([rawAnswer(BOB, 'call-ours', 'bobparty')])
    await one.settle()

    expect(callId).toBe('call-ours')
    expect(one.kinds()).toEqual(['m.call.invite', 'm.call.select_answer'])
    expect(one.sent[0]?.content.party_id).toBe(DEVICE)
    expect(one.transport.state()).toEqual({
      call: 'connecting',
      callId: 'call-ours',
    })
    expect(one.mediaCalls()).toEqual(['remoteAnswer', 'startMedia'])
  })

  it('is ended by a hangup, and the hangup reaches the room', async () => {
    const one = probe()
    one.transport.placeCall(offer())
    one.transport.receive([rawAnswer(BOB, 'call-ours', 'bobparty')])
    one.transport.hangup('user_hangup')
    await one.settle()

    expect(one.kinds()).toEqual([
      'm.call.invite',
      'm.call.select_answer',
      'm.call.hangup',
    ])
    expect(one.transport.state()).toEqual({
      call: 'ended',
      reason: { ended: 'hangup', reason: 'user_hangup' },
    })
  })
})

describe('an incoming call', () => {
  it('rings, answers with the media layer offer, and puts the answer in the room', async () => {
    const one = probe()

    one.transport.receive([rawInvite(BOB, 'call-theirs', 'bobparty')])
    expect(one.transport.state()).toEqual({
      call: 'incomingInvite',
      callId: 'call-theirs',
      autoAccept: false,
      offer: offer(),
    })

    one.transport.accept(answerSdp())
    await one.settle()

    expect(one.kinds()).toEqual(['m.call.answer'])
    expect(one.sent[0]?.content.party_id).toBe(DEVICE)
    expect(one.mediaCalls()).toEqual(['startMedia'])
  })

  it('is refused with an m.call.reject carrying this device party', async () => {
    const one = probe()
    one.transport.receive([rawInvite(BOB, 'call-theirs', 'bobparty')])
    one.transport.reject()
    await one.settle()

    expect(one.kinds()).toEqual(['m.call.reject'])
    expect(one.sent[0]?.content.party_id).toBe(DEVICE)
  })

  it('leaves nothing ringing when its hangup arrives in the same poll', async () => {
    // One sync response carries a whole burst. Feeding them in the order the
    // timeline gave them is what makes the machine's own rules enough: it
    // rings on the invite and ends on the hangup, with no window in between
    // in which a screen could be drawn.
    const one = probe()
    one.transport.receive([
      rawInvite(BOB, 'call-theirs', 'bobparty'),
      rawHangup(BOB, 'call-theirs', 'bobparty'),
    ])
    await one.settle()

    expect(one.transport.state().call).toBe('ended')
    expect(one.states().map(state => state.call)).toEqual([
      'incomingInvite',
      'ended',
    ])
  })
})

describe('the clock the transport keeps', () => {
  it('asks to be driven once a second, which is under every deadline it enforces', () => {
    // Not decoration: the reconnection countdown is redrawn on this beat, and
    // anything slower would be visibly wrong on a screen counting seconds.
    expect(probe().period).toBe(TICK_PERIOD_MS)
    expect(TICK_PERIOD_MS).toBe(1_000)
  })

  it('expires an unanswered outgoing invite onto the wire', async () => {
    // Nothing else would. The machine holds the deadline and compares it only
    // when somebody asks it the time, so without this drive the invite is a
    // number nobody ever reads.
    const one = probe()
    one.transport.placeCall(offer())
    one.advance(DEFAULT_INVITE_LIFETIME_MS + 1)
    one.fireTimer()
    await one.settle()

    expect(one.kinds()).toEqual(['m.call.invite', 'm.call.hangup'])
    expect(hangupReason(one.sent[1])).toBe('invite_timeout')
  })

  it('discards an unanswered incoming invite without sending anything', async () => {
    // "Clients should discard it" -- the callee side of the same lifetime
    // sends nothing at all, and a transport that sent a hangup here would be
    // telling the caller something the specification says not to.
    const one = probe()
    one.transport.receive([rawInvite(BOB, 'call-theirs', 'bobparty')])
    one.advance(DEFAULT_INVITE_LIFETIME_MS + 1)
    one.fireTimer()
    await one.settle()

    expect(one.kinds()).toEqual([])
    expect(one.transport.state()).toEqual({
      call: 'ended',
      reason: { ended: 'inviteExpired' },
    })
  })

  it('walks the reconnection countdown down and ends the call when it runs out', async () => {
    const one = probe()
    await inACall(one)
    one.transport.mediaDisconnected()

    one.advance(3_000)
    one.fireTimer()
    expect(one.transport.state()).toEqual({
      call: 'reconnecting',
      callId: 'call-theirs',
      secondsLeft: DEFAULT_RECONNECT_WINDOW_MS / 1_000 - 3,
    })

    one.advance(DEFAULT_RECONNECT_WINDOW_MS)
    one.fireTimer()
    await one.settle()

    // `ice_timeout` and not `ice_failed`: media flowed before it was lost,
    // and the two render as different sentences on a screen.
    expect(hangupReason(one.sent.at(-1))).toBe('ice_timeout')
    expect(one.transport.state().call).toBe('ended')
  })

  it('stops driving it when the transport is stopped', () => {
    const one = probe()
    expect(one.timerRunning()).toBe(true)
    one.transport.stop()
    expect(one.timerRunning()).toBe(false)
    // Idempotent, because a teardown that ran twice must not stop a timer
    // somebody else has since started.
    one.transport.stop()
    expect(one.timerRunning()).toBe(false)
  })

  it('lets what is already queued reach the room after it is stopped', async () => {
    // The last thing a teardown queues is the hangup that tells the peer.
    // Dropping it would leave a telephone ringing for ninety seconds.
    const one = probe()
    one.transport.placeCall(offer())
    one.transport.hangup('user_hangup')
    one.transport.stop()
    await one.settle()

    expect(one.kinds()).toEqual(['m.call.invite', 'm.call.hangup'])
  })
})

describe('the age a received event carries', () => {
  it('is clamped at zero, because a disagreeing clock must not lengthen an invite', () => {
    // `unsigned.age` is signed and goes negative when the two clocks
    // disagree. A negative here would be added to the lifetime, which is the
    // one thing the age field exists to prevent.
    const read = incomingCallEventOf(
      rawInvite(BOB, 'call-theirs', 'bobparty', -30_000),
    )
    expect(read?.ageMs).toBe(0)
  })

  it('is zero when the event carries no unsigned section at all', () => {
    const read = incomingCallEventOf({
      type: 'm.call.hangup',
      sender: BOB,
      content: { call_id: 'call-theirs', version: VERSION_1 },
    })
    expect(read?.ageMs).toBe(0)
  })

  it('is what the sync reported, so an invite is counted down from where it really is', async () => {
    // Two thirds of the lifetime had already gone before this device saw it,
    // so a third is left -- counted on the receiving clock, which is the
    // whole point of the field.
    const one = probe()
    one.transport.receive([rawInvite(BOB, 'call-theirs', 'bobparty', 60_000)])
    one.advance(29_000)
    one.fireTimer()
    expect(one.transport.state().call).toBe('incomingInvite')

    one.advance(2_000)
    one.fireTimer()
    expect(one.transport.state()).toEqual({
      call: 'ended',
      reason: { ended: 'inviteExpired' },
    })
  })

  it('never rings for an invite that was already dead when it arrived', () => {
    const one = probe()
    one.transport.receive([
      rawInvite(BOB, 'call-theirs', 'bobparty', DEFAULT_INVITE_LIFETIME_MS + 1),
    ])
    expect(one.transport.state()).toEqual({ call: 'idle' })
  })
})

describe('reading a stranger event off the wire', () => {
  it('refuses an invite that names no lifetime rather than inventing one', () => {
    // Read as undefined it compares false against every age, so a dead invite
    // would ring -- and would then expire at `now + NaN`, which is never. A
    // parser must not invent the one number the liveness rule is made of.
    expect(
      incomingCallEventOf(
        raw('m.call.invite', BOB, {
          call_id: 'call-theirs',
          party_id: 'bobparty',
          offer: offer(),
          version: VERSION_1,
        }),
      ),
    ).toBeUndefined()
  })

  it('refuses an invite whose offer is not a session description', () => {
    expect(
      incomingCallEventOf(
        raw('m.call.invite', BOB, {
          call_id: 'call-theirs',
          lifetime: DEFAULT_INVITE_LIFETIME_MS,
          offer: { type: 'offer' },
          version: VERSION_1,
        }),
      ),
    ).toBeUndefined()
  })

  it('refuses a candidate list with one unreadable entry rather than half of it', () => {
    // A partial list is a call that connects over a worse path, or not at
    // all, with nothing anywhere saying why.
    expect(
      incomingCallEventOf(
        raw('m.call.candidates', BOB, {
          call_id: 'call-theirs',
          party_id: 'bobparty',
          candidates: [
            { candidate: 'a=candidate:1', sdpMid: '0' },
            { mid: '0' },
          ],
          version: VERSION_1,
        }),
      ),
    ).toBeUndefined()
  })

  it('keeps the end-of-candidates marker, which is an empty candidate with no mid', () => {
    const read = incomingCallEventOf(
      raw('m.call.candidates', BOB, {
        call_id: 'call-theirs',
        party_id: 'bobparty',
        candidates: [{ candidate: '' }],
        version: VERSION_1,
      }),
    )
    expect(read?.event.content).toMatchObject({
      candidates: [{ candidate: '' }],
    })
  })

  it('refuses a select_answer that names no selected party', () => {
    // The machine compares the selected party against its own to decide
    // whether this device keeps the call. One naming nobody would end
    // whichever device read it.
    expect(
      incomingCallEventOf(
        raw('m.call.select_answer', BOB, {
          call_id: 'call-theirs',
          party_id: 'bobparty',
          version: VERSION_1,
        }),
      ),
    ).toBeUndefined()
  })

  it('refuses a reject that carries no party, because nothing could be selected for it', () => {
    expect(
      incomingCallEventOf(
        raw('m.call.reject', BOB, {
          call_id: 'call-theirs',
          version: VERSION_1,
        }),
      ),
    ).toBeUndefined()
  })

  it('accepts a hangup carrying neither party nor reason, which is the version-0 shape', () => {
    // The loosest of the seven on purpose: refusing a hangup over a field it
    // did not have to carry leaves a call on a screen after the peer has gone.
    const read = incomingCallEventOf(
      raw('m.call.hangup', BOB, { call_id: 'call-theirs', version: 0 }),
    )
    expect(read?.event.type).toBe('m.call.hangup')
    expect(read?.event.content.version).toBe(0)
  })

  it('reads an absent version as version 1, which is the lenient rule', () => {
    // Only the numeric zero means version 0, and a missing field is certainly
    // not that. Reading it as legacy would answer a modern client without a
    // party id -- the one thing multi-device semantics cannot do without.
    const read = incomingCallEventOf(
      raw('m.call.hangup', BOB, { call_id: 'call-theirs' }),
    )
    expect(read?.event.content.version).toBe(VERSION_1)
  })

  it('refuses anything that is not one of the seven kinds', () => {
    expect(
      incomingCallEventOf(raw('m.room.message', BOB, { body: 'hello' })),
    ).toBeUndefined()
    expect(incomingCallEventOf(null)).toBeUndefined()
    expect(incomingCallEventOf([rawInvite(BOB, 'x', 'y')])).toBeUndefined()
    expect(
      incomingCallEventOf({ type: 'm.call.hangup', content: {} }),
    ).toBeUndefined()
  })

  it('goes on reading a poll after an event nothing here can make sense of', async () => {
    // This runs on a sync tick with nobody watching, and the event after the
    // unreadable one may be the hangup that ends a call on somebody's screen.
    const one = probe()
    one.transport.receive([
      'not an event',
      raw('m.call.invite', BOB, { call_id: 'call-theirs' }),
      rawInvite(BOB, 'call-theirs', 'bobparty'),
    ])
    expect(one.transport.state().call).toBe('incomingInvite')
  })
})

describe('this account own events', () => {
  it('are forwarded, so a sibling device answering ends the ringing here', async () => {
    // "Since a user may call themselves, they cannot simply ignore events
    // from their own user." A transport that filtered by sender would make
    // "answered elsewhere" unlearnable.
    const one = probe()
    one.transport.receive([rawInvite(BOB, 'call-theirs', 'bobparty')])
    one.transport.receive([rawAnswer(ALICE, 'call-theirs', 'SIBLING')])
    await one.settle()

    expect(one.transport.state()).toEqual({
      call: 'ended',
      reason: { ended: 'answeredElsewhere' },
    })
    // "It does not send any events."
    expect(one.kinds()).toEqual([])
  })

  it('leave the remote echo of this device to the machine party rules', async () => {
    // The echo is dropped because the party id is this device's, not because
    // anything here compares senders.
    const one = probe()
    one.transport.placeCall(offer())
    one.transport.receive([
      raw('m.call.invite', ALICE, {
        call_id: 'call-ours',
        party_id: DEVICE,
        lifetime: DEFAULT_INVITE_LIFETIME_MS,
        offer: offer(),
        version: VERSION_1,
      }),
    ])
    await one.settle()

    expect(one.transport.state()).toEqual({
      call: 'outgoingInvite',
      callId: 'call-ours',
    })
  })
})

describe('when the wire refuses an event', () => {
  it('names the invite and the answer, and nothing else', () => {
    // Losing either strands the call: nobody can answer an invite that never
    // arrived, and a caller waits out the lifetime for an answer that never
    // did. The other five survive being lost, each for its own reason.
    expect(endsCallWhenLost(inviteEvent('c', 'p', 90_000, offer(), BOB))).toBe(
      true,
    )
    expect(endsCallWhenLost(answerEvent('c', 'p', answerSdp()))).toBe(true)
    expect(endsCallWhenLost(candidatesEvent('c', 'p', []))).toBe(false)
    expect(endsCallWhenLost(selectAnswerEvent('c', 'p', 'q'))).toBe(false)
    expect(endsCallWhenLost(rejectEvent('c', 'p'))).toBe(false)
    expect(endsCallWhenLost(negotiateEvent('c', 'p', 10_000, offer()))).toBe(
      false,
    )
    expect(endsCallWhenLost(hangupEvent('c', 'p', 'user_hangup'))).toBe(false)
  })

  it('ends the call at once rather than after ninety seconds of apparent silence', async () => {
    // "We could not reach them" and "they did not pick up" are two different
    // sentences, and a screen that cannot tell them apart shows the second
    // while the first is what happened.
    const one = probe({
      send: async () => {
        throw new Error('the homeserver is unreachable')
      },
    })
    one.transport.placeCall(offer())
    await one.settle()

    expect(one.transport.state()).toEqual({
      call: 'ended',
      reason: { ended: 'sendFailed' },
    })
  })

  it('leaves a working call working when the lost event was only candidates', async () => {
    // Candidates are lossy by design: ICE gathers more, and a path that never
    // works surfaces as `ice_failed` from the media layer.
    const one = probe({
      send: async event => {
        if (event.type === 'm.call.candidates') throw new Error('refused')
      },
    })
    await inACall(one)
    one.transport.sendCandidates([{ candidate: 'a=candidate:1', sdpMid: '0' }])
    await one.settle()

    expect(one.transport.state()).toEqual({
      call: 'inCall',
      callId: 'call-theirs',
    })
  })

  it('ends the call the lost event belonged to, not whichever is running by then', async () => {
    // A send resolves long after the gesture that queued it, and the user
    // goes on using the telephone meanwhile. Every step of place A, cancel A,
    // place B, A's invite finally fails is a legitimate gesture.
    let failFirst: (() => void) | undefined
    const firstSend = new Promise<void>((_, reject) => {
      failFirst = () => reject(new Error('the homeserver is unreachable'))
    })
    let seen = 0
    const one = probe({
      callIds: ['call-a', 'call-b'],
      send: async () => {
        seen += 1
        if (seen === 1) await firstSend
      },
    })

    one.transport.placeCall(offer())
    one.transport.hangup('user_hangup')
    one.transport.placeCall(offer())
    failFirst?.()
    await one.settle()

    expect(one.transport.state()).toEqual({
      call: 'outgoingInvite',
      callId: 'call-b',
    })
  })
})

describe('the order events reach the room in', () => {
  it('keeps a glare batch behind the invite it aborts, with a send in flight', async () => {
    // The property the predecessor took a lock for, and the reason the outbox
    // is a queue rather than an awaited send at each call site: our invite is
    // already in flight when the glare batch is decided, and its hangup must
    // not overtake the invite it is aborting.
    let release: (() => void) | undefined
    const held = new Promise<void>(resolve => {
      release = () => resolve()
    })
    let first = true
    const one = probe({
      // Lexicographically the greater, so the incoming call wins the
      // tie-break and ours is the one aborted.
      callIds: ['zzz-ours'],
      send: async () => {
        if (first) {
          first = false
          await held
        }
      },
    })

    one.transport.placeCall(offer())
    one.transport.receive([rawInvite(BOB, 'aaa-theirs', 'bobparty')])
    release?.()
    await one.settle()

    expect(one.kinds()).toEqual([
      'm.call.invite',
      'm.call.hangup',
      'm.call.answer',
    ])
  })
})

describe('the glare obligation the machine leaves here', () => {
  it('is waited for by settled, which waits until nothing more is in flight', async () => {
    // The discharge starts sending again after the drain that carried the
    // hangup has already finished, so quiescence here is not one wave but
    // several. A `settled` that resolved on the first would hand a teardown a
    // room to let go of with the answer still queued.
    const later = async (): Promise<void> => {
      await new Promise(resolve => setTimeout(resolve, 0))
    }
    const one = probe({
      callIds: ['zzz-ours'],
      send: later,
      // Slower than the sending it restarts, which is what puts the second
      // wave beyond the first: the outbox empties, and only then does the
      // answer arrive to be sent.
      glare: async () => {
        await later()
        await later()
        return answerSdp()
      },
    })
    one.transport.placeCall(offer())
    one.transport.receive([rawInvite(BOB, 'aaa-theirs', 'bobparty')])
    await one.settle()

    expect(one.kinds()).toEqual([
      'm.call.invite',
      'm.call.hangup',
      'm.call.answer',
    ])
  })

  it('answers the winning invite without ringing, from that invite own offer', async () => {
    // "If the incoming call is the lesser, the client should accept this call
    // on behalf of the user." Nothing rings, and the answer is built from the
    // offer the invite carried -- there is no other remote description a
    // callee could answer.
    const one = probe({ callIds: ['zzz-ours'] })
    one.transport.placeCall(offer())
    one.transport.receive([rawInvite(BOB, 'aaa-theirs', 'bobparty')])
    await one.settle()

    expect(one.asked).toEqual([offer()])
    expect(one.kinds()).toEqual([
      'm.call.invite',
      'm.call.hangup',
      'm.call.answer',
    ])
    expect(one.transport.state()).toEqual({
      call: 'connecting',
      callId: 'aaa-theirs',
    })
    // The ringing state is announced before the accept goes out, so nothing
    // ever sees a call connect that it never saw ring.
    expect(one.states().map(state => state.call)).toEqual([
      'outgoingInvite',
      'incomingInvite',
      'connecting',
    ])
  })

  it('leaves the call ringing when no answer can be produced for it', async () => {
    // Degraded to an ordinary incoming call, which a person can still pick
    // up. Ending it would throw away a call the tie-break already won.
    const one = probe({
      callIds: ['zzz-ours'],
      glare: async () => {
        throw new Error('no media layer here yet')
      },
    })
    one.transport.placeCall(offer())
    one.transport.receive([rawInvite(BOB, 'aaa-theirs', 'bobparty')])
    await one.settle()

    expect(one.transport.state()).toEqual({
      call: 'incomingInvite',
      callId: 'aaa-theirs',
      autoAccept: true,
      offer: offer(),
    })
    expect(one.kinds()).toEqual(['m.call.invite', 'm.call.hangup'])
  })

  it('does not answer a call the caller abandoned while the answer was being built', async () => {
    // The predecessor never had to ask: its provider was a synchronous trait.
    // This one is a promise, and in the time an answer takes to generate the
    // caller can hang up -- so an answer put on the wire here would be for a
    // call nobody is on.
    let produce: ((answer: SessionDescription) => void) | undefined
    const pending = new Promise<SessionDescription>(resolve => {
      produce = resolve
    })
    const one = probe({ callIds: ['zzz-ours'], glare: async () => pending })

    one.transport.placeCall(offer())
    one.transport.receive([rawInvite(BOB, 'aaa-theirs', 'bobparty')])
    one.transport.receive([rawHangup(BOB, 'aaa-theirs', 'bobparty')])
    produce?.(answerSdp())
    await one.settle()

    expect(one.kinds()).toEqual(['m.call.invite', 'm.call.hangup'])
    expect(one.transport.state().call).toBe('ended')
  })

  it('does not answer a second call with the answer built for the first', async () => {
    // The sharper half of the same re-read. It is not enough to ask whether
    // something is ringing when the answer arrives: what is ringing may be a
    // different call, and an answer built from one invite offer is an answer
    // to nothing at all when it is put on another invite.
    let produce: ((answer: SessionDescription) => void) | undefined
    const pending = new Promise<SessionDescription>(resolve => {
      produce = resolve
    })
    const one = probe({ callIds: ['zzz-ours'], glare: async () => pending })

    one.transport.placeCall(offer())
    one.transport.receive([rawInvite(BOB, 'aaa-theirs', 'bobparty')])
    one.transport.receive([rawHangup(BOB, 'aaa-theirs', 'bobparty')])
    one.transport.receive([rawInvite(BOB, 'bbb-theirs', 'bobparty')])
    produce?.(answerSdp())
    await one.settle()

    expect(one.kinds()).toEqual(['m.call.invite', 'm.call.hangup'])
    expect(one.transport.state()).toEqual({
      call: 'incomingInvite',
      callId: 'bbb-theirs',
      autoAccept: false,
      offer: offer(),
    })
  })

  it('announces the ending when the invite expired between the marker and the accept', async () => {
    // `accept`'s throwing path emits no state change of its own, so the
    // ending is announced here or nowhere -- and nowhere leaves a screen on a
    // ringing call it can never answer.
    let produce: ((answer: SessionDescription) => void) | undefined
    const pending = new Promise<SessionDescription>(resolve => {
      produce = resolve
    })
    const one = probe({ callIds: ['zzz-ours'], glare: async () => pending })

    one.transport.placeCall(offer())
    one.transport.receive([rawInvite(BOB, 'aaa-theirs', 'bobparty')])
    one.advance(DEFAULT_INVITE_LIFETIME_MS + 1)
    produce?.(answerSdp())
    await one.settle()

    expect(one.transport.state()).toEqual({
      call: 'ended',
      reason: { ended: 'inviteExpired' },
    })
    expect(one.states().at(-1)).toEqual({
      call: 'ended',
      reason: { ended: 'inviteExpired' },
    })
  })
})

describe('the peer leaving the room', () => {
  it('ends a call in progress and stops the media', async () => {
    // "If the client sees the user it is in a call with leave the room, the
    // client should treat this as a hangup event for any calls that are in
    // progress." A membership change is not an `m.call.*` event, so the
    // machine can never see it.
    const one = probe()
    await inACall(one)
    one.transport.receive([rawLeave(BOB)])
    await one.settle()

    expect(one.transport.state()).toEqual({
      call: 'ended',
      reason: { ended: 'hangup', reason: 'user_hangup' },
    })
    expect(one.mediaCalls()).toContain('stopMedia')
  })

  it('ends an outgoing invite nobody will now answer', async () => {
    const one = probe()
    one.transport.placeCall(offer())
    one.transport.receive([rawLeave(BOB)])
    await one.settle()

    expect(one.transport.state().call).toBe('ended')
  })

  it('ends a ringing call, because there is nobody left to answer', async () => {
    const one = probe()
    one.transport.receive([rawInvite(BOB, 'call-theirs', 'bobparty')])
    one.transport.receive([rawLeave(BOB)])
    await one.settle()

    expect(one.transport.state().call).toBe('ended')
  })

  it('ends a call that is counting its reconnection window down', async () => {
    // Still a call, and a peer who has left has ended it whatever the media
    // layer believes about the connection.
    const one = probe()
    await inACall(one)
    one.transport.mediaDisconnected()
    expect(one.transport.state().call).toBe('reconnecting')

    one.transport.receive([rawLeave(BOB)])
    await one.settle()
    expect(one.transport.state().call).toBe('ended')
  })

  it('is an ordinary membership change when there is no call', async () => {
    const one = probe()
    one.transport.receive([rawLeave(BOB)])
    await one.settle()

    expect(one.transport.state()).toEqual({ call: 'idle' })
    expect(one.kinds()).toEqual([])
  })

  it('is read from a ban too, which the predecessor did not read', async () => {
    // A banned peer is out of the room by every measure a call cares about:
    // they can receive nothing further. The specification sentence is about
    // the consequence, not about which word the membership used.
    const one = probe()
    await inACall(one)
    one.transport.receive([rawLeave(BOB, 'ban')])
    await one.settle()

    expect(one.transport.state().call).toBe('ended')
  })

  it('is not read from an invite, a join or a knock', () => {
    expect(membershipLeaveOf(rawLeave(BOB, 'join'))).toBeUndefined()
    expect(membershipLeaveOf(rawLeave(BOB, 'invite'))).toBeUndefined()
    expect(membershipLeaveOf(rawLeave(BOB, 'knock'))).toBeUndefined()
    expect(membershipLeaveOf(rawLeave(BOB))).toBe(BOB)
  })

  it('is read off the state key, not the sender, because a ban is somebody else doing', () => {
    // An ordinary departure is self-sent, but a ban and a kick are sent by
    // whoever performed them: reading `sender` there names the wrong person
    // and would end the call on the wrong departure.
    expect(
      membershipLeaveOf({
        type: 'm.room.member',
        sender: ALICE,
        state_key: BOB,
        content: { membership: 'ban' },
      }),
    ).toBe(BOB)
  })

  it('is not read from a member event that names nobody', () => {
    expect(
      membershipLeaveOf({
        type: 'm.room.member',
        sender: BOB,
        content: { membership: 'leave' },
      }),
    ).toBeUndefined()
    expect(membershipLeaveOf(raw('m.room.message', BOB, {}))).toBeUndefined()
  })
})

describe('this account leaving the room', () => {
  it('hangs up a call in progress, because a call without a room cannot continue', async () => {
    // The specification is silent here -- "Behaviour on Room Leave" covers
    // only the peer -- so this is the product's reading, and it is fed as the
    // local intent to end rather than as a received event.
    const one = probe()
    await inACall(one)
    one.transport.receive([rawLeave(ALICE)])
    await one.settle()

    expect(one.transport.state()).toEqual({
      call: 'ended',
      reason: { ended: 'hangup', reason: 'user_hangup' },
    })
    expect(one.attempted.at(-1)?.type).toBe('m.call.hangup')
  })

  it('refuses a ringing call, which is the gesture that state has', async () => {
    // A ringing invite is refused with `m.call.reject`, never with a hangup:
    // that is the version-1 rule, and the transport does not get to pick a
    // different verb because the reason for ending is unusual.
    const one = probe()
    one.transport.receive([rawInvite(BOB, 'call-theirs', 'bobparty')])
    one.transport.receive([rawLeave(ALICE)])
    await one.settle()

    expect(one.kinds()).toEqual(['m.call.reject'])
    expect(one.transport.state()).toEqual({
      call: 'ended',
      reason: { ended: 'rejected' },
    })
  })

  it('is an ordinary membership change when there is no call', async () => {
    const one = probe()
    one.transport.receive([rawLeave(ALICE)])
    await one.settle()

    expect(one.transport.state()).toEqual({ call: 'idle' })
    expect(one.kinds()).toEqual([])
  })

  it('lets the ending stand even when the room refuses the event it sends', async () => {
    // The send goes into a room this account has already left, so it very
    // likely fails. The ending is what a screen needs; the failed send takes
    // the outbox's ordinary path, and for a hangup that path is a no-op.
    const one = probe({
      send: async () => {
        throw new Error('this account is no longer in the room')
      },
    })
    one.transport.receive([rawInvite(BOB, 'call-theirs', 'bobparty')])
    one.transport.accept(answerSdp())
    one.transport.receive([rawLeave(ALICE)])
    await one.settle()

    expect(one.transport.state().call).toBe('ended')
  })
})

describe('nothing thrown reaches the sync loop', () => {
  it('survives an observer that throws, and delivers the rest of the batch', () => {
    // The observer is outside code and this is reached from a tick. A screen
    // that falls over must not cost the actions behind it -- which include
    // the `stopMedia` that closes a microphone.
    const seen: string[] = []
    const one = probe({
      onAction: action => {
        seen.push(action.act)
        if (action.act === 'stopMedia') throw new Error('the screen fell over')
      },
    })
    one.transport.receive([rawInvite(BOB, 'call-theirs', 'bobparty')])
    one.transport.accept(answerSdp())
    one.transport.receive([rawHangup(BOB, 'call-theirs', 'bobparty')])

    expect(seen).toContain('stopMedia')
    expect(seen.at(-1)).toBe('stateChanged')
  })

  it('survives a poll of nothing it can read, and a tick on an idle machine', () => {
    const one = probe()
    expect(() =>
      one.transport.receive([undefined, 7, 'x', {}, { type: 'm.room.member' }]),
    ).not.toThrow()
    expect(() => one.transport.tick()).not.toThrow()
    expect(one.transport.state()).toEqual({ call: 'idle' })
  })

  it('survives a port that fails, on both of the doors the environment drives', () => {
    // The test is about the loop, not about the clock. A poll and a timer
    // have nobody to catch for them: anything thrown out of either lands in
    // the sync loop, whose only answer to an exception is to call the
    // connection lost and back off -- and an event that throws is in every
    // poll, so the loop would never recover from it.
    let broken = false
    const transport = startCallTransport(
      { ownUserId: ALICE, peerUserId: BOB, ownPartyId: DEVICE },
      {
        send: async () => undefined,
        now: () => {
          if (broken) throw new Error('this clock is not answering')
          return NOW
        },
        newCallId: () => 'call-ours',
        answerForGlare: async () => answerSdp(),
        onAction: () => undefined,
        repeat: () => () => undefined,
      },
    )

    broken = true
    expect(() =>
      transport.receive([rawInvite(BOB, 'call-theirs', 'bobparty')]),
    ).not.toThrow()
    expect(() => transport.tick()).not.toThrow()

    // And it is still usable once the port is: nothing was left half-applied.
    broken = false
    transport.receive([rawInvite(BOB, 'call-theirs', 'bobparty')])
    expect(transport.state().call).toBe('incomingInvite')
  })

  it('resolves settled without rejecting after every send has failed', async () => {
    const one = probe({
      send: async () => {
        throw new Error('the homeserver is unreachable')
      },
    })
    one.transport.placeCall(offer())
    await expect(one.settle()).resolves.toBeUndefined()
  })
})

describe('a local gesture the machine cannot honour', () => {
  it('is refused to the person who made it, rather than swallowed', async () => {
    // The opposite discipline to the two doors above, and deliberately: a
    // remote event in a wrong state is a race, but somebody pressing answer
    // and being told nothing is a screen that hangs for ever.
    const one = probe()
    expect(() => one.transport.accept(answerSdp())).toThrow(CallError)
    expect(() => one.transport.hangup('user_hangup')).toThrow(CallError)

    one.transport.placeCall(offer())
    expect(() => one.transport.placeCall(offer())).toThrow(CallError)
    await one.settle()

    // The refused gestures put nothing on the wire.
    expect(one.kinds()).toEqual(['m.call.invite'])
  })
})

describe('a renegotiation, which is how a call gains video', () => {
  it('goes out with this device party and is answered by the peer', async () => {
    const one = probe()
    await inACall(one)

    one.transport.requestNegotiation(sdp('offer', 'v=0 video-offer'))
    await one.settle()
    expect(one.kinds()).toEqual(['m.call.answer', 'm.call.negotiate'])

    one.transport.receive([
      raw('m.call.negotiate', BOB, {
        call_id: 'call-theirs',
        party_id: 'bobparty',
        lifetime: 10_000,
        description: sdp('answer', 'v=0 video-answer'),
        version: VERSION_1,
      }),
    ])
    await one.settle()

    expect(one.mediaCalls()).toContain('applyRenegotiationAnswer')
    expect(one.transport.state().call).toBe('inCall')
  })

  it('times out on the clock without ending the call', async () => {
    // Four of the five things the clock causes end the call and this one does
    // not: a renegotiation that nobody answered leaves a working call working.
    const one = probe()
    await inACall(one)
    one.transport.requestNegotiation(sdp('offer', 'v=0 video-offer'))

    one.advance(11_000)
    one.fireTimer()
    await one.settle()

    expect(one.mediaCalls()).toContain('negotiationTimedOut')
    expect(one.transport.state()).toEqual({
      call: 'inCall',
      callId: 'call-theirs',
    })
  })
})
