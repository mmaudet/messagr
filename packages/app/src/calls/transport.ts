/**
 * The room boundary of a 1:1 call.
 *
 * `machine.ts` is the protocol brain and holds no I/O by contract; this
 * module is the body that connects it to a conversation. It lives apart for
 * exactly that reason: the machine's header promises something that
 * "performs no I/O and holds no randomness", and reaching a room from inside
 * it would break the property its hundred scenarios lean on -- every one of
 * them replays exactly.
 *
 * A transport does four things, and each is here rather than in the machine
 * for a reason the machine's own header states.
 *
 * 1. **Sends** the machine's `send` actions into the room, through the
 *    application's encrypted send path -- the same door messages take, not
 *    beside it. A call is placed only into a room with one other person in
 *    it (specification, Security considerations), which in this product is
 *    an encrypted room, so "the same door" and "encrypted" are one
 *    requirement wearing two names.
 * 2. **Receives** `m.call.*` events off the sync loop, converts them to the
 *    machine's `IncomingCallEvent` -- sender, and `unsigned.age` as an age
 *    in milliseconds -- and feeds them in. Events sent by *this account's
 *    own user* are forwarded too, and that is not an oversight: a sibling
 *    device's answer or reject is how "answered elsewhere" is learned
 *    ("since a user may call themselves, they cannot simply ignore events
 *    from their own user", specification, Party Identifiers). Dropping the
 *    remote echo of this device's own events is the machine's `party_id`
 *    logic, not a filter here.
 * 3. **Keeps the clock.** The machine takes `nowMs` on every method; the
 *    transport supplies it, injectably, and drives `tick` once a second.
 *    Without that drive an invite lifetime and a renegotiation timeout are
 *    numbers nothing ever compares against: the machine expires a call when
 *    somebody asks it what time it is, and this is who asks.
 * 4. **Discharges the two obligations the machine deliberately left here**,
 *    both of which need something the machine is defined not to have.
 *
 *    **Glare auto-accept.** "If the incoming call is the lesser, the client
 *    should accept this call on behalf of the user"
 *    (<https://spec.matrix.org/latest/client-server-api/#glare>). Accepting
 *    needs an answer SDP and an answer SDP is media work, so the machine
 *    raises `incomingInvite.autoAccept` and stops. The answer is drawn here
 *    from an injected provider, and **a provider that fails leaves the call
 *    ringing** -- degraded to an ordinary incoming call somebody can still
 *    pick up, never silently ended.
 *
 *    **Behaviour on room leave.** "If the client sees the user it is in a
 *    call with leave the room, the client should treat this as a hangup
 *    event for any calls that are in progress." A departure is an
 *    `m.room.member` event, not an `m.call.*` one, so a machine whose whole
 *    input is the seven call event types can never see it. The transport
 *    watches membership and feeds the machine a synthesised hangup from the
 *    peer. The specification's other sentence -- a client "may wish to treat
 *    it as a rejection" -- gets the same treatment and not its own, for the
 *    reason the machine's header gives: a synthesised reject would have to
 *    invent a `party_id` for a device that never answered, and the caller
 *    would then put a `select_answer` for that invented party on the wire.
 *
 * # Ports, not imports
 *
 * Nothing here names a homeserver, a room, a crypto machine or a timer. The
 * transport is handed a function that sends, a function that says what time
 * it is, a function that draws a call id, a function that produces a glare
 * answer, a function that repeats, and a function to hand actions to. That
 * is what lets the whole of this file be tested without a device, and it is
 * this repository's idiom (`admitAnyoneWaiting.ts`).
 *
 * # What the predecessor did differently, and why this does not
 *
 * Ported from the previous repository's `core/src/call_transport.rs`, which
 * spoke to `matrix-sdk`: it registered eight handlers on a `Room` and sent
 * with `Room::send`. There is no such room model here (ADR-0005), and this
 * application runs its own sync loop (ADR-0007), so what ports is the four
 * obligations above rather than the calls that discharged them.
 *
 * **The mutex is gone and the ordering it protected is not.** The Rust was
 * driven from two kinds of thread at once and held the machine's lock across
 * the transition *and* the push to its outbox, so that a later batch could
 * not slip its hangup ahead of the invite that batch aborts. JavaScript has
 * one thread and no lock to take, but the property is not free: it survives
 * because `pump` never awaits between running the machine and pushing, and
 * because exactly one drain empties the outbox. Both are load-bearing.
 *
 * **The wire shapes are read rather than deserialised.** Ruma refused a
 * malformed `m.call.*` content before the Rust ever saw it. Nothing does
 * that here, so this module does: `incomingCallEventOf` is where a
 * stranger's JSON becomes one of the seven shapes or nothing at all. It is
 * not in `wire.ts` because `wire.ts` describes what travels, and deciding
 * whether an arbitrary object *is* one of those is a boundary decision --
 * and the boundary is here.
 *
 * # Not here, deliberately
 *
 * No wiring: nothing in this file is called by `App.tsx`, by the sync loop
 * or by a screen, and connecting it wants a device. No media: SDP is carried
 * opaquely and `react-native-webrtc` is named nowhere. No relay-only ICE
 * policy, which is its own module. And no replay of an invite that predates
 * the attach -- the previous repository grew one when a call could arrive by
 * push, which needs a history read this transport has no port for and an
 * account-level watch that does not exist yet.
 */

