/**
 * The 1:1 call signalling state machine.
 *
 * The protocol brain of a legacy `m.call.*` call -- the "Voice over IP"
 * module of the Matrix Client-Server specification,
 * <https://spec.matrix.org/latest/client-server-api/#voice-over-ip> --
 * written as deterministic logic: typed events and an injected clock go in,
 * a list of protocol actions comes out.
 *
 * # It holds no clock, no randomness and no I/O, and that is the whole design
 *
 * Every method takes `nowMs`. Call and party identifiers are handed in as
 * parameters rather than drawn here. Nothing in this file reaches a network,
 * a store or `Date.now()`.
 *
 * That is not tidiness. It is what lets `machine.spec.ts` replay a hundred
 * scenarios exactly -- glare, a sibling device answering first, an invite
 * that expires between being displayed and being accepted, a connection lost
 * for nineteen seconds and recovered -- none of which can be produced on
 * demand on a device. A version of this that called `Date.now()` would be
 * shorter by four parameters and would have no test suite worth the name, so
 * the parameters stay.
 *
 * # What it is not
 *
 * - **Not media-aware.** SDP is carried, never inspected. Applying a
 *   description, gathering ICE, opening a microphone: all of that belongs to
 *   a WebRTC layer this file names nowhere. The machine emits
 *   `startMedia` / `stopMedia` / `remoteAnswer` / `remoteCandidates` and
 *   tracks the protocol state.
 * - **Not a transport.** Nothing here touches a room. A transport consumes
 *   the `send` actions, puts `event.content` in the room under `event.type`,
 *   feeds received events back as `IncomingCallEvent`s, and drives `tick`.
 * - **Not wired to a screen.** The projection `state()` returns is what a
 *   screen draws; connecting it is another increment's work.
 *
 * # Version 1, on everything sent
 *
 * `wire.ts` carries the argument. In one line: version 1 is the version
 * with `party_id`, `m.call.select_answer` and `m.call.reject`, which is what
 * an account with several devices needs, and received version-0 events are
 * accepted leniently rather than refused.
 *
 * # Two obligations this machine deliberately does not discharge
 *
 * **Glare auto-accept.** When the tie-break says the incoming call wins, the
 * specification says "the client should accept this call on behalf of the
 * user". The machine cannot: accepting needs an answer SDP, and an answer
 * SDP is media work. So it raises the flag -- `incomingInvite.autoAccept` --
 * and a transport discharges the obligation by drawing an answer and calling
 * `accept` without ringing. A transport whose media layer fails there should
 * leave the call ringing rather than end it: degraded to an ordinary
 * incoming call, which a person can still answer.
 *
 * **Behaviour on room leave.** "If the client sees the user it is in a call
 * with leave the room, the client should treat this as a hangup event for
 * any calls that are in progress." A membership change is an `m.room.member`
 * event, not an `m.call.*` one, so this machine never sees it and cannot:
 * its whole input is the seven call event types. The debt is recorded here
 * because here is where it was incurred -- a transport must watch the peer's
 * membership and synthesise a hangup from the peer for the active call. The
 * specification's other sentence about a leave, "the client may wish to
 * treat it as a rejection", gets the same treatment and not its own: a
 * synthesised *reject* would have to invent a `party_id` for a device that
 * never answered, and the caller would then put a `select_answer` for that
 * invented party on the wire.
 */

import {
  answerEvent,
  answerEventVersionZero,
  callIdOf,
  candidatesEvent,
  hangupEvent,
  hangupEventVersionZero,
  hangupReasonOf,
  inviteEvent,
  isVersionZero,
  negotiateEvent,
  partyIdOf,
  rejectEvent,
  selectAnswerEvent,
  type CallAnswerContent,
  type CallCandidatesContent,
  type CallEvent,
  type CallHangupContent,
  type CallInviteContent,
  type CallNegotiateContent,
  type CallRejectContent,
  type CallSelectAnswerContent,
  type Candidate,
  type SentHangupReason,
  type SessionDescription,
  type VoipVersion,
} from './wire'

/**
 * The lifetime stamped on the invites this machine sends, in milliseconds.
 *
 * The specification makes `lifetime` required on `m.call.invite` and
 * recommends a floor rather than a default: "The minimal recommended
 * lifetime is 90 seconds - this should give the user enough time to actually
 * pick up the call."
 * (<https://spec.matrix.org/latest/client-server-api/#call-event-liveness>)
 * Anything shorter is a telephone that stops ringing while somebody is
 * walking to it.
 */
export const DEFAULT_INVITE_LIFETIME_MS = 90_000

/**
 * The lifetime stamped on the `m.call.negotiate` offers this machine sends.
 *
 * The specification gives no recommendation here; ten seconds is the value
 * its own example uses, and a renegotiation unanswered within it is, by that
 * same paragraph, failed: "after which the sender of the negotiate event
 * should consider the negotiation failed (timed out) and the recipient
 * should ignore it."
 */
export const DEFAULT_NEGOTIATE_LIFETIME_MS = 10_000

/**
 * How long a call may sit in `connecting` before the machine gives up on it.
 *
 * Thirty seconds is a product decision, not a derived constant, and it is
 * written here rather than left as a literal because a number whose
 * provenance is unrecorded is a number a later reader tunes on a hunch. The
 * reasoning: ICE resolves in seconds when it resolves at all, so thirty is a
 * wide margin that still does not leave somebody in front of a screen that
 * is lying to them.
 *
 * **It is not an ICE timeout.** The media layer runs its own and reports
 * through `mediaFailed`. This is the backstop for the media layer reporting
 * *nothing at all*: an agent still fruitlessly checking, a wedged engine, a
 * shell that dropped a callback. Without it, `connecting` has no deadline of
 * any kind and such a call stays on the screen until the process dies.
 *
 * `inCall` deliberately gets no equivalent: an established call that goes
 * quiet is ICE's business, and a counter there would end healthy calls on a
 * brief network hiccup.
 */
export const DEFAULT_CONNECT_TIMEOUT_MS = 30_000

/**
 * How long a call that *was* up may stay disconnected before the machine
 * gives up on it -- the reconnection window.
 *
 * Twenty seconds, and this revises the paragraph above rather than extending
 * it. "`inCall` gets no equivalent" still holds for the state itself:
 * nothing counts from the moment a call comes up. What this adds is a
 * deadline armed by an *event* -- the media layer reporting the connection
 * lost -- and cleared by its opposite. A call that never loses its
 * connection never carries this deadline at all.
 *
 * The product decision it implements: show that the connection was lost, as
 * the other messengers do; run a visible countdown during which reconnection
 * is attempted; end the call only when it expires. "Fifteen or twenty" was
 * the brief and the longer was taken, so a recovery has a real chance before
 * the call is torn down.
 *
 * **Why this one ends as `ice_timeout` and the one above as `ice_failed`.**
 * The specification splits the two by whether media *ever flowed*, not by
 * whether the ending was a timeout: `ice_timeout` is documented as "The
 * connection failed after some media was exchanged". This deadline can only
 * be armed from `inCall`, which is reached only through `mediaConnected`, so
 * media flowed by construction. A screen renders the two apart -- one is
 * "the connection could not be established", the other "the connection was
 * interrupted" -- so the wrong one here puts a sentence on a screen that
 * describes something which never happened.
 */
export const DEFAULT_RECONNECT_WINDOW_MS = 20_000

/**
 * Everything the machine knows about its environment, fixed at construction.
 *
 * **One machine per 1:1 conversation, one call at a time.** Calls in this
 * product are placed to an encrypted room with one known peer -- the
 * specification's own security consideration, "Calls should only be placed
 * to rooms with one other user in them" -- so the peer's identity is
 * configuration, not something an event can surprise the machine with. Every
 * handler below leans on that: an invite from a third member of the room
 * never rings, because the ringing screen has no caller identity to draw and
 * would draw the peer's.
 */
