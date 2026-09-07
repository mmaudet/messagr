/**
 * The `m.call.*` wire format, as plain TypeScript.
 *
 * These are the seven event contents of the Matrix "Voice over IP" module
 * (<https://spec.matrix.org/latest/client-server-api/#voice-over-ip>),
 * shaped exactly as they travel: `call_id`, `party_id`, `selected_party_id`
 * in the snake case the specification writes them in, and `sdpMid` /
 * `sdpMLineIndex` in the camel case WebRTC writes *those* in. The
 * inconsistency is the protocol's, and copying it is the point -- a
 * `CallEvent` is handed to the room unchanged.
 *
 * # Why these are written out rather than taken from a library
 *
 * The predecessor of this module was Rust, and it used ruma's own event
 * contents on the boundary, on the argument that the wire format was
 * already proved by the library and re-wrapping it would fork it. There is
 * no ruma here. `matrix-js-sdk` is a dependency of this application, but it
 * types call events as loose event content rather than as the seven
 * distinct shapes the protocol has, so it would give the compiler nothing
 * to check the machine against. So the shapes are written here, and the
 * comment ruma's absence costs is this one: **the wire format is the
 * contract**. A field renamed here is a field renamed on the wire, and a
 * peer running any other client stops understanding this one.
 *
 * # Version 1, on everything sent
 *
 * VoIP version 1 is the version that adds `party_id`, `m.call.select_answer`
 * and `m.call.reject` -- the multi-device semantics this product needs,
 * since an account here has several devices and any of them may answer.
 * Every constructor below that stamps a version stamps `'1'`, except the
 * two `...VersionZero` ones, which exist only to answer a legacy caller in
 * the version it speaks.
 *
 * Received events are read leniently, which is the specification's own
 * instruction: "If clients see events with version other than 0 or "1"
 * (including, for example, the numeric value 1), they should treat these
 * the same as if they had version == "1"." So exactly one received value
 * means version 0 -- see `isVersionZero`.
 */

/**
 * A VoIP session description: WebRTC's `RTCSessionDescriptionInit`, with
 * the two fields the protocol carries.
 *
 * The SDP is a string this application never reads. It is produced by a
 * media layer, carried across the room, and handed to a media layer at the
 * other end; nothing between the two has any business parsing it.
 */
export interface SessionDescription {
  /** `offer`, `answer`, and the ones WebRTC has that this product does not. */
  readonly type: string
  readonly sdp: string
}

/**
 * One ICE candidate, as `m.call.candidates` carries it.
 *
 * The two optional fields are the specification's own optionality: "At
 * least one of `sdpMid` or `sdpMLineIndex` is required, unless `candidate`
 * is empty" -- and an empty `candidate` is the version-1 end-of-candidates
 * marker, which is why it cannot be required.
 */
export interface Candidate {
  /** The SDP "a" line. Empty means "no more candidates". */
  readonly candidate: string
  readonly sdpMid?: string
  readonly sdpMLineIndex?: number
}

/**
 * The `version` field as it arrives.
 *
 * Two types because the protocol uses two: version 0 events carry the
 * *number* `0`, version 1 events carry the *string* `'1'`. A peer may send
 * anything at all here, so nothing narrower would be honest about what
 * comes off the wire.
 */
export type VoipVersion = number | string

/** What every event this machine sends is stamped with. */
export const VERSION_1 = '1'

/**
 * Whether a received event is a legacy version-0 one.
 *
 * Only the numeric zero is: the specification writes version 0 as `0` and
 * version 1 as `"1"`, and rules that anything else -- the string `'0'`
 * included, and the numeric `1` it names explicitly -- is treated as
 * version 1. Reading `'0'` as legacy would be more generous than the
 * specification and would answer a modern client with an answer carrying no
 * `party_id`, which is the one thing multi-device semantics cannot do
 * without.
 */
export function isVersionZero(version: VoipVersion): boolean {
  return version === 0
}

/**
 * The hangup reasons this machine ever puts on the wire.
 *
 * Closed, deliberately, and narrower than what it will *read*: the wire
 * reason decides which sentence the other end shows a person, and a shell
 * that could invent one would be writing product copy from a call site.
 * The four this machine actually stamps are `user_hangup`, `invite_timeout`,
 * `ice_failed` and `ice_timeout`; the rest are the specification's, kept so
 * a media layer reporting a failure can name what it saw.
 */
