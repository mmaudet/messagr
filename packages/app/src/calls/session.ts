import {
  iceConfigFrom,
  type IceConfigFailure,
  type TurnServerAnswer,
} from './ice'
import { CallError, type CallAction, type CallState } from './machine'
import { startCallMedia, type CallMedia, type MediaPorts } from './media'
import { startCallTransport, type CallTransport } from './transport'
import type { CallEvent, SentHangupReason } from './wire'

/**
 * The one place the four pieces of a call are joined.
 *
 * The machine decides, the transport carries, the media layer captures and
 * connects, and `ice.ts` says the media may only be relayed. Each was written
 * without knowing the others exist; this is where they are told about each
 * other, and it is deliberately the only file that knows all four.
 *
 * # It is a composition and almost nothing else
 *
 * Every rule below already lives somewhere: what a candidate may do is in
 * `media.ts`, what an event means is in `machine.ts`, what may go on the wire
 * is in `transport.ts`. What is *here* is the wiring, and the two decisions
 * wiring forces:
 *
 * **The relay credentials are fetched per call, not held.** `iceConfigFrom`
 * passes their lifetime through untouched precisely so nothing caches them,
 * and a call is the natural moment to ask: the homeserver's answer is
 * short-lived by design, and a call placed an hour after the last one would
 * otherwise offer a peer credentials that have expired.
 *
 * **A call that cannot be relayed is not placed.** The refusal comes back
 * from `iceConfigFrom` and is thrown here rather than degraded, because the
 * alternative is putting the device's own address on the wire under an
 * interface that promised the opposite (RFC 8827 §6.4). The operator learns
 * it from an error; the user never learns it from a leak.
 *
 * # The media layer answers to the transport, and the transport to the machine
 *
 * `onAction` is one switch, and it is exhaustive on purpose: a `CallAction`
 * added later fails to compile here rather than being silently ignored by a
 * default branch. The machine's actions arrive synchronously and in its own
 * order; anything asynchronous they start is chased through the promise
 * chains below, which never reject into the caller -- a media failure is
 * reported *to the machine*, which is the thing that knows what a failure
 * means for the call.
 */

/** Why a session could not be started. Each is a call that is not placed. */
export type CallSessionFailure =
  | { readonly kind: 'no-relay'; readonly failure: IceConfigFailure }
  | { readonly kind: 'no-microphone'; readonly reason: string }

export class CallSessionError extends Error {
  readonly failure: CallSessionFailure

  constructor(failure: CallSessionFailure, message: string) {
    super(message)
    this.name = 'CallSessionError'
    this.failure = failure
  }
}

export interface CallSessionPorts {
  /**
   * Seal one `m.call.*` event and put it in the room.
   *
   * Encrypted, and the specification asks for it: a `party_id` identifies
   * which of somebody's devices is on a call, and "in an unencrypted room"
   * that is disclosed to anybody reading the timeline.
   */
  readonly sendCallEvent: (event: CallEvent) => Promise<void>
  /** `GET /_matrix/client/v3/voip/turnServer`, asked once per call. */
  readonly turnServer: () => Promise<TurnServerAnswer>
  readonly media: MediaPorts
  readonly now: () => number
  readonly newCallId: () => string
  readonly repeat: (everyMs: number, run: () => void) => () => void
  /** Told on every transition, for whoever draws. */
  readonly onState: (state: CallState) => void
}

export interface CallSessionConfig {
  readonly ownUserId: string
  readonly peerUserId: string
  /** The device id, which is what the specification suggests a party id be. */
  readonly ownPartyId: string
}

export interface CallSession {
  readonly state: () => CallState
  /** Place a call. Rejects with `CallSessionError` when it cannot be placed. */
  readonly place: () => Promise<void>
  /** Answer the ringing call. Rejects the same way. */
  readonly answer: () => Promise<void>
  readonly reject: () => void
  readonly hangup: () => void
  /** Mute or unmute, answering what the microphone actually holds afterwards. */
  readonly setMuted: (muted: boolean) => boolean
  readonly muted: () => boolean
  /** One sync's worth of raw room events. Throws nothing. */
  readonly receive: (rawEvents: readonly unknown[]) => void
  /** Tear everything down: ticker, media, microphone. */
  readonly stop: () => Promise<void>
}