export interface CallConfig {
  /**
   * The account this device is logged in as.
   *
   * Used to recognise the remote echo of one's own events, and the answers
   * and rejects of one's own *other* devices -- "since a user may call
   * themselves, they cannot simply ignore events from their own user"
   * (specification, Party Identifiers).
   */
  readonly ownUserId: string
  /**
   * The other member of the conversation. Stamped as the `invitee` of every
   * invite sent: "The invitee field should be added whenever the call is
   * intended for one specific user."
   */
  readonly peerUserId: string
  /** See `DEFAULT_INVITE_LIFETIME_MS`. */
  readonly inviteLifetimeMs: number
  /** See `DEFAULT_NEGOTIATE_LIFETIME_MS`. */
  readonly negotiateLifetimeMs: number
  /** See `DEFAULT_CONNECT_TIMEOUT_MS`. */
  readonly connectTimeoutMs: number
  /**
   * See `DEFAULT_RECONNECT_WINDOW_MS`. Distinct from `connectTimeoutMs` in
   * what arms it, in what clears it and in the wire reason it ends with; the
   * two never share a field.
   */
  readonly reconnectWindowMs: number
}

/** A configuration with the four durations at their documented values. */
export function callConfig(ownUserId: string, peerUserId: string): CallConfig {
  return {
    ownUserId,
    peerUserId,
    inviteLifetimeMs: DEFAULT_INVITE_LIFETIME_MS,
    negotiateLifetimeMs: DEFAULT_NEGOTIATE_LIFETIME_MS,
    connectTimeoutMs: DEFAULT_CONNECT_TIMEOUT_MS,
    reconnectWindowMs: DEFAULT_RECONNECT_WINDOW_MS,
  }
}

/**
 * Why a call ended.
 *
 * Distinct from the wire's hangup reason because half of the endings in this
 * protocol never travel in a `reason` field: a reject has none by design, an
 * expiry sends `invite_timeout` on the caller side only, and "answered
 * elsewhere" is told by a `select_answer` rather than by a hangup.
 */
export type EndReason =
  /**
   * An `m.call.hangup` settled the call, sent or received, and this is the
   * wire reason it carried. A hangup that carried none lands here as
   * `user_hangup`, which is what the specification says a missing value
   * means.
   */
  | { readonly ended: 'hangup'; readonly reason: string }
  /**
   * Refused by `m.call.reject`, sent or received. The event has no reason
   * field: "the rejection of a call is always implicitly because the user
   * chose not to answer it."
   */
  | { readonly ended: 'rejected' }
  /**
   * The invite's lifetime ran out before anybody answered. On the caller
   * side a hangup with wire reason `invite_timeout` goes out with it; on the
   * callee side nothing is sent -- "clients should discard it".
   */
  | { readonly ended: 'inviteExpired' }
  /**
   * Another device of the *same* account took the call. Learned from a
   * sibling's answer, or from a `select_answer` naming a party that is not
   * this device: "it ends the call and informs the user the call was
   * answered elsewhere. It does not send any events."
   */
  | { readonly ended: 'answeredElsewhere' }
  /** Another device of the same account refused: "This rejects the call on all devices." */
  | { readonly ended: 'rejectedElsewhere' }
  /**
   * A protocol event of *ours* could not be put on the wire.
   *
   * The distinction this exists for: an invite that never left the device
   * ends here, immediately, while an invite that reached the peer and went
   * unanswered ends as a hangup with `invite_timeout` ninety seconds later.
   * "We could not reach them" and "they did not pick up" are two different
   * sentences on a screen, and a shell that cannot tell them apart shows the
   * second while the first is what happened. Fed only by `sendFailed`.
   */
  | { readonly ended: 'sendFailed' }

/**
 * The state as an observer needs it. The machine's internal state is richer;
 * this is the projection a screen is drawn from.
 */
export type CallState =
  /** No call. The machine starts here and never returns by itself. */
  | { readonly call: 'idle' }
  /** We sent an invite and are waiting for an answer, a reject, or the lifetime. */
  | { readonly call: 'outgoingInvite'; readonly callId: string }
  /**
   * We received an invite and the local user has not decided.
   *
   * `autoAccept` is the glare marker: true when this invite won the
   * tie-break against our own outgoing one. The obligation it carries is
   * discharged by the transport, not here -- see the module header.
   *
   * `offer` is the invite's own SDP, carried *in the state*. It is the only
   * way a media layer can ever build the answer: `createAnswer` takes a
   * remote description, and nothing else carries one to the callee. The
   * predecessor of this module dropped it from the projection for a while
   * and no call could be answered at all, which is why it is here and why
   * this paragraph is here with it.
   */
  | {
      readonly call: 'incomingInvite'
      readonly callId: string
      readonly autoAccept: boolean
      readonly offer: SessionDescription
    }
  /**
   * The answer has been exchanged -- sent by us as callee, or received and
   * selected by us as caller. ICE is the media layer's problem from here;
   * the protocol waits for `mediaConnected` or `mediaFailed`.
   */
  | { readonly call: 'connecting'; readonly callId: string }
  /** Media reported the connection up. */
  | { readonly call: 'inCall'; readonly callId: string }
  /**
   * Media reported the connection lost on a call that was up, and the
   * reconnection window is running.
   *
   * `secondsLeft` is what a screen draws, counted down by the machine rather
   * than by a shell: a countdown is a threshold made visible, and thresholds
   * live here. It is a stored value refreshed by `tick`, not a computation
   * on a clock -- this projection takes none, and a projection that needed
   * one would be a second clock in a machine built to have exactly one.
   *
   * The call is still a call: the protocol state underneath is `inCall`,
   * every gesture keeps working, and `mediaReconnected` puts it back with
   * nothing lost.
   */
  | {
      readonly call: 'reconnecting'
      readonly callId: string
      readonly secondsLeft: number
    }
  /** Terminal for *this* call. A further invite, or `placeCall`, starts a new one. */
  | { readonly call: 'ended'; readonly reason: EndReason }

/**
 * What the machine asks its environment to do.
 *
 * A transport consumes `send`; a media layer consumes the rest bar
 * `stateChanged`, which is for whoever draws.
 */
export type CallAction =
  /**
   * Put this event in the room.
   *
   * One action for all seven kinds, carrying the wire event whole, rather
   * than seven near-identical variants. What a transport does with an
   * `m.call.hangup` and an `m.call.answer` is the same thing, and the two
   * questions anybody actually asks -- "how many events did this batch put
   * on the wire" and "does losing *this* one strand the call" -- are a count
   * and a check on `event.type`.
   */
  | { readonly act: 'send'; readonly event: CallEvent }
  /**
   * The callee's answer SDP, for the media layer to apply. Emitted by the
   * caller on accepting an answer. The caller's offer reaches the callee's
   * media layer through the invite itself, carried in the state.
   */
  | { readonly act: 'remoteAnswer'; readonly answer: SessionDescription }
  /**
   * Remote ICE candidates, for the media layer.
   *
   * The machine buffers candidates that arrive before the call they belong
   * to is usable -- a callee can receive them while still ringing, a caller
   * can receive them from several answering devices before selecting one --
   * and emits them once the relevant party is known. The specification does
   * not order candidate delivery beyond "sent by callers after sending an
   * invite and by the callee after answering", so buffering early ones
   * violates nothing, and losing them would break connectivity.
   */
  | {
      readonly act: 'remoteCandidates'
      readonly partyId?: string
      readonly candidates: readonly Candidate[]
    }
  /**
   * The peer offered a renegotiation. The media layer must produce an answer
   * SDP and hand it back through `answerNegotiation`: "Once an
   * m.call.negotiate event is received, the client must respond with another
   * m.call.negotiate event, with the SDP answer".
   */
  | {
      readonly act: 'remoteRenegotiationOffer'
      readonly description: SessionDescription
    }
  /**
   * The peer answered *our* renegotiation offer; the media layer applies the
   * description. Emitted only while one of our offers is in flight.
   */
  | {
      readonly act: 'applyRenegotiationAnswer'
      readonly description: SessionDescription
    }
  /**
   * Our renegotiation offer outlived its lifetime unanswered. **The call
   * survives** -- this is not an ending.
   */
  | { readonly act: 'negotiationTimedOut' }
  /**
   * Media layer: start ICE and capture. Emitted once the offer/answer pair
   * is complete -- answer sent, or answer received and selected.
   */
  | { readonly act: 'startMedia' }
  /** Media layer: tear down. Emitted on every ending that follows `startMedia`. */
  | { readonly act: 'stopMedia' }
  | { readonly act: 'stateChanged'; readonly state: CallState }