import {
  CallMachine,
  callConfig,
  type CallAction,
  type CallState,
  type IncomingCallEvent,
} from './machine'
import {
  VERSION_1,
  callIdOf,
  type CallEvent,
  type Candidate,
  type SentHangupReason,
  type SessionDescription,
  type VoipVersion,
} from './wire'

/**
 * How often the transport drives the machine's clock.
 *
 * One second, against protocol deadlines of ninety seconds (an invite), ten
 * (a renegotiation) and twenty (a reconnection window). It is also what the
 * reconnection countdown is redrawn at, and a countdown that moved every two
 * seconds would be visibly wrong on a screen counting in seconds.
 */
export const TICK_PERIOD_MS = 1_000

/**
 * A bound on the auto-accept chain.
 *
 * The legitimate chain is glare, then an accept, and at most one further
 * glare marker behind it. Anything deeper is a defect rather than a protocol
 * path, and this makes such a defect finite rather than fast.
 */
const MAX_AUTO_ACCEPT_DEPTH = 4

/** Everything about its environment the transport is told once. */
export interface CallTransportConfig {
  /** The account this device is logged in as. */
  readonly ownUserId: string
  /**
   * The other member of the conversation: the machine's peer, and the
   * membership the room-leave rule watches.
   */
  readonly peerUserId: string
  /**
   * This device's `party_id`, stable across calls.
   *
   * "A client implementation may choose to use the device ID used in
   * end-to-end cryptography for this purpose" (specification, Party
   * Identifiers), and that is what the wiring should pass. The
   * specification's hedge against it -- that a party id reveals which
   * devices were used, "in an unencrypted room" -- is what makes the
   * encrypted send path above a requirement and not a preference.
   */
  readonly ownPartyId: string
}

/** The functions the transport is built from. It names no transport itself. */
export interface CallTransportPorts {
  /**
   * Puts one `m.call.*` event in the conversation's room: `event.content`
   * under `event.type`, through the application's encrypted send path.
   *
   * Rejecting means the wire refused it. That is not the same as the call
   * failing -- most of the seven kinds survive being lost -- so the outbox
   * decides what to do with a rejection; see `endsCallWhenLost`.
   */
  readonly send: (event: CallEvent) => Promise<void>
  /** Milliseconds since the epoch. Injected, so a test replays a scenario exactly. */
  readonly now: () => number
  /**
   * Draws a fresh call id.
   *
   * Injected for the machine's own reason: the specification asks only that
   * a call be identified uniquely, and a transport that drew its own could
   * not be replayed. The application passes something random; a test passes
   * a script.
   */
  readonly newCallId: () => string
  /**
   * The glare seam: an answer to this offer, produced with no user
   * interaction, because the tie-break has already decided on the user's
   * behalf.
   *
   * Asynchronous because generating an SDP answer is, and the transport
   * re-reads the machine's state afterwards for exactly that reason. A
   * rejection here is not an error the call dies of: it leaves the invite
   * ringing.
   */
  readonly answerForGlare: (
    offer: SessionDescription,
  ) => Promise<SessionDescription>
  /**
   * Everything the machine emits that is not a send: the state changes a
   * screen draws, and the media layer's `startMedia`, `stopMedia`,
   * `remoteAnswer`, `remoteCandidates` and the two renegotiation actions.
   *
   * Called synchronously, in the machine's own order. It may throw without
   * consequence: this is outside code driven from a sync tick, so a
   * callback that fails must not take the batch down with it.
   */
  readonly onAction: (action: CallAction) => void
  /**
   * Starts a repeating timer and answers the function that stops it.
   *
   * `setInterval` in the application, a controllable fake in a test -- which
   * is the only way a ninety-second lifetime is exercised in under a
   * millisecond.
   */
  readonly repeat: (everyMs: number, run: () => void) => () => void
}