export type SentHangupReason =
  | 'ice_failed'
  | 'invite_timeout'
  | 'ice_timeout'
  | 'user_hangup'
  | 'user_media_failed'
  | 'user_busy'
  | 'unknown_error'

/** `m.call.invite` -- the caller offers. */
export interface CallInviteContent {
  readonly call_id: string
  /** Required in version 1, absent from a legacy caller's invite. */
  readonly party_id?: string
  /** Milliseconds the invite stays valid. See `DEFAULT_INVITE_LIFETIME_MS`. */
  readonly lifetime: number
  readonly offer: SessionDescription
  readonly version: VoipVersion
  /**
   * "The invitee field should be added whenever the call is intended for
   * one specific user" (specification, Invitees). Absent means the invite
   * is for any member of the room except the sender.
   */
  readonly invitee?: string
}

/** `m.call.answer` -- a callee's device picks up. */
export interface CallAnswerContent {
  readonly call_id: string
  readonly party_id?: string
  readonly answer: SessionDescription
  readonly version: VoipVersion
}

/** `m.call.candidates` -- more ways to reach the sender. */
export interface CallCandidatesContent {
  readonly call_id: string
  readonly party_id?: string
  readonly candidates: readonly Candidate[]
  readonly version: VoipVersion
}

/** `m.call.select_answer` -- the caller says which device it took. */
export interface CallSelectAnswerContent {
  readonly call_id: string
  readonly party_id: string
  readonly selected_party_id: string
  readonly version: VoipVersion
}

/**
 * `m.call.reject` -- the callee refuses.
 *
 * No reason field, by design: "the rejection of a call is always implicitly
 * because the user chose not to answer it."
 */
export interface CallRejectContent {
  readonly call_id: string
  readonly party_id: string
  readonly version: VoipVersion
}

/** `m.call.negotiate` -- a mid-call SDP renegotiation, offer or answer. */
export interface CallNegotiateContent {
  readonly call_id: string
  readonly party_id: string
  readonly lifetime: number
  readonly description: SessionDescription
  readonly version: VoipVersion
}

/** `m.call.hangup` -- either party ends it. */
export interface CallHangupContent {
  readonly call_id: string
  readonly party_id?: string
  readonly version: VoipVersion
  /**
   * Optional on the wire, and the absence has a meaning of its own: "a
   * missing value should be treated as user_hangup". Read it through
   * `hangupReasonOf`, never directly, so that rule has one copy.
   *
   * Typed as a plain string rather than as `SentHangupReason` because this
   * is the receiving side: a peer running another client may name a reason
   * this build has never heard of, and refusing to end a call over an
   * unknown string would be the worse failure.
   */
  readonly reason?: string
}

/**
 * One `m.call.*` event's type and content.
 *
 * The same seven shapes travel in both directions, so one union describes
 * what the machine asks to send and what the transport feeds back. The
 * event type is the discriminant because it is what the room is addressed
 * with: a transport sends `event.type` with `event.content` and reads them
 * back the same way, with no table in between mapping one vocabulary onto
 * another.
 */
export type CallEvent =
  | { readonly type: 'm.call.invite'; readonly content: CallInviteContent }
  | { readonly type: 'm.call.answer'; readonly content: CallAnswerContent }
  | {
      readonly type: 'm.call.candidates'
      readonly content: CallCandidatesContent
    }
  | {
      readonly type: 'm.call.select_answer'
      readonly content: CallSelectAnswerContent
    }
  | { readonly type: 'm.call.reject'; readonly content: CallRejectContent }
  | {
      readonly type: 'm.call.negotiate'
      readonly content: CallNegotiateContent
    }
  | { readonly type: 'm.call.hangup'; readonly content: CallHangupContent }

/** Which call an event belongs to. Every kind carries it. */
export function callIdOf(event: CallEvent): string {
  return event.content.call_id
}