/** One `m.call.*` event as a transport delivers it. */
export interface IncomingCallEvent {
  /**
   * Who sent it. Compared against `ownUserId` for echo detection and for
   * recognising one's own other devices.
   */
  readonly sender: string
  readonly event: CallEvent
  /**
   * The event's `unsigned.age` from the sync response, in milliseconds; zero
   * when it arrived live.
   *
   * The liveness rule needs it: "When a client receives an invite, it should
   * use the event's age field in the GET /sync response plus the time since
   * it received the event from the homeserver to determine whether the
   * invite is still valid. The use of the age field ensures that incorrect
   * clocks on client devices don't break calls."
   */
  readonly ageMs: number
}

/**
 * A local intent the machine cannot honour in its current state.
 *
 * **Only intents throw.** A remote event in a wrong state is not an error:
 * network races are the normal case in this protocol -- an answer landing
 * after the invite expired, a reject landing after an answer -- so those are
 * ignored, never reported. Nor do the media layer's *reports* throw; see
 * `mediaDisconnected`.
 *
 * A local decision the machine silently swallowed, on the other hand, would
 * hang a screen: somebody presses answer and nothing happens, for ever. So
 * this is thrown rather than returned, which also keeps every intent's happy
 * path returning `CallAction[]` directly.
 */
export class CallError extends Error {
  constructor(
    readonly kind: 'wrongState' | 'inviteExpired' | 'negotiationPending',
    /** The intent that was refused. Absent when the state is not what refused it. */
    readonly action: string | undefined,
    message: string,
  ) {
    super(message)
    this.name = 'CallError'
  }
}

function wrongState(action: string, state: string): CallError {
  return new CallError(
    'wrongState',
    action,
    `${action} is not allowed while the call machine is ${state}`,
  )
}

/** Candidates from one answering device, held until that device is chosen. */
interface HeldCandidates {
  readonly partyId?: string
  readonly candidates: readonly Candidate[]
}

/** What we are waiting for while an invite of ours is out. */
interface OutgoingContext {
  readonly callId: string
  readonly partyId: string
  readonly expiresAtMs: number
  /**
   * Candidates sent by answering devices before we have selected one, kept
   * with the party that sent them. Only the selected party's are flushed.
   */
  readonly pendingCandidates: HeldCandidates[]
}

/** What we know while an invite of the peer's is ringing. */
interface IncomingContext {
  readonly callId: string
  readonly callerUserId: string
  /** Absent for a version-0 caller. */
  readonly callerPartyId?: string
  /**
   * The invite's own `version`, because it decides what we may answer with:
   * a version-0 caller cannot parse an `m.call.reject`, and would not read a
   * `party_id` on an answer.
   */
  readonly version: VoipVersion
  /** The caller's offer -- see `CallState`'s `incomingInvite`. */
  readonly offer: SessionDescription
  readonly expiresAtMs: number
  readonly autoAccept: boolean
  /** Candidates the caller sent while we were still ringing. */
  readonly bufferedCandidates: Candidate[]
}

/** The countdown a screen draws, and the deadline it is drawn from. */
interface ReconnectWindow {
  /** When the call stops being allowed to sit disconnected. */
  readonly deadlineMs: number
  /**
   * What the screen draws, refreshed by `tick`. Held rather than computed
   * because `state()` takes no clock.
   */
  secondsLeft: number
}

/** The active call: `connecting` and `inCall`. */
interface CallContext {
  readonly callId: string
  readonly ownPartyId: string
  readonly remoteUserId: string
  readonly remotePartyId?: string
  /**
   * Which side of the established call this device is.
   *
   * The callee is always the polite party of WebRTC perfect negotiation
   * ("The callee is always the polite party", specification, Politeness);
   * the glare winner becomes the callee and is therefore polite, "if a
   * client discards its outbound call in favour of an inbound call, it
   * becomes the polite party". The machine reads it to decide whose
   * `select_answer` applies to it; the SDP-level consequences are the media
   * layer's.
   */
  readonly role: 'caller' | 'callee'
  /**
   * "If both the invite event and the accepted answer event have version
   * equal to "1", either party may send m.call.negotiate". Computed once at
   * the transition into `connecting`; this machine's own invite is always
   * version 1, so the answer's version -- or, on the callee side, the
   * invite's -- is the decider.
   */
  readonly negotiationAllowed: boolean
  /**
   * When our `m.call.negotiate` offer stops being answerable, and by its
   * presence, that one is in flight at all.
   *
   * One field and not two: "an offer is pending" and "it expires then" are
   * the same fact, and holding them apart would make a pending offer with no
   * deadline representable.
   */
  pendingOutNegotiationMs?: number
  /** The same, for the peer's offer awaiting *our* answer. */
  pendingInNegotiationMs?: number
  /**
   * When this call stops being allowed to sit in `connecting`.
   *
   * Armed at both doors into that state -- the callee's `accept` and the
   * caller's received answer -- and cleared by `mediaConnected`, so it is
   * set exactly while it applies. `inCall` carries none by construction
   * rather than by a rule somebody has to remember.
   */
  connectDeadlineMs?: number
  /**
   * The reconnection window, present exactly while it runs. Armed by
   * `mediaDisconnected` from `inCall` only, cleared by `mediaReconnected`,
   * read by `tick` and by `state()`.
   */
  reconnect?: ReconnectWindow
}

type InternalState =
  | { readonly at: 'idle' }
  | { readonly at: 'outgoingInvite'; readonly ctx: OutgoingContext }
  | { readonly at: 'incomingInvite'; readonly ctx: IncomingContext }
  | { readonly at: 'connecting'; readonly ctx: CallContext }
  | { readonly at: 'inCall'; readonly ctx: CallContext }
  | { readonly at: 'ended'; readonly reason: EndReason }

/**
 * The countdown a screen draws, from the milliseconds left.
 *
 * Rounded up, so the first number is the whole window and the last is 1. The
 * floor would open on 19 for a twenty-second window, which is a lie about
 * how long is left, and would then sit on 0 for the final second.
 */
function secondsLeftOf(remainingMs: number): number {
  return Math.ceil(Math.max(0, remainingMs) / 1000)
}

/** The machine. Deterministic: every method takes `nowMs`. */
export class CallMachine {
  private current: InternalState = { at: 'idle' }

  /**
   * The call that just ended. Events still arriving for it -- the protocol is
   * racy by design -- are noise, and are dropped before any dispatch.
   */
  private lastEndedCallId?: string

  constructor(private readonly config: CallConfig) {}

  /** The observer projection of the state. */
  state(): CallState {
    const here = this.current
    switch (here.at) {
      case 'idle':
        return { call: 'idle' }
      case 'outgoingInvite':
        return { call: 'outgoingInvite', callId: here.ctx.callId }
      case 'incomingInvite':
        return {
          call: 'incomingInvite',
          callId: here.ctx.callId,
          autoAccept: here.ctx.autoAccept,
          offer: here.ctx.offer,
        }
      case 'connecting':
        return { call: 'connecting', callId: here.ctx.callId }
      case 'inCall':
        return here.ctx.reconnect === undefined
          ? { call: 'inCall', callId: here.ctx.callId }
          : {
              call: 'reconnecting',
              callId: here.ctx.callId,
              secondsLeft: here.ctx.reconnect.secondsLeft,
            }
      case 'ended':
        return { call: 'ended', reason: here.reason }
    }
  }

  /**
   * The offer of the invite currently ringing, if any.
   *
   * The transport's glare auto-accept needs it -- "the client should accept
   * this call on behalf of the user" requires an answer SDP, and an answer
   * SDP is built from this offer. So does the manual accept path's media
   * layer, for the same reason. It is also in the projection; this is the
   * reading for a caller that has no projection in hand.
   */
  pendingOffer(): SessionDescription | undefined {
    const here = this.current
    return here.at === 'incomingInvite' ? here.ctx.offer : undefined
  }

  // ── Local intents ──────────────────────────────────────────────────────