/**
 * A running transport.
 *
 * The local intents throw `CallError` exactly as the machine does, and
 * deliberately: somebody pressing "answer" in a state that refuses it must
 * be told, which is the whole reason the machine throws for intents and
 * ignores surprising remote events. The two doors the environment drives --
 * `receive` and `tick` -- throw nothing at all.
 */
export interface CallTransport {
  /** The machine's observable state, for whoever draws. */
  readonly state: () => CallState
  /** Place a call with the media layer's offer. Answers the call id drawn for it. */
  readonly placeCall: (offer: SessionDescription) => string
  /**
   * Pick up the ringing call with the media layer's answer.
   *
   * The glare path does not come through here: that one is discharged by the
   * transport itself, without ringing.
   */
  readonly accept: (answer: SessionDescription) => void
  /** Refuse the ringing call. */
  readonly reject: () => void
  /** End the call locally, with the wire reason to stamp. */
  readonly hangup: (reason: SentHangupReason) => void
  /** Forward candidates the media layer gathered. */
  readonly sendCandidates: (candidates: readonly Candidate[]) => void
  /** The media layer reports the connection up. */
  readonly mediaConnected: () => void
  /** The media layer reports it lost on a call that was up. Not terminal. */
  readonly mediaDisconnected: () => void
  /** The media layer reports it back. */
  readonly mediaReconnected: () => void
  /** The media layer reports a fatal failure. */
  readonly mediaFailed: (reason: SentHangupReason) => void
  /** Offer a renegotiation -- the path a call takes to add video. */
  readonly requestNegotiation: (description: SessionDescription) => void
  /** Answer the peer's renegotiation offer. */
  readonly answerNegotiation: (description: SessionDescription) => void
  /**
   * Feed one sync's worth of raw room events, in the order the timeline gave
   * them.
   *
   * `m.call.*` events reach the machine; an `m.room.member` departure
   * discharges the room-leave obligation; everything else, including
   * anything this build cannot read, is ignored. Throws nothing.
   */
  readonly receive: (rawEvents: readonly unknown[]) => void
  /** One turn of the machine's clock. Driven by the ticker; exposed for tests. */
  readonly tick: () => void
  /**
   * Stop the ticker.
   *
   * What is already in the outbox still goes out: the last thing a teardown
   * queues is usually the hangup that tells the peer, and dropping it would
   * leave somebody's telephone ringing for ninety seconds.
   */
  readonly stop: () => void
  /**
   * Resolves once nothing is in flight -- the outbox is empty and no glare
   * discharge is running.
   *
   * What a test awaits instead of guessing at timers, and what a teardown
   * awaits before it lets the room go. Never rejects: a send that failed has
   * already been dealt with by the outbox.
   */
  readonly settled: () => Promise<void>
}

/**
 * Whether losing this event to a wire failure must end the call.
 *
 * True for exactly two kinds, and each for the same reason stated from a
 * different side. **The invite**: the peer never learns there is a call, so
 * no answer can ever come, and without this the failure is indistinguishable
 * from ninety seconds of somebody not picking up. **The answer**: the caller
 * waits out that same lifetime while this side sits in `connecting`.
 *
 * Everything else survives being lost, and each for its own reason.
 * Candidates are lossy by design -- ICE gathers more, and a path that never
 * works surfaces as `ice_failed` from the media layer. A negotiate carries
 * its own lifetime, so a lost renegotiation expires as `negotiationTimedOut`
 * without ending a working call. A `select_answer` exists to release the
 * callee's *other* devices, which is moot when the channel is dead, and the
 * selected device's call proceeds without it. A hangup and a reject are sent
 * by a machine that has already ended the call locally, so feeding the
 * failure back would change nothing.
 */