/**
 * Which party sent it, when it says.
 *
 * Absent from a version-0 event, and from nothing else: `select_answer`,
 * `reject` and `negotiate` are version-1 events and require it.
 */
export function partyIdOf(event: CallEvent): string | undefined {
  return event.content.party_id
}

/**
 * The reason a hangup carries, with the specification's default applied.
 *
 * "a missing value should be treated as user_hangup" -- the one place that
 * sentence is written in code, so a reader who changes it changes it once.
 */
export function hangupReasonOf(content: CallHangupContent): string {
  return content.reason ?? 'user_hangup'
}

/** An `m.call.invite`, version 1, addressed to one specific invitee. */
export function inviteEvent(
  callId: string,
  partyId: string,
  lifetimeMs: number,
  offer: SessionDescription,
  invitee: string,
): CallEvent {
  return {
    type: 'm.call.invite',
    content: {
      call_id: callId,
      party_id: partyId,
      lifetime: lifetimeMs,
      offer,
      version: VERSION_1,
      invitee,
    },
  }
}

/** An `m.call.answer`, version 1. */
export function answerEvent(
  callId: string,
  partyId: string,
  answer: SessionDescription,
): CallEvent {
  return {
    type: 'm.call.answer',
    content: {
      call_id: callId,
      party_id: partyId,
      answer,
      version: VERSION_1,
    },
  }
}

/**
 * An `m.call.answer` in version 0, for a legacy caller.
 *
 * No `party_id`: the field does not exist in that version, and a caller
 * that predates it would not read one. The consequence runs all the way
 * through the call -- no `select_answer` will come back, and no
 * renegotiation is possible.
 */
export function answerEventVersionZero(
  callId: string,
  answer: SessionDescription,
): CallEvent {
  return {
    type: 'm.call.answer',
    content: { call_id: callId, answer, version: 0 },
  }
}

/** An `m.call.candidates`, version 1. */
export function candidatesEvent(
  callId: string,
  partyId: string,
  candidates: readonly Candidate[],
): CallEvent {
  return {
    type: 'm.call.candidates',
    content: {
      call_id: callId,
      party_id: partyId,
      candidates,
      version: VERSION_1,
    },
  }
}

/** An `m.call.select_answer`, version 1. */
export function selectAnswerEvent(
  callId: string,
  partyId: string,
  selectedPartyId: string,
): CallEvent {
  return {
    type: 'm.call.select_answer',
    content: {
      call_id: callId,
      party_id: partyId,
      selected_party_id: selectedPartyId,
      version: VERSION_1,
    },
  }
}

/** An `m.call.reject`, version 1. The only version that has one. */
export function rejectEvent(callId: string, partyId: string): CallEvent {
  return {
    type: 'm.call.reject',
    content: { call_id: callId, party_id: partyId, version: VERSION_1 },
  }
}

/** An `m.call.negotiate`, version 1, carrying an offer or an answer. */
export function negotiateEvent(
  callId: string,
  partyId: string,
  lifetimeMs: number,
  description: SessionDescription,
): CallEvent {
  return {
    type: 'm.call.negotiate',
    content: {
      call_id: callId,
      party_id: partyId,
      lifetime: lifetimeMs,
      description,
      version: VERSION_1,
    },
  }
}

/** An `m.call.hangup`, version 1. */
export function hangupEvent(
  callId: string,
  partyId: string,
  reason: SentHangupReason,
): CallEvent {
  return {
    type: 'm.call.hangup',
    content: {
      call_id: callId,
      party_id: partyId,
      version: VERSION_1,
      reason,
    },
  }
}

/**
 * An `m.call.hangup` in version 0 -- how a legacy invite is refused.
 *
 * "If the m.call.invite event has version 0, the callee sends an
 * m.call.hangup event" (specification, m.call.reject): a version-0 caller
 * cannot parse an `m.call.reject`, so refusing one with a reject would
 * leave its telephone ringing until the lifetime ran out. The reason is
 * written rather than left absent, so nothing downstream has to apply the
 * default to know what this means.
 */
export function hangupEventVersionZero(callId: string): CallEvent {
  return {
    type: 'm.call.hangup',
    content: { call_id: callId, version: 0, reason: 'user_hangup' },
  }
}