  /**
   * Place a call: emit the invite.
   *
   * The identifiers are parameters, not drawn here, for the reason the module
   * header gives -- a machine that draws cannot be replayed. The
   * specification asks only that a `party_id` be collision-proof ("8
   * uppercase + lowercase alphanumeric characters is recommended"); who
   * guarantees that is the caller.
   */
  placeCall(
    callId: string,
    partyId: string,
    offer: SessionDescription,
    nowMs: number,
  ): CallAction[] {
    if (this.current.at !== 'idle' && this.current.at !== 'ended') {
      throw wrongState('placeCall', this.stateName())
    }
    const event = inviteEvent(
      callId,
      partyId,
      this.config.inviteLifetimeMs,
      offer,
      this.config.peerUserId,
    )
    this.current = {
      at: 'outgoingInvite',
      ctx: {
        callId,
        partyId,
        expiresAtMs: nowMs + this.config.inviteLifetimeMs,
        pendingCandidates: [],
      },
    }
    return [{ act: 'send', event }, this.changed()]
  }

  /**
   * Accept the incoming call.
   *
   * The answer SDP comes from the media layer; the party id is this device's
   * own for the duration of the call ("Whenever a client first participates
   * in a new call, it generates a party_id for itself").
   */
  accept(
    partyId: string,
    answer: SessionDescription,
    nowMs: number,
  ): CallAction[] {
    const here = this.current
    if (here.at !== 'incomingInvite') {
      throw wrongState('accept', this.stateName())
    }
    const ctx = here.ctx
    // Strictly greater: the specification expires an invite when its age
    // "exceeds" the lifetime, so at exactly the lifetime it is still valid.
    // At millisecond granularity the difference is academic; the bound is the
    // specification's, so the comparison is too.
    if (nowMs > ctx.expiresAtMs) {
      // The user picked up too late. "Once the invite age exceeds this value,
      // clients should discard it" -- nothing is sent.
      this.end({ ended: 'inviteExpired' })
      throw new CallError('inviteExpired', 'accept', 'the invite has expired')
    }
    const legacy = isVersionZero(ctx.version)
    // Answer in the version the caller speaks: a version-0 invite gets a
    // version-0 answer, with no party id and no select_answer to expect.
    const actions: CallAction[] = [
      {
        act: 'send',
        event: legacy
          ? answerEventVersionZero(ctx.callId, answer)
          : answerEvent(ctx.callId, partyId, answer),
      },
    ]
    if (ctx.bufferedCandidates.length > 0) {
      actions.push({
        act: 'remoteCandidates',
        partyId: ctx.callerPartyId,
        candidates: ctx.bufferedCandidates,
      })
    }
    actions.push({ act: 'startMedia' })
    this.current = {
      at: 'connecting',
      ctx: {
        callId: ctx.callId,
        ownPartyId: partyId,
        remoteUserId: ctx.callerUserId,
        remotePartyId: ctx.callerPartyId,
        role: 'callee',
        negotiationAllowed: !legacy,
        connectDeadlineMs: nowMs + this.config.connectTimeoutMs,
      },
    }
    actions.push(this.changed())
    return actions
  }

  /**
   * Refuse the incoming call.
   *
   * Version 1 refuses with `m.call.reject`, never with a hangup: "If the
   * m.call.invite event has version "1", a client wishing to reject the call
   * sends an m.call.reject event." For a version-0 invite the same section
   * rules the other way, and `wire.ts` carries why.
   *
   * The reject carries the *rejecting* party's own id, like an answer would
   * ("The reject has a party_id just like an answer"), so the caller can send
   * its `select_answer` for it and every other device of the callee can
   * recognise the refusal as not its own. Like `accept` and `placeCall` the
   * id is a parameter: this device "first participates" in the call by
   * refusing it. It is unused on the version-0 path, which has no party ids
   * at all.
   */
  reject(partyId: string, _nowMs: number): CallAction[] {
    const here = this.current
    if (here.at !== 'incomingInvite') {
      throw wrongState('reject', this.stateName())
    }
    const ctx = here.ctx
    const event = isVersionZero(ctx.version)
      ? hangupEventVersionZero(ctx.callId)
      : rejectEvent(ctx.callId, partyId)
    this.end({ ended: 'rejected' })
    return [{ act: 'send', event }, this.changed()]
  }

  /**
   * End the call locally, with the wire reason to stamp.
   *
   * Valid from the moment the invite is *sent* -- "If the calling user
   * chooses to end the call before setup is complete, the client sends
   * m.call.hangup as previously" -- and while connecting or in call.
   * Refusing an *incoming* invite is `reject`, not this.
   */
  hangup(reason: SentHangupReason, _nowMs: number): CallAction[] {
    // The caller's microphone is open from the moment the invite goes out,
    // and this line used to say otherwise. `placeCall` emits no `startMedia`,
    // because in this machine's model media begins at the answer -- but
    // WebRTC cannot build an offer without a local audio track, so the
    // microphone opens when the offer is built, whatever this machine
    // believes. Measured on the predecessor of this application: a call
    // nobody answered left the record permission `running` three and a half
    // minutes after the screen said "no answer". Both endings of an
    // unanswered outgoing call therefore have to close it.
    //
    // A ringing *incoming* invite is the opposite case and keeps the opposite
    // answer: a callee builds no track until `accept`, which is what emits
    // `startMedia` -- and it is refused with `reject`, not here.
    const here = this.current
    const active = this.activeContext()
    const call =
      here.at === 'outgoingInvite'
        ? { callId: here.ctx.callId, partyId: here.ctx.partyId }
        : active !== undefined
          ? { callId: active.callId, partyId: active.ownPartyId }
          : undefined
    if (call === undefined) {
      throw wrongState('hangup', this.stateName())
    }
    const actions: CallAction[] = [
      { act: 'send', event: hangupEvent(call.callId, call.partyId, reason) },
      { act: 'stopMedia' },
    ]
    this.end({ ended: 'hangup', reason })
    actions.push(this.changed())
    return actions
  }

  /**
   * Send ICE candidates gathered by the media layer.
   *
   * Batching policy and the mandatory empty-string end-of-candidates marker
   * are the media layer's business (specification, ICE Candidate Batching);
   * the machine only stamps the identifiers. No state change: sending
   * candidates moves nothing.
   */
  sendCandidates(
    candidates: readonly Candidate[],
    _nowMs: number,
  ): CallAction[] {
    const here = this.current
    const active = this.activeContext()
    const call =
      here.at === 'outgoingInvite'
        ? { callId: here.ctx.callId, partyId: here.ctx.partyId }
        : active !== undefined
          ? { callId: active.callId, partyId: active.ownPartyId }
          : undefined
    if (call === undefined) {
      throw wrongState('sendCandidates', this.stateName())
    }
    return [
      {
        act: 'send',
        event: candidatesEvent(call.callId, call.partyId, candidates),
      },
    ]
  }

  /**
   * The media boundary reports ICE connected.
   *
   * `inCall` unlocks nothing protocol-wise that `connecting` did not already
   * allow: renegotiation is gated on the exchanged versions, not on media
   * state, and the accepted answer exists from `connecting` on.
   */
  mediaConnected(_nowMs: number): CallAction[] {
    const here = this.current
    if (here.at !== 'connecting') {
      throw wrongState('mediaConnected', this.stateName())
    }
    const ctx = here.ctx
    // The connection is up, so the deadline it was racing has no further
    // subject. Cleared here rather than merely ignored in `tick`, so that
    // "a call that is up carries no connect deadline" is a property of the
    // value and not a rule spread across two functions.
    ctx.connectDeadlineMs = undefined
    this.current = { at: 'inCall', ctx }
    return [this.changed()]
  }