export function startCallSession(
  ports: CallSessionPorts,
  config: CallSessionConfig,
): CallSession {
  // Built on the first call and torn down with it. Held rather than passed
  // because `onAction` needs it and `onAction` is handed to the transport
  // before any call exists.
  let media: CallMedia | undefined
  let transport: CallTransport | undefined

  function mediaOrThrow(): CallMedia {
    if (media === undefined) {
      // Not reachable from a gesture: every path that produces an action has
      // gone through `place` or `answer` first. Stated rather than
      // `as CallMedia`, so a future path that breaks it says so.
      throw new Error('a call action arrived before there was a media layer')
    }
    return media
  }

  function onAction(action: CallAction): void {
    switch (action.act) {
      case 'send':
        // The transport's own outbox owns this one; it never reaches here.
        return
      case 'stateChanged':
        ports.onState(action.state)
        return
      case 'startMedia':
        // Not "start capturing" -- capture began when the offer or answer was
        // produced. This is the machine saying the call now exists, which is
        // what lets held candidates go out.
        mediaOrThrow().open()
        return
      case 'stopMedia':
        mediaOrThrow().stop()
        return
      case 'remoteAnswer':
        mediaOrThrow()
          .applyAnswer(action.answer)
          .catch(() => transport?.mediaFailed('ice_failed'))
        return
      case 'remoteCandidates':
        mediaOrThrow()
          .addRemoteCandidates(action.candidates)
          .catch(() => undefined)
        return
      case 'remoteRenegotiationOffer':
        // "Once an m.call.negotiate event is received, the client must
        // respond with another m.call.negotiate event, with the SDP answer."
        mediaOrThrow()
          .answerRenegotiation(action.description)
          .then(answer => transport?.answerNegotiation(answer))
          .catch(() => undefined)
        return
      case 'applyRenegotiationAnswer':
        mediaOrThrow()
          .applyRenegotiationAnswer(action.description)
          .catch(() => undefined)
        return
      case 'negotiationTimedOut':
        // The call survives. Nothing to do to the media, and saying so is
        // the point: an earlier reading of this as an ending would have hung
        // up a working call.
        return
    }
  }

  function transportOrStart(): CallTransport {
    if (transport !== undefined) return transport
    transport = startCallTransport(config, {
      send: ports.sendCallEvent,
      now: ports.now,
      newCallId: ports.newCallId,
      answerForGlare: async offer => mediaOrThrow().answer(offer),
      onAction,
      repeat: ports.repeat,
    })
    return transport
  }

  /**
   * The relay, asked for now and never held.
   *
   * Failing here is failing the call: `iceConfigFrom` refuses a homeserver
   * that offers nothing and one that offers only STUN, and both are an
   * operator's problem rather than a fallback this may take.
   */
  async function relayed(): Promise<CallMedia> {
    if (media !== undefined) return media
    const answer = await ports.turnServer()
    const config_ = iceConfigFrom(answer)
    if (!config_.ok) {
      throw new CallSessionError(
        { kind: 'no-relay', failure: config_.failure },
        'this call cannot be relayed, and it will not be placed unrelayed',
      )
    }
    media = startCallMedia(ports.media, config_.config, {
      onCandidates: candidates =>
        reported(() => transport?.sendCandidates(candidates)),
      onConnected: () => reported(() => transport?.mediaConnected()),
      onDisconnected: () => reported(() => transport?.mediaDisconnected()),
      onReconnected: () => reported(() => transport?.mediaReconnected()),
      onFailed: () => reported(() => transport?.mediaFailed('ice_failed')),
    })
    return media
  }

  /**
   * A media report the machine refuses is not an error anybody can handle.
   *
   * ICE DOES NOT WAIT FOR THE PROTOCOL, WHICH IS THE WHOLE REASON THIS
   * EXISTS. Gathering and connectivity checks start when the local
   * description is set, so `failed` can arrive while the invite is still
   * ringing and no answer has come -- and the machine refuses `mediaFailed`
   * outside an active call, deliberately: from where it sits, a fatal
   * failure on a call that does not exist is a programming error.
   *
   * From here it is not one. It is the media layer being ahead of the
   * protocol, and the invite's own ninety-second lifetime is what ends a
   * call nobody answered. Found by a test rather than on a device, which is
   * the point of the ports.
   *
   * `CallError` only. Anything else is a bug in this file and must not be
   * swallowed -- though it runs on the library's callback, where nothing can
   * catch it either, so it will be loud.
   */
  function reported(run: () => void): void {
    try {
      run()
    } catch (cause: unknown) {
      if (cause instanceof CallError) return
      throw cause
    }
  }

  async function withMicrophone<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run()
    } catch (cause: unknown) {
      if (cause instanceof CallSessionError) throw cause
      // A refused microphone and a busy one are the same thing to a person:
      // a call that cannot happen, said now rather than a call that connects
      // and carries silence.
      throw new CallSessionError(
        {
          kind: 'no-microphone',
          reason: cause instanceof Error ? cause.message : String(cause),
        },
        'the microphone could not be captured, so there is no call to place',
      )
    }
  }

  return {
    state: () => transportOrStart().state(),

    place: async () => {
      // The transport first: `relayed` builds a media layer whose listener
      // calls into it, and a candidate gathered before it exists would have
      // nowhere to go.
      const carrier = transportOrStart()
      const captured = await relayed()
      const offer = await withMicrophone(() => captured.offer())
      carrier.placeCall(offer)
    },

    answer: async () => {
      const carrier = transportOrStart()
      const now = carrier.state()
      if (now.call !== 'incomingInvite') {
        // The machine would refuse this too, and identically; refusing here
        // as well keeps the microphone shut for a gesture that cannot work.
        throw new Error(`there is no ringing call to answer (${now.call})`)
      }
      const captured = await relayed()
      const answer = await withMicrophone(() => captured.answer(now.offer))
      carrier.accept(answer)
    },

    reject: () => transportOrStart().reject(),

    // `user_hangup`, always, because this is the only path a person can take
    // to this function. Every other reason is the machine's or the media
    // layer's to give.
    hangup: () => transportOrStart().hangup(USER_HANGUP),

    setMuted: muted => media?.setMuted(muted) ?? muted,
    muted: () => media?.muted() ?? false,

    receive: rawEvents => transportOrStart().receive(rawEvents),

    stop: async () => {
      // Order matters, and it is the transport's own note that says why:
      // what is already in its outbox still goes out, and the last thing a
      // teardown queues is usually the hangup that tells the peer. Stopping
      // the media first would be fine; not waiting would leave a telephone
      // ringing for ninety seconds.
      transport?.stop()
      await transport?.settled()
      media?.stop()
      media = undefined
      transport = undefined
    },
  }
}

/** The wire reason for a person pressing the button. */
const USER_HANGUP: SentHangupReason = 'user_hangup'