export function endsCallWhenLost(event: CallEvent): boolean {
  return event.type === 'm.call.invite' || event.type === 'm.call.answer'
}

/**
 * One raw timeline event as an `IncomingCallEvent`, or nothing.
 *
 * Nothing for anything that is not one of the seven kinds, and nothing for
 * one of the seven that arrived malformed. Refusing rather than repairing:
 * the fields checked below are the ones the machine's rules are made of, and
 * a default invented here would be a protocol decision taken by a parser.
 */
export function incomingCallEventOf(
  raw: unknown,
): IncomingCallEvent | undefined {
  const held = asObject(raw)
  if (held === undefined) return undefined
  const { type, sender } = held
  if (typeof type !== 'string' || typeof sender !== 'string') return undefined
  const event = callEventOf(type, held.content)
  return event === undefined
    ? undefined
    : { sender, event, ageMs: ageOf(held.unsigned) }
}

/**
 * Who a membership event says has left the room, or nothing.
 *
 * **A ban counts, and the predecessor did not count it.** That transport
 * matched `leave` alone; a banned member is out of the room by every measure
 * a call cares about, and the call that keeps running because the membership
 * said `ban` is a call whose peer can no longer receive a single event. The
 * specification's sentence is about the consequence -- "leave the room" --
 * not about which of the two words the state machine used to get there.
 *
 * The `state_key` is who the event is *about*, which is the reading this
 * needs: an ordinary leave is self-sent, but a ban and a kick are sent by
 * whoever performed them, and `sender` there names the wrong person.
 */
export function membershipLeaveOf(raw: unknown): string | undefined {
  const held = asObject(raw)
  if (held === undefined || held.type !== 'm.room.member') return undefined
  const stateKey = held.state_key
  if (typeof stateKey !== 'string') return undefined
  const membership = asObject(held.content)?.membership
  return membership === 'leave' || membership === 'ban' ? stateKey : undefined
}

/**
 * Wires a machine to a room and starts its clock.
 *
 * Returns immediately, ticking, exactly as `startSyncLoop` does; `stop` ends
 * the ticking.
 */