  /**
   * The media boundary reports the connection lost on a call that *was* up:
   * arms the reconnection window and starts the countdown a screen draws.
   *
   * **Distinct from `mediaFailed`, which is terminal.** That one ends the
   * call; this one says the connection may yet come back, and gives it
   * `reconnectWindowMs` to do so.
   *
   * What the media layer must mean by it: WebRTC's ICE connection state
   * `disconnected`, which an agent enters when the selected candidate pair
   * stops receiving and leaves on its own the moment it receives again.
   * `failed` is the other report, and stays `mediaFailed`'s.
   *
   * **`connecting` is deliberately a no-op**, and that is the point of this
   * method's shape. That state already has a deadline -- thirty seconds --
   * and arming a twenty-second window beside it would silently shorten a
   * product decision to two thirds of itself, then end the call with
   * `ice_timeout` on a call where no media ever flowed.
   *
   * **Idempotent on purpose:** a WebRTC engine re-reports states it is
   * already in, and a second report that restarted the clock would let a
   * connection flapping once a second hold a dead call open for ever.
   *
   * **Neither report is ever an error**, and this window is what forced the
   * choice. `mediaConnected` and `mediaFailed` refuse a wrong state, because
   * each is an intent with a consequence. These two are reports: nothing is
   * refused by ignoring one and nothing is invented. The race that makes it
   * concrete is the one this window creates -- the expiry ends the call
   * *because* the media layer is unhappy, which is exactly when that layer is
   * emitting state changes, and a shell that routes a refusal to a technical
   * failure screen would replace the ending the reader was just shown with
   * "an unexpected technical error", on the one path this work exists to make
   * honest. So both return `CallAction[]` and neither throws.
   */
  mediaDisconnected(nowMs: number): CallAction[] {
    // Every state but `inCall`: a report about a call that is not there,
    // which is not news. `connecting` included, for the paragraph above.
    const here = this.current
    if (here.at !== 'inCall') return []
    const ctx = here.ctx
    if (ctx.reconnect !== undefined) return []
    ctx.reconnect = {
      deadlineMs: nowMs + this.config.reconnectWindowMs,
      secondsLeft: secondsLeftOf(this.config.reconnectWindowMs),
    }
    return [this.changed()]
  }

  /**
   * The media boundary reports the connection back on a call that had lost
   * it: clears the window and puts the call back exactly where it was.
   *
   * **Cleared, not ignored** -- the same discipline `mediaConnected` applies
   * to the connect deadline. The guard that matters is the one that does not
   * fire, and it can only be trusted if there is nothing left to fire with.
   *
   * Silent when no window is open, for `mediaDisconnected`'s reason: the
   * media layer re-reports, and news that changes nothing is not news.
   */
  mediaReconnected(_nowMs: number): CallAction[] {
    // `connecting` never carries a window, so there is nothing to clear
    // there either; a media layer reporting the *first* connection calls
    // `mediaConnected`.
    const here = this.current
    if (here.at !== 'inCall') return []
    const ctx = here.ctx
    if (ctx.reconnect === undefined) return []
    ctx.reconnect = undefined
    return [this.changed()]
  }

  /**
   * The media boundary reports a fatal failure.
   *
   * The reason is the media layer's knowledge, not the machine's: "a client
   * should be sure to send ice_timeout rather than ice_failed if media had
   * previously been received successfully" -- only the media layer knows
   * whether media ever flowed.
   */
  mediaFailed(reason: SentHangupReason, nowMs: number): CallAction[] {
    if (this.activeContext() === undefined) {
      throw wrongState('mediaFailed', this.stateName())
    }
    return this.hangup(reason, nowMs)
  }

  /**
   * The transport reports that putting one of *our* events on the wire
   * failed, for the call it names.
   *
   * Not an intent and not a remote event: it is the channel talking back,
   * which is why it takes no clock and cannot fail. There is no wrong state
   * for learning that a send did not happen -- only states where the news
   * changes nothing, and states where the call is over because the protocol
   * cannot proceed without the event that was lost.
   *
   * *Which* events warrant ending the call is the transport's decision; this
   * input trusts its caller. What the machine guarantees is the shape of the
   * ending: `sendFailed`, with `stopMedia` when media had started, so an
   * observer sees "the send failed" as a terminal state of its own rather
   * than as ninety seconds of silence indistinguishable from the peer not
   * answering.
   *
   * **The ambiguous race, named because it is real and accepted.** A send
   * error is this client's knowledge, not the server's state: the send can
   * fail *after* the homeserver persisted the event. Then the invite really
   * landed, the peer's answer can arrive first and move this machine to
   * `connecting`, and the late report still ends the call as `sendFailed`.
   * Rare, self-healing (the peer's side ends too, by hangup or its own
   * timeout), and still the right trade: a client that cannot confirm its
   * invite went out cannot trust any protocol state built on top of it, and a
   * call ended once too early is a smaller lie than a call connected on a
   * belief this device knows to be false.
   *
   * **Why the call id is a parameter and not a detail.** A send queue is
   * asynchronous by construction: it resolves a send long after the gesture
   * that queued it, and the user goes on using the telephone meanwhile. Every
   * step of `place A -> cancel A -> place B -> A's invite finally fails` is a
   * legitimate gesture, and a report that named no call would end B -- whose
   * own invite has not been attempted -- while the queue puts B's invite on
   * the wire anyway and the peer rings for ninety seconds on a call this side
   * has already called unreachable.
   *
   * This is not `lastEndedCallId`, which stays the one copy of its own rule.
   * That one drops *remote* events still arriving for a call the machine has
   * left. This asks a different question -- is the failure about the call the
   * machine is on *now* -- and a report for an older call is simply not this
   * call's news, whether or not that older call was the last to end.
   */
  sendFailed(callId: string): CallAction[] {
    const mediaStarted = this.activeContext() !== undefined
    const currentId = this.currentCallId()
    if (currentId === undefined || currentId !== callId) return []
    const actions: CallAction[] = mediaStarted ? [{ act: 'stopMedia' }] : []
    this.end({ ended: 'sendFailed' })
    actions.push(this.changed())
    return actions
  }

  /**
   * Offer a renegotiation -- the path a call takes to add video.
   *
   * Legal from `connecting` on: "If both the invite event and the accepted
   * answer event have version equal to "1", either party may send
   * m.call.negotiate", and the accepted answer exists as soon as the answer
   * is exchanged. A peer restarting ICE right after answering must not be
   * dropped. The version gate itself was computed at the transition.
   *
   * The SDP offer comes from the media layer; the machine tracks the protocol
   * state and the lifetime, nothing more.
   */
  requestNegotiation(
    description: SessionDescription,
    nowMs: number,
  ): CallAction[] {
    const ctx = this.activeContext()
    if (ctx === undefined) {
      throw wrongState('requestNegotiation', this.stateName())
    }
    if (!ctx.negotiationAllowed) {
      throw wrongState(
        'requestNegotiation',
        'in a version-0 call, which has no m.call.negotiate',
      )
    }
    if (ctx.pendingOutNegotiationMs !== undefined) {
      throw new CallError(
        'negotiationPending',
        'requestNegotiation',
        'a renegotiation offer is already awaiting its answer',
      )
    }
    ctx.pendingOutNegotiationMs = nowMs + this.config.negotiateLifetimeMs
    return [
      {
        act: 'send',
        event: negotiateEvent(
          ctx.callId,
          ctx.ownPartyId,
          this.config.negotiateLifetimeMs,
          description,
        ),
      },
    ]
  }

  /**
   * Answer the *peer's* renegotiation offer, with the SDP the media layer
   * produced for it. "Once an m.call.negotiate event is received, the client
   * must respond with another m.call.negotiate event, with the SDP answer
   * (with "type": "answer") in the description property."
   */
  answerNegotiation(
    description: SessionDescription,
    _nowMs: number,
  ): CallAction[] {
    const ctx = this.activeContext()
    if (ctx === undefined) {
      throw wrongState('answerNegotiation', this.stateName())
    }
    if (ctx.pendingInNegotiationMs === undefined) {
      throw wrongState(
        'answerNegotiation',
        'with no renegotiation offer to answer',
      )
    }
    ctx.pendingInNegotiationMs = undefined
    return [
      {
        act: 'send',
        event: negotiateEvent(
          ctx.callId,
          ctx.ownPartyId,
          // The answer's lifetime bounds nothing the specification defines;
          // the field is required, so the configured value is reused.
          this.config.negotiateLifetimeMs,
          description,
        ),
      },
    ]
  }

  // ── Remote events ──────────────────────────────────────────────────────