export function startCallTransport(
  config: CallTransportConfig,
  ports: CallTransportPorts,
): CallTransport {
  const machine = new CallMachine(
    callConfig(config.ownUserId, config.peerUserId),
  )

  /**
   * Events waiting for the wire, in the order the machine emitted them.
   *
   * A queue rather than an awaited send at each call site, and this is the
   * ordering property the Rust took a lock for. A send is a promise; if each
   * intent awaited its own, a second gesture arriving in the meantime would
   * interleave its events with the first's -- and the batch that most needs
   * this is glare, where a hangup aborting our call and the answer to
   * theirs must reach the room in that order.
   */
  const outbox: CallEvent[] = []
  let draining = false

  /**
   * Everything started and not finished, chained.
   *
   * A chain rather than a set because work here starts more work: a failed
   * send feeds the machine, which sends. `settled` waits until waiting stops
   * changing anything.
   */
  let quiet: Promise<void> = Promise.resolve()
  function track(work: Promise<void>): void {
    // The catch makes `settled` unable to reject, which is what lets it be
    // awaited bare on a teardown path. Nothing upstream of it is known to
    // reject today -- the drain handles its own send failures and the
    // discharge handles its own -- so this guards the contract rather than a
    // thrower, and no test can pin it without one. It is a line, and an
    // unhandled rejection escaping a promise nobody was told to catch is a
    // crash.
    quiet = quiet.then(async () => work).catch(() => undefined)
  }

  /**
   * Hands one action to the observer.
   *
   * Guarded because the observer is outside code and this is reached from a
   * sync tick: a callback that throws must not cost the rest of the batch,
   * nor reach a loop whose only answer to an exception is to call the
   * connection lost.
   */
  function announce(action: CallAction): void {
    try {
      ports.onAction(action)
    } catch {
      // Nothing to report to, and nothing to do about it. The machine's
      // state is unchanged either way; the next action is still owed to
      // whoever is still listening.
    }
  }

  /**
   * Runs one machine transition, queues its sends, and answers the rest.
   *
   * **Nothing is awaited between the transition and the push**, which is
   * what makes a batch's state change and its events one unit. That
   * sentence is the whole of the ordering guarantee in a single-threaded
   * runtime, and a stray `await` in this function would remove it without
   * failing a type check.
   */
  function pump(
    run: (machine: CallMachine, nowMs: number) => CallAction[],
  ): CallAction[] {
    const actions = run(machine, ports.now())
    const rest: CallAction[] = []
    for (const action of actions) {
      if (action.act === 'send') outbox.push(action.event)
      else rest.push(action)
    }
    startDraining()
    return rest
  }

  /**
   * Hands a batch's non-send actions to the observer, then discharges the
   * glare obligation if the batch raised it.
   *
   * The order matters to a screen: the ringing state is announced before the
   * accept goes out, so a surface that draws from `stateChanged` never shows
   * a call connecting that it never showed ringing.
   */
  function deliver(actions: readonly CallAction[], depth: number): void {
    let glareCallId: string | undefined
    for (const action of actions) {
      if (action.act === 'stateChanged') {
        glareCallId =
          action.state.call === 'incomingInvite' && action.state.autoAccept
            ? action.state.callId
            : undefined
      }
      announce(action)
    }
    if (glareCallId !== undefined && depth < MAX_AUTO_ACCEPT_DEPTH) {
      track(dischargeAutoAccept(glareCallId, depth))
    }
  }

  /**
   * One transition, start to finish: run the machine, queue what it sends,
   * hand the rest on.
   *
   * Every gesture below is this and nothing else, which is the point -- the
   * depth argument `deliver` takes belongs to the glare chain alone, and no
   * ordinary path should ever have to name it.
   */
  function drive(
    run: (machine: CallMachine, nowMs: number) => CallAction[],
  ): void {
    deliver(pump(run), 0)
  }

  /**
   * "The client should accept this call on behalf of the user."
   *
   * Silent by construction: nothing here rings, and the accept goes out
   * without anybody having pressed anything.
   */
  async function dischargeAutoAccept(
    callId: string,
    depth: number,
  ): Promise<void> {
    const offer = machine.pendingOffer()
    // The state moved between the marker and here -- a hangup from the
    // caller, most likely. There is nothing left to accept.
    if (offer === undefined) return

    let answer: SessionDescription
    try {
      answer = await ports.answerForGlare(offer)
    } catch {
      // The obligation cannot be met without an answer SDP, and the call
      // goes on ringing rather than ending. The tie-break has already
      // decided for the user; leaving them an ordinary incoming call they
      // can still pick up is strictly better than ending a call they won.
      return
    }

    // Re-read after the await, which the Rust never had to do: its provider
    // was a synchronous trait and this one is a promise. In the time an
    // answer takes to generate, the caller can hang up, the invite can
    // expire, and a second call can start ringing -- and answering *that*
    // one with an answer built from the first one's offer is precisely what
    // this comparison exists to refuse.
    const state = machine.state()
    if (state.call !== 'incomingInvite' || state.callId !== callId) return

    try {
      deliver(
        pump((held, nowMs) => held.accept(config.ownPartyId, answer, nowMs)),
        depth + 1,
      )
    } catch {
      // The invite expired in the instant between that check and this
      // accept. The machine has already ended itself, and `accept`'s
      // throwing path emits no `stateChanged`, so the ending is announced
      // here or nowhere -- and a screen left on a ringing call it can never
      // answer is the defect that would follow from nowhere.
      announce({ act: 'stateChanged', state: machine.state() })
    }
  }

  /** Starts the single drain, if one is not already running. */
  function startDraining(): void {
    if (draining || outbox.length === 0) return
    draining = true
    track(drainOutbox())
  }

  /**
   * Empties the outbox, one event at a time, in order.
   *
   * One consumer and one loop. A failure fed back to the machine queues more
   * events -- a `sendFailed` ending emits none, but the pump it runs through
   * is the same one -- and `startDraining` sees `draining` still true and
   * declines to start a second loop, so this one picks them up.
   */
  async function drainOutbox(): Promise<void> {
    try {
      for (
        let next = outbox.shift();
        next !== undefined;
        next = outbox.shift()
      ) {
        try {
          await ports.send(next)
        } catch {
          // The wire refused it. The trace is somebody else's; this is for
          // the user, and only for the two kinds whose loss strands the
          // call. The call id is the *lost event's*, not whichever call the
          // machine has reached by now: a send resolves long after the
          // gesture that queued it, and by then the user may have cancelled
          // that call and placed another.
          if (endsCallWhenLost(next)) {
            const lost = next
            drive(held => held.sendFailed(callIdOf(lost)))
          }
        }
      }
    } finally {
      draining = false
    }
  }

  /**
   * Runs a batch for one of the two doors the environment drives.
   *
   * A sync tick and a timer have nobody to catch for them: a throw out of
   * either lands in the sync loop, whose only answer to an exception is to
   * call the connection lost and back off. The local intents deliberately do
   * not come through here -- a refused gesture must reach the person who
   * made it.
   */
  function safely(run: () => void): void {
    try {
      run()
    } catch {
      // Deliberately swallowed. Nothing on these two paths has a caller who
      // could act on it, and the machine's own contract is that a surprising
      // remote event is a race rather than a fault.
    }
  }

  function placeCall(offer: SessionDescription): string {
    const callId = ports.newCallId()
    drive((held, nowMs) =>
      held.placeCall(callId, config.ownPartyId, offer, nowMs),
    )
    return callId
  }

  function accept(answer: SessionDescription): void {
    drive((held, nowMs) => held.accept(config.ownPartyId, answer, nowMs))
  }

  function reject(): void {
    drive((held, nowMs) => held.reject(config.ownPartyId, nowMs))
  }

  function hangup(reason: SentHangupReason): void {
    drive((held, nowMs) => held.hangup(reason, nowMs))
  }

  /**
   * The peer left the room, and there is a call to end.
   *
   * Fed as a *received* hangup through the same door a real one takes, so
   * the machine's own rules -- which call it belongs to, whether the sender
   * is a party to it, whether media had started -- apply unchanged, and the
   * ending an observer sees is the ending it already knows how to draw.
   *
   * No `party_id`: the leaver sent none, and inventing one would put a
   * fabricated party on the wire from inside this device. No `reason`
   * either, because an absent one reads as `user_hangup`, which is exactly
   * what a silent departure means.
   */
  function onPeerLeft(): void {
    const callId = activeCallId(machine.state())
    // A departure while idle is an ordinary membership change.
    if (callId === undefined) return
    const hangupFromPeer: IncomingCallEvent = {
      sender: config.peerUserId,
      event: {
        type: 'm.call.hangup',
        content: { call_id: callId, version: VERSION_1 },
      },
      ageMs: 0,
    }
    drive((held, nowMs) => held.handleEvent(hangupFromPeer, nowMs))
  }

  /**
   * This account left the room -- this device, or another of it; the
   * membership event does not distinguish them and neither does the outcome.
   *
   * **The specification is silent here**: "Behaviour on Room Leave" covers
   * only the peer leaving. So this is the product's reading, stated rather
   * than assumed: a call without a room cannot continue, so the departure is
   * fed as the *local intent* to end it -- a hangup where one is legal, a
   * reject while still ringing. The event it sends will very likely be
   * refused by a room this account has already left, which is the outbox's
   * ordinary business; the ending is what a screen needs.
   */
  function onOwnLeft(): void {
    const here = machine.state().call
    if (here === 'idle' || here === 'ended') return
    if (here === 'incomingInvite') reject()
    else hangup('user_hangup')
  }

  function receive(rawEvents: readonly unknown[]): void {
    for (const raw of rawEvents) {
      // Guarded one at a time. An event this build cannot make sense of must
      // not cost the next one, and the next one may be the hangup that ends
      // a call still on somebody's screen.
      safely(() => {
        const departed = membershipLeaveOf(raw)
        if (departed !== undefined) {
          if (departed === config.peerUserId) onPeerLeft()
          else if (departed === config.ownUserId) onOwnLeft()
          return
        }
        const incoming = incomingCallEventOf(raw)
        if (incoming === undefined) return
        drive((held, nowMs) => held.handleEvent(incoming, nowMs))
      })
    }
  }

  function tick(): void {
    safely(() => {
      drive((held, nowMs) => held.tick(nowMs))
    })
  }

  let stopTicking: (() => void) | undefined = ports.repeat(TICK_PERIOD_MS, tick)

  return {
    state: () => machine.state(),
    placeCall,
    accept,
    reject,
    hangup,
    sendCandidates: candidates => {
      drive((held, nowMs) => held.sendCandidates(candidates, nowMs))
    },
    mediaConnected: () => {
      drive((held, nowMs) => held.mediaConnected(nowMs))
    },
    mediaDisconnected: () => {
      drive((held, nowMs) => held.mediaDisconnected(nowMs))
    },
    mediaReconnected: () => {
      drive((held, nowMs) => held.mediaReconnected(nowMs))
    },
    mediaFailed: reason => {
      drive((held, nowMs) => held.mediaFailed(reason, nowMs))
    },
    requestNegotiation: description => {
      drive((held, nowMs) => held.requestNegotiation(description, nowMs))
    },
    answerNegotiation: description => {
      drive((held, nowMs) => held.answerNegotiation(description, nowMs))
    },
    receive,
    tick,
    stop: () => {
      // Idempotent: a teardown that runs twice must not stop a timer the
      // caller has since started for something else.
      stopTicking?.()
      stopTicking = undefined
    },
    settled: async () => {
      let seen: Promise<void> | undefined
      while (seen !== quiet) {
        seen = quiet
        await seen
      }
    },
  }
}