  /**
   * Feed one received `m.call.*` event.
   *
   * Never throws: anything that does not apply to the current call is
   * ignored, because in this protocol a surprising event is a race, not a
   * fault.
   */
  handleEvent(incoming: IncomingCallEvent, nowMs: number): CallAction[] {
    // Expiry rules run first: an event arriving in the very instant the
    // invite dies must meet an already-ended machine.
    const actions = this.tick(nowMs)

    const { sender, event, ageMs } = incoming
    if (this.lastEndedCallId === callIdOf(event)) return actions
    if (this.isOwnEcho(sender, partyIdOf(event))) return actions

    switch (event.type) {
      case 'm.call.invite':
        this.onInvite(sender, event.content, ageMs, nowMs, actions)
        break
      case 'm.call.answer':
        this.onAnswer(sender, event.content, nowMs, actions)
        break
      case 'm.call.candidates':
        this.onCandidates(sender, event.content, actions)
        break
      case 'm.call.select_answer':
        this.onSelectAnswer(sender, event.content, actions)
        break
      case 'm.call.reject':
        this.onReject(sender, event.content, actions)
        break
      case 'm.call.negotiate':
        this.onNegotiate(sender, event.content, ageMs, nowMs, actions)
        break
      case 'm.call.hangup':
        this.onHangup(sender, event.content, actions)
        break
    }
    return actions
  }

  /**
   * Advance the injected clock.
   *
   * Returns whatever the passage of time itself causes: invite expiry on both
   * sides, the connect deadline of a call that was agreed and never came up,
   * the reconnection window of a call that came up and lost it, and
   * renegotiation timeouts from `connecting` on.
   *
   * **Four of those five end the call and one does not**, which is the only
   * thing a reader needs to hold about this function: a renegotiation that
   * times out reports itself and leaves a working call working, while the
   * four expiries above it end the call and return immediately.
   */
  tick(nowMs: number): CallAction[] {
    const ending = this.expire(nowMs)
    if (ending !== undefined) return ending

    const ctx = this.activeContext()
    if (ctx === undefined) return []
    const actions: CallAction[] = []
    if (
      ctx.pendingOutNegotiationMs !== undefined &&
      nowMs > ctx.pendingOutNegotiationMs
    ) {
      // "the sender of the negotiate event should consider the negotiation
      // failed (timed out)".
      ctx.pendingOutNegotiationMs = undefined
      actions.push({ act: 'negotiationTimedOut' })
    }
    if (
      ctx.pendingInNegotiationMs !== undefined &&
      nowMs > ctx.pendingInNegotiationMs
    ) {
      // "and the recipient should ignore it": an offer that outlived its
      // lifetime can no longer be answered, and nobody needs telling.
      ctx.pendingInNegotiationMs = undefined
    }
    // The countdown is walked down here and nowhere else. A countdown is a
    // threshold made visible, so it is computed here and handed out as a
    // number: no shell owns a clock for it, and two of them cannot disagree
    // about what second it is.
    //
    // On change, not on call. `stateChanged` means "the projection moved"
    // everywhere else in this machine, and it means it here too: two ticks
    // inside the same second report once. Whoever drives `tick` may do so at
    // any rate they like.
    const countdown = ctx.reconnect
    if (countdown !== undefined) {
      const secondsLeft = secondsLeftOf(countdown.deadlineMs - nowMs)
      if (secondsLeft !== countdown.secondsLeft) {
        countdown.secondsLeft = secondsLeft
        actions.push(this.changed())
      }
    }
    return actions
  }

  // ── The four expiries ──────────────────────────────────────────────────

  /**
   * The endings the clock alone causes, or nothing.
   *
   * Every comparison here is strictly greater, as `accept`'s is and for the
   * same reason: the specification expires an invite when its age "exceeds"
   * the lifetime.
   */
  private expire(nowMs: number): CallAction[] | undefined {
    const here = this.current
    if (here.at === 'outgoingInvite' && nowMs > here.ctx.expiresAtMs) {
      // Caller-side expiry. The specification names the reason:
      // "invite_timeout: The other party did not answer in time."
      return this.endWithHangup(
        here.ctx.callId,
        here.ctx.partyId,
        'invite_timeout',
      )
    }
    if (here.at === 'incomingInvite' && nowMs > here.ctx.expiresAtMs) {
      // Callee-side expiry sends nothing: "clients should discard it. They
      // should also no longer show the call as awaiting an answer in the UI."
      this.end({ ended: 'inviteExpired' })
      return [this.changed()]
    }
    // The third expiry of this family: a call that was agreed and then never
    // came up. The media boundary normally ends it -- `mediaFailed` -- and
    // this is what happens when the media boundary says nothing at all.
    //
    // Why `ice_failed` and not `ice_timeout`: the specification assigns the
    // two by whether media ever flowed, and reaching this arm means
    // `mediaConnected` never ran, which is precisely "no media ever flowed".
    //
    // Belt and braces, and the braces are measured. The state check is the
    // belt; the deadline being unset outside `connecting` is the braces.
    // Widening this arm to `inCall` on its own changes nothing, because
    // `mediaConnected` clears the deadline; dropping that clear on its own
    // changes nothing either, because this arm does not read `inCall`. Doing
    // both turns four tests red -- run as a mutation rather than assumed --
    // and that is the regression this pair is here to catch.
    if (
      here.at === 'connecting' &&
      here.ctx.connectDeadlineMs !== undefined &&
      nowMs > here.ctx.connectDeadlineMs
    ) {
      return this.endWithHangup(
        here.ctx.callId,
        here.ctx.ownPartyId,
        'ice_failed',
      )
    }
    // The fourth, and the one that revises a decision rather than extending
    // one. `connecting`'s deadline above is armed by *entering a state*; this
    // one is armed by an *event* and cleared by its opposite, so a call that
    // never drops never reaches this arm and `inCall` still has no deadline
    // of its own.
    //
    // And the wire reason is the opposite of the arm above: `ice_timeout`,
    // because reaching here means the window was armed, which means the state
    // is `inCall`, which is reachable only through `mediaConnected`. Media
    // flowed, by construction.
    if (
      here.at === 'inCall' &&
      here.ctx.reconnect !== undefined &&
      nowMs > here.ctx.reconnect.deadlineMs
    ) {
      return this.endWithHangup(
        here.ctx.callId,
        here.ctx.ownPartyId,
        'ice_timeout',
      )
    }
    return undefined
  }

  // ── Per-event handlers ─────────────────────────────────────────────────