/** Which call the machine is on, if it is on one. */
function activeCallId(state: CallState): string | undefined {
  switch (state.call) {
    case 'idle':
    case 'ended':
      return undefined
    // A call counting its reconnection window down is still a call, and a
    // peer who left the room has ended it whatever the media layer believes.
    default:
      return state.callId
  }
}

/**
 * `unsigned.age` in milliseconds, and zero for everything it is not.
 *
 * **Clamped at zero**, which is the only reason this is a function rather
 * than a field read. The field is signed and goes negative when the two
 * clocks disagree; the liveness rule has no use for a negative age -- an
 * event from the future is at worst fresh -- and letting one through would
 * extend an invite past the lifetime its sender granted it, which is the one
 * thing the age field exists to prevent.
 */
function ageOf(unsigned: unknown): number {
  const age = asObject(unsigned)?.age
  return typeof age === 'number' && Number.isFinite(age) ? Math.max(0, age) : 0
}

/**
 * `null` for anything that is not a plain object, arrays included.
 *
 * Every read below walks a path a homeserver, or a peer running another
 * client, could have sent differently. A walk that assumed the shape would
 * turn a strange event into a crash inside the sync loop rather than an
 * event nobody could read.
 */
function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

/**
 * The `version` as the machine must read it.
 *
 * Absent, or of a type the protocol has no use for, reads as version 1. That
 * is the specification's own lenient rule -- "if clients see events with
 * version other than 0 or "1" [...] they should treat these the same as if
 * they had version == "1"" -- and it is safe here for the sharper reason
 * `wire.ts` gives: only the *numeric* zero means version 0, and a missing
 * field is certainly not that.
 */
function versionOf(value: unknown): VoipVersion {
  return typeof value === 'number' || typeof value === 'string'
    ? value
    : VERSION_1
}

/** A session description, or nothing if either half of it is missing. */
function sessionDescriptionOf(value: unknown): SessionDescription | undefined {
  const held = asObject(value)
  if (held === undefined) return undefined
  const { type, sdp } = held
  return typeof type === 'string' && typeof sdp === 'string'
    ? { type, sdp }
    : undefined
}

/**
 * The candidate list, or nothing if any entry of it is malformed.
 *
 * All or nothing rather than the readable ones: a partial list is a call
 * that connects over a worse path, or does not connect at all, with nothing
 * anywhere saying why. The two optional fields are the specification's own
 * optionality -- "at least one of `sdpMid` or `sdpMLineIndex` is required,
 * unless `candidate` is empty" -- and an empty `candidate` is the version-1
 * end-of-candidates marker, so neither can be insisted on here.
 */
function candidatesOf(value: unknown): readonly Candidate[] | undefined {
  if (!Array.isArray(value)) return undefined
  const read: Candidate[] = []
  for (const entry of value) {
    const held = asObject(entry)
    if (held === undefined || typeof held.candidate !== 'string') {
      return undefined
    }
    const sdpMid =
      typeof held.sdpMid === 'string' ? { sdpMid: held.sdpMid } : {}
    const sdpMLineIndex =
      typeof held.sdpMLineIndex === 'number'
        ? { sdpMLineIndex: held.sdpMLineIndex }
        : {}
    read.push({ candidate: held.candidate, ...sdpMid, ...sdpMLineIndex })
  }
  return read
}