  private onInvite(
    sender: string,
    content: CallInviteContent,
    ageMs: number,
    nowMs: number,
    actions: CallAction[],
  ): void {
    // Who sent it is asked first, and the invitee rule below does not cover
    // it: that rule is about addressing and its field is *optional*, so an
    // invite carrying no `invitee` at all satisfies it whoever sent it. This
    // machine has exactly one peer, so an invite from a third member of the
    // room is not a call this device has any business ringing for -- and the
    // ringing state carries no caller identity, so a screen drawn from it
    // would draw a stranger's call under the peer's name, with the answer SDP
    // then going to the room.
    if (!this.isCallParty(sender)) return
    // "Clients should consider an incoming call if they see a non-expired
    // invite event where the invitee field is either absent or equal to their
    // user's Matrix ID." (specification, Invitees)
    if (
      content.invitee !== undefined &&
      content.invitee !== this.config.ownUserId
    ) {
      return
    }
    // "exceeds", strictly: dead on arrival only past the lifetime.
    if (ageMs > content.lifetime) return
    // Validity left is lifetime minus age -- the check above makes that
    // subtraction safe -- counted from now on the *receiving* clock, which is
    // the whole point of the age field: "incorrect clocks on client devices
    // don't break calls".
    const expiresAtMs = nowMs + (content.lifetime - ageMs)

    const here = this.current
    if (here.at === 'idle' || here.at === 'ended') {
      this.becomeIncoming(sender, content, expiresAtMs, false, actions)
      return
    }
    if (here.at !== 'outgoingInvite') {
      // Ringing, connecting or in call: "A Matrix client that receives a call
      // whilst already in a call would not generally reject the new call
      // unless the user had specifically chosen to do so". So it is ignored,
      // never auto-rejected -- refusing it would be deciding for the user.
      return
    }
    // Glare. The specification's algorithm, quoted in full because every word
    // of it is load-bearing
    // (<https://spec.matrix.org/latest/client-server-api/#glare>):
    //
    //   "If an m.call.invite to a room is received after the client has sent
    //   an m.call.invite to the same room and is waiting for a response: the
    //   client should perform a lexicographical comparison of the call IDs of
    //   the two calls and use the lesser of the two calls, aborting the
    //   greater. If the incoming call is the lesser, the client should accept
    //   this call on behalf of the user."
    //
    // The comparison is `<` on two strings, which is what both ends must run
    // for the tie-break to converge -- "If both clients implement the same
    // algorithm then they will both select the same call". Call ids are drawn
    // from an alphanumeric alphabet, where JavaScript's code-unit order and
    // the byte order another client's language would use are the same order.
    //
    // The specification's other branch, "whilst the client is preparing to
    // send an m.call.invite", has no state here: `placeCall` is one step, so
    // an invite can only meet an idle machine (above) or a sent invite.
    if (content.call_id < here.ctx.callId) {
      // The incoming call is the lesser and survives. Abort ours with a plain
      // hangup -- the specification prescribes no reason for the aborted leg,
      // and `user_hangup` is what a missing one reads as. We then become the
      // callee of the surviving call, which Politeness makes the polite
      // party: "if a client discards its outbound call in favour of an
      // inbound call, it becomes the polite party."
      actions.push({
        act: 'send',
        event: hangupEvent(here.ctx.callId, here.ctx.partyId, 'user_hangup'),
      })
      this.lastEndedCallId = here.ctx.callId
      this.becomeIncoming(sender, content, expiresAtMs, true, actions)
      return
    }
    // Ours is the lesser and survives: ignore the incoming invite entirely.
    // The other client runs the same comparison on the same two ids and
    // aborts its own, so nothing is sent from this side.
  }

  private onAnswer(
    sender: string,
    content: CallAnswerContent,
    nowMs: number,
    actions: CallAction[],
  ): void {
    const here = this.current
    if (
      here.at === 'outgoingInvite' &&
      content.call_id === here.ctx.callId &&
      // Only the peer -- or, in a call to oneself, our own user -- may answer
      // our invite. A third room member who somehow learned the call id is not
      // a party to this call.
      this.isCallParty(sender)
    ) {
      // The first answer wins. Later ones, from other devices of the callee,
      // end themselves when they see our select_answer: "If the callee's
      // client sees a select_answer for an answer with party ID other than
      // the one it sent, it ends the call."
      const ctx = here.ctx
      // A select_answer requires the selected party id; a version-0 answer
      // has none, and version-0 clients ignore the event anyway, so it is
      // simply not sent.
      if (content.party_id !== undefined) {
        actions.push({
          act: 'send',
          event: selectAnswerEvent(ctx.callId, ctx.partyId, content.party_id),
        })
      }
      const flushed = ctx.pendingCandidates
        .filter(held => held.partyId === content.party_id)
        .flatMap(held => held.candidates)
      actions.push({ act: 'remoteAnswer', answer: content.answer })
      if (flushed.length > 0) {
        actions.push({
          act: 'remoteCandidates',
          partyId: content.party_id,
          candidates: flushed,
        })
      }
      actions.push({ act: 'startMedia' })
      this.current = {
        at: 'connecting',
        ctx: {
          callId: ctx.callId,
          ownPartyId: ctx.partyId,
          remoteUserId: sender,
          remotePartyId: content.party_id,
          role: 'caller',
          negotiationAllowed: !isVersionZero(content.version),
          // Measured from the *answer*, not from the invite: the wait a user
          // is watching starts when the call is agreed, not when it was
          // offered. The invite has its own, longer lifetime for the ringing
          // half.
          connectDeadlineMs: nowMs + this.config.connectTimeoutMs,
        },
      }
      actions.push(this.changed())
      return
    }
    if (
      here.at === 'incomingInvite' &&
      content.call_id === here.ctx.callId &&
      sender === this.config.ownUserId
    ) {
      // Our own other device answered. "It does not send any events" is
      // written about select_answer, but it is the whole shape of this path
      // too: the caller will confirm with its select_answer, and there is
      // nothing for this device to say either way.
      this.end({ ended: 'answeredElsewhere' })
      actions.push(this.changed())
    }
  }

  private onCandidates(
    sender: string,
    content: CallCandidatesContent,
    actions: CallAction[],
  ): void {
    // A party id is not an identity, and this is the handler where that
    // matters most: candidates are the one received kind that reaches the
    // media layer with no user gesture in between. The party id travels in
    // the room exactly like the call id, so any member can stamp an event
    // with the one a call is established with -- and against a version-0 peer
    // there is no remote party id at all, so the comparison below admits
    // every party there is. What separates the peer from a bystander is the
    // *sender*; the party comparison keeps its own, narrower job of telling
    // the peer's several devices apart.
    const here = this.current
    if (here.at === 'outgoingInvite') {
      // Caller side, before selection: keep them with the answering party;
      // the answer flushes the selected party's. Any device of the callee may
      // be the one that answers, so the sender is bound to the call's parties
      // rather than to one device.
      if (content.call_id === here.ctx.callId && this.isCallParty(sender)) {
        here.ctx.pendingCandidates.push({
          partyId: content.party_id,
          candidates: content.candidates,
        })
      }
      return
    }
    if (here.at === 'incomingInvite') {
      // Callee side, before answering: the caller legitimately sends
      // candidates while we are still ringing, since its invite and its first
      // candidates travel together. The buffer has no party keying and
      // `accept` flushes it whole, so the sender is the only thing standing
      // between a bystander and this device's ICE agent.
      if (
        content.call_id === here.ctx.callId &&
        sender === here.ctx.callerUserId
      ) {
        here.ctx.bufferedCandidates.push(...content.candidates)
      }
      return
    }
    const ctx = this.activeContext()
    if (
      ctx !== undefined &&
      content.call_id === ctx.callId &&
      sender === ctx.remoteUserId &&
      // Only the party the call is established *with* has anything useful to
      // say here: the specification's own "matches m.call.candidates events
      // to their respective answer/invite".
      (ctx.remotePartyId === undefined ||
        content.party_id === ctx.remotePartyId)
    ) {
      actions.push({
        act: 'remoteCandidates',
        partyId: content.party_id,
        candidates: content.candidates,
      })
    }
  }

  private onSelectAnswer(
    sender: string,
    content: CallSelectAnswerContent,
    actions: CallAction[],
  ): void {
    const here = this.current
    const ctx = this.activeContext()
    if (
      ctx !== undefined &&
      content.call_id === ctx.callId &&
      ctx.role === 'callee' &&
      sender === ctx.remoteUserId
    ) {
      // "If the callee's client sees a select_answer for an answer with party
      // ID other than the one it sent, it ends the call and informs the user
      // the call was answered elsewhere. It does not send any events."
      if (content.selected_party_id !== ctx.ownPartyId) {
        actions.push({ act: 'stopMedia' })
        this.end({ ended: 'answeredElsewhere' })
        actions.push(this.changed())
      }
      return
    }
    if (
      here.at === 'incomingInvite' &&
      content.call_id === here.ctx.callId &&
      sender === here.ctx.callerUserId
    ) {
      // The caller selected an answer before this device even saw the
      // sibling's answer -- a plain sync race. Same ending.
      this.end({ ended: 'answeredElsewhere' })
      actions.push(this.changed())
      return
    }
    if (
      here.at === 'outgoingInvite' &&
      content.call_id === here.ctx.callId &&
      sender === this.config.ownUserId
    ) {
      // A select_answer from our own user on the call we placed: another
      // device of this account is running this call. The specification's
      // sentence is written for the callee, but the conclusion transfers
      // unchanged -- the call is handled elsewhere, and this side says
      // nothing.
      this.end({ ended: 'answeredElsewhere' })
      actions.push(this.changed())
    }
  }

  private onReject(
    sender: string,
    content: CallRejectContent,
    actions: CallAction[],
  ): void {
    const here = this.current
    if (
      here.at === 'outgoingInvite' &&
      content.call_id === here.ctx.callId &&
      this.isCallParty(sender)
    ) {
      // "The reject has a party_id just like an answer, and the caller sends
      // a select_answer for it just like an answer." The select_answer is not
      // ceremony: it is what ends the call on any *other* device of the
      // callee that already answered -- "If another client had already sent
      // an answer and sees the caller select the reject response instead of
      // its answer, it ends the call."
      actions.push({
        act: 'send',
        event: selectAnswerEvent(
          here.ctx.callId,
          here.ctx.partyId,
          content.party_id,
        ),
      })
      this.end({ ended: 'rejected' })
      actions.push(this.changed())
      return
    }
    if (
      here.at === 'incomingInvite' &&
      content.call_id === here.ctx.callId &&
      sender === this.config.ownUserId
    ) {
      // Our own other device refused: "This rejects the call on all devices".
      this.end({ ended: 'rejectedElsewhere' })
      actions.push(this.changed())
    }
    // Connecting or in call: a reject that lands after an answer is
    // disregarded -- "if the calling device sees an answer before the reject,
    // it disregards the reject event and carries on" on the caller side, and
    // on the callee side a sibling's reject after this device already
    // answered meets that same rule from the other end.
  }

  private onNegotiate(
    sender: string,
    content: CallNegotiateContent,
    ageMs: number,
    nowMs: number,
    actions: CallAction[],
  ): void {
    // Legal from `connecting` on: the gate is the version pair, not the media
    // state -- see `requestNegotiation`.
    const ctx = this.activeContext()
    if (ctx === undefined || content.call_id !== ctx.callId) return
    // "The caller ignores any negotiate events with party_id + user_id tuple
    // not equal to that of the answer it accepted and the callee ignores any
    // negotiate events with party_id + user_id tuple not equal to that of the
    // caller." A version-0 peer has no party id, and cannot negotiate at all:
    // the event itself is version 1.
    if (ctx.remotePartyId === undefined) return
    if (sender !== ctx.remoteUserId || content.party_id !== ctx.remotePartyId) {
      return
    }
    // "This has a lifetime field as in m.call.invite, after which [...] the
    // recipient should ignore it."
    if (ageMs > content.lifetime) return

    if (content.description.type === 'offer') {
      // Simultaneous offers. If our own offer is still in flight, both sides
      // now hold an unanswered one -- the renegotiation glare of WebRTC
      // perfect negotiation. The machine tracks both and chooses neither:
      // which SDP survives is the media layer's decision, where "The callee is
      // always the polite party" tells it whose offer rolls back. The peer's
      // offer is still delivered, because the specification obliges an answer.
      ctx.pendingInNegotiationMs = nowMs + (content.lifetime - ageMs)
      actions.push({
        act: 'remoteRenegotiationOffer',
        description: content.description,
      })
      return
    }
    if (content.description.type === 'answer') {
      // An answer we never offered for is a race leftover; only a pending
      // offer makes it meaningful.
      if (ctx.pendingOutNegotiationMs !== undefined) {
        ctx.pendingOutNegotiationMs = undefined
        actions.push({
          act: 'applyRenegotiationAnswer',
          description: content.description,
        })
      }
    }
    // `pranswer` and `rollback` exist in WebRTC but not in this product's
    // flows; the specification's own advice is to pass descriptions to the
    // WebRTC API without validating the type field, which is the media
    // layer's business rather than this one's.
  }

  private onHangup(
    sender: string,
    content: CallHangupContent,
    actions: CallAction[],
  ): void {
    const here = this.current
    const mediaStarted = this.activeContext() !== undefined
    const applies =
      here.at === 'outgoingInvite'
        ? // A version-0 callee refuses by hanging up, so the sender is the
          // callee. "Not us" was not enough of a test: it let every other
          // member of the room cancel a call they are no part of, with the
          // invite already out and the real callee's telephone still ringing.
          // The two arms below bind a single identity each; this one binds the
          // call's parties, because any device of the callee may be the one to
          // give up and a call to oneself has our own user as its callee.
          content.call_id === here.ctx.callId && this.isCallParty(sender)
        : here.at === 'incomingInvite'
          ? // The caller aborted before we decided.
            content.call_id === here.ctx.callId &&
            sender === here.ctx.callerUserId
          : here.at === 'connecting' || here.at === 'inCall'
            ? content.call_id === here.ctx.callId &&
              sender === here.ctx.remoteUserId
            : false
    if (!applies) return
    if (mediaStarted) actions.push({ act: 'stopMedia' })
    this.end({ ended: 'hangup', reason: hangupReasonOf(content) })
    actions.push(this.changed())
  }

  // ── Internals ──────────────────────────────────────────────────────────

  private becomeIncoming(
    sender: string,
    content: CallInviteContent,
    expiresAtMs: number,
    autoAccept: boolean,
    actions: CallAction[],
  ): void {
    this.current = {
      at: 'incomingInvite',
      ctx: {
        callId: content.call_id,
        callerUserId: sender,
        callerPartyId: content.party_id,
        version: content.version,
        offer: content.offer,
        expiresAtMs,
        autoAccept,
        bufferedCandidates: [],
      },
    }
    actions.push(this.changed())
  }

  /**
   * Whether `sender` is a party to this machine's calls at all -- the
   * question every handler asks before it reads a word of the content.
   *
   * One machine per conversation and one known peer, so the set has two
   * members and no more: the peer, and our own user -- because "since a user
   * may call themselves, they cannot simply ignore events from their own
   * user", and because our own other devices answer, reject and hang up the
   * calls we place. Everybody else in the room is a bystander.
   *
   * It is one function and not a line repeated in six guards because it is
   * one rule, and two copies of a rule eventually disagree. The handlers that
   * bind a *single* identity -- the caller of the invite we are ringing on,
   * the party a call is established with -- go on binding it directly; that
   * is a narrower question, not this one.
   */
  private isCallParty(sender: string): boolean {
    return sender === this.config.peerUserId || sender === this.config.ownUserId
  }

  /**
   * Remote-echo detection, the exact problem `party_id` exists for: "Clients
   * use this to identify remote echo of their own events: since a user may
   * call themselves, they cannot simply ignore events from their own user."
   */
  private isOwnEcho(sender: string, partyId: string | undefined): boolean {
    if (sender !== this.config.ownUserId) return false
    const here = this.current
    const ownParty =
      here.at === 'outgoingInvite'
        ? here.ctx.partyId
        : this.activeContext()?.ownPartyId
    return ownParty !== undefined && partyId === ownParty
  }

  /** The context of an established call, in either of the two states holding one. */
  private activeContext(): CallContext | undefined {
    return this.current.at === 'connecting' || this.current.at === 'inCall'
      ? this.current.ctx
      : undefined
  }

  /** Which call the machine is on, if it is on one. */
  private currentCallId(): string | undefined {
    const here = this.current
    switch (here.at) {
      case 'idle':
      case 'ended':
        return undefined
      case 'outgoingInvite':
      case 'incomingInvite':
        return here.ctx.callId
      case 'connecting':
      case 'inCall':
        return here.ctx.callId
    }
  }

  /** Hang up and end, the three actions every clock-driven ending emits. */
  private endWithHangup(
    callId: string,
    partyId: string,
    reason: SentHangupReason,
  ): CallAction[] {
    this.end({ ended: 'hangup', reason })
    return [
      { act: 'send', event: hangupEvent(callId, partyId, reason) },
      { act: 'stopMedia' },
      this.changed(),
    ]
  }

  private end(reason: EndReason): void {
    const callId = this.currentCallId()
    if (callId !== undefined) this.lastEndedCallId = callId
    this.current = { at: 'ended', reason }
  }

  private changed(): CallAction {
    return { act: 'stateChanged', state: this.state() }
  }

  /** How a refusal names the state that refused it. For a person to read. */
  private stateName(): string {
    switch (this.current.at) {
      case 'idle':
        return 'idle'
      case 'outgoingInvite':
        return 'awaiting an answer'
      case 'incomingInvite':
        return 'ringing'
      case 'connecting':
        return 'connecting'
      case 'inCall':
        return 'in call'
      case 'ended':
        return 'ended'
    }
  }
}