/**
 * One event type and content as a `CallEvent`, or nothing.
 *
 * The per-kind checks are the fields the machine's rules are actually made
 * of, and each omission below has a consequence worth the line. The invite's
 * `lifetime` is the sharpest: read as `undefined` it compares false against
 * every age, so a dead invite would ring, and the call would then expire at
 * `now + NaN`, which is never. Defaulting it would be a parser inventing the
 * one number the liveness rule is built from, so it is refused instead.
 */
function callEventOf(type: string, rawContent: unknown): CallEvent | undefined {
  const content = asObject(rawContent)
  if (content === undefined) return undefined
  const callId = content.call_id
  if (typeof callId !== 'string') return undefined
  const version = versionOf(content.version)
  const partyId =
    typeof content.party_id === 'string' ? content.party_id : undefined
  const lifetime =
    typeof content.lifetime === 'number' && Number.isFinite(content.lifetime)
      ? content.lifetime
      : undefined

  switch (type) {
    case 'm.call.invite': {
      const offer = sessionDescriptionOf(content.offer)
      if (offer === undefined || lifetime === undefined) return undefined
      const invitee =
        typeof content.invitee === 'string' ? content.invitee : undefined
      return {
        type,
        content: {
          call_id: callId,
          party_id: partyId,
          lifetime,
          offer,
          version,
          invitee,
        },
      }
    }
    case 'm.call.answer': {
      const answer = sessionDescriptionOf(content.answer)
      if (answer === undefined) return undefined
      return {
        type,
        content: { call_id: callId, party_id: partyId, answer, version },
      }
    }
    case 'm.call.candidates': {
      const candidates = candidatesOf(content.candidates)
      if (candidates === undefined) return undefined
      return {
        type,
        content: { call_id: callId, party_id: partyId, candidates, version },
      }
    }
    case 'm.call.select_answer': {
      // Both party ids are required, and the machine compares the selected
      // one against its own to decide whether this device keeps the call.
      // A select_answer naming nobody would end whichever device read it.
      const selected = content.selected_party_id
      if (partyId === undefined || typeof selected !== 'string') {
        return undefined
      }
      return {
        type,
        content: {
          call_id: callId,
          party_id: partyId,
          selected_party_id: selected,
          version,
        },
      }
    }
    case 'm.call.reject': {
      // "The reject has a party_id just like an answer", and the caller
      // sends a select_answer for it. One without is a refusal nothing can
      // be selected for.
      if (partyId === undefined) return undefined
      return { type, content: { call_id: callId, party_id: partyId, version } }
    }
    case 'm.call.negotiate': {
      const description = sessionDescriptionOf(content.description)
      if (
        partyId === undefined ||
        lifetime === undefined ||
        description === undefined
      ) {
        return undefined
      }
      return {
        type,
        content: {
          call_id: callId,
          party_id: partyId,
          lifetime,
          description,
          version,
        },
      }
    }
    case 'm.call.hangup': {
      // The loosest of the seven on purpose. A hangup ends a call, and
      // refusing one over a field it did not have to carry would leave a
      // call on a screen after the peer had gone. `party_id` is absent from
      // a version-0 hangup, and `reason` is optional in every version.
      const reason =
        typeof content.reason === 'string' ? content.reason : undefined
      return {
        type,
        content: { call_id: callId, party_id: partyId, version, reason },
      }
    }
    default:
      return undefined
  }
}
