// Type-only for the crypto package, as everywhere it is named outside
// `cryptoPump.ts`; the functions themselves come through `encryptingDeps`.
import type { createClient } from 'matrix-js-sdk'

import { openCallEvents } from '../calls/inbox'
import type { CallState } from '../calls/machine'
import { fetchTurnServer } from '../calls/ice'
import {
  CallSessionError,
  startCallSession,
  type CallSession,
  type CallSessionConfig,
  type CallSessionFailure,
} from '../calls/session'
import type { CallEvent } from '../calls/wire'
import { deviceCallAudio } from './callAudio'
import { deviceMedia } from './callMedia'
import { encryptingDeps } from './cryptoPump'
import { sendIntoScope } from './encryptAndSend'
import { logEvent } from './log'
import { makePumpHttp } from './pump'
import type { SyncTick } from './syncLoop'

/**
 * Phase eleven: a call, bound to a real homeserver and a real telephone.
 *
 * Pure glue, like every other phase here. What a call *is* -- the state
 * machine, the wire format, the relay policy, the two buffers ICE forces on
 * anybody who implements this -- lives under `src/calls/`, tested against
 * injected fakes with no homeserver and no microphone in sight. This file is
 * the four wires between that and the world:
 *
 *   1. the relay credentials, from the homeserver;
 *   2. the outgoing `m.call.*`, sealed and put in the conversation;
 *   3. the incoming `m.call.*`, opened out of the sync the loop already ran;
 *   4. the microphone and the peer connection, from `callMedia.ts`.
 *
 * # THE SIGNALLING IS ENCRYPTED, AND THAT IS NOT DECORATION
 *
 * `session.ts` asks for it and the specification says why: a `party_id`
 * identifies which of somebody's devices is on a call, and in an unencrypted
 * room that is disclosed to anybody who can read the timeline. So the events
 * go through `sendIntoScope` -- the same door a message goes through, with
 * the same key sharing in front of it -- rather than through a plain
 * `PUT .../send/`.
 *
 * Which is also why receiving costs a decryption: what arrives in the sync is
 * `m.room.encrypted`, and only after opening it does anybody know it was a
 * call at all.
 */

export interface DeviceCall {
  readonly session: CallSession
  /**
   * Hand one completed poll to the call.
   *
   * Everything this conversation carried is opened, and what turns out to be
   * `m.call.*` goes to the session in the order it arrived. Anything else --
   * a message, a reaction, a photograph -- is somebody else's business and is
   * dropped here rather than decrypted twice.
   */
  readonly deliver: (tick: SyncTick) => Promise<void>
}

/**
 * A call in `scope`, with everything bound to the device.
 *
 * Nothing is placed or answered by starting one: the session is created idle
 * and the caller decides. That is what lets the same construction serve a
 * call this device places and a call it is about to be told about.
 */
export function startDeviceCall(
  sessionClient: ReturnType<typeof createClient>,
  scope: string,
  config: CallSessionConfig,
  onState: (state: CallState) => void,
): DeviceCall {
  const deps = encryptingDeps(sessionClient)
  const http = makePumpHttp(sessionClient)

  const session = startCallSession(
    {
      sendCallEvent: async (event: CallEvent) => {
        const sent = await sendIntoScope(deps, scope, event.type, {
          ...event.content,
        })
        if (!sent.sent) {
          // Thrown rather than swallowed: `session.ts` treats a send that
          // did not happen as a call that did not happen, and a hangup
          // nobody received leaves a telephone ringing for ninety seconds.
          throw new Error(sent.reason)
        }
      },
      turnServer: () => fetchTurnServer(http),
      media: deviceMedia,
      now: () => Date.now(),
      // Unique per call, which is what a `call_id` has to be. The peer only
      // ever compares it with the one it was given.
      newCallId: () =>
        `messagr-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      repeat: (everyMs, run) => {
        const ticking = setInterval(run, everyMs)
        return () => clearInterval(ticking)
      },
      onState: state => {
        // Logged as well as reported. A call is the one thing in this
        // product that fails in a way nobody can see from the outside --
        // silence looks exactly like a working call -- so every transition
        // is on the record whether or not a screen was listening.
        logEvent('info', 'MESSAGR_CALL_STATE', { ...state })
        onState(state)
      },
    },
    config,
  )

  return {
    session,
    deliver: async (tick: SyncTick) => {
      const carried = tick.timelineEvents.get(scope)
      if (carried === undefined) return
      const opened = await openCallEvents(deps, scope, carried)
      if (opened.length > 0) session.receive(opened)
    },
  }
}

/**
 * At most one call, for as long as the application is open.
 *
 * # ONE, BECAUSE A 1:1 CALL IS ONE
 *
 * Two calls at once is a product decision nobody has taken and a screen
 * nobody has drawn. Holding exactly one here means the question cannot be
 * asked by accident: a second invitation while a call is running is refused
 * by the machine, which is where that rule belongs.
 *
 * # A CALL CAN START WITHOUT ANYBODY ASKING FOR ONE
 *
 * The obvious shape -- build a session when somebody presses the button --
 * only serves the caller. The callee's application has no session until it
 * has been rung, and the ring arrives inside an encrypted event in a poll.
 * So every poll is looked at: if it carries an invite and there is no call,
 * one is started to receive it.
 *
 * Which costs a decryption pass over the events a poll carried. Small beside
 * what the same tick already does -- the list re-derives every conversation,
 * a round trip each -- and it is the price of a telephone that rings.
 */
export interface CallRuntime {
  /** Hand it one completed poll. Starts a call if the poll is a ring. */
  readonly deliver: (tick: SyncTick) => Promise<void>
  /** Places a call. Rejects with `CallSessionError` when it cannot be placed. */
  readonly place: (scope: string, peerUserId: string) => Promise<void>
  readonly answer: () => Promise<void>
  readonly reject: () => void
  readonly hangup: () => void
  readonly setMuted: (muted: boolean) => boolean
  /** Moves the sound between the earpiece and the loudspeaker. */
  readonly setSpeaker: (on: boolean) => void
  /** Ends the call and forgets it, so the next one starts clean. */
  readonly release: () => Promise<void>
}

/** What a screen is drawn from: the call, and who it is with. */
export interface CallOnScreen {
  readonly scope: string
  readonly peerUserId: string
  readonly state: CallState
  /**
   * Why the call never started, when that is what happened.
   *
   * WITHOUT THIS THE SCREEN SAID "APPEL TERMINÉ". A call refused for want of
   * a relay never rang anybody, and telling the person it ended is telling
   * them the wrong thing about their own homeserver -- `ice.ts` argues that
   * the operator should learn a missing relay from an error rather than the
   * user learning it from a leak they cannot see, and an error nobody is
   * shown is not an error anybody learns from. Measured against
   * `messagr-fork.maudet.cloud`, which answers 404 there.
   */
  readonly failure?: CallSessionFailure
}

export function startCallRuntime(
  sessionClient: ReturnType<typeof createClient>,
  credentials: { readonly userId: string; readonly deviceId: string },
  onChanged: (call: CallOnScreen | null) => void,
): CallRuntime {
  const deps = encryptingDeps(sessionClient)
  let held: (DeviceCall & CallOnScreen) | null = null

  /**
   * Runs a gesture that can be refused, and keeps the refusal on the screen.
   *
   * `CallSessionError` is the one failure a person can act on -- no relay is
   * their operator's business, a microphone that will not open is theirs --
   * so it is recorded before it is re-thrown. Anything else is a fault, and
   * faults go to the log, not to somebody holding a telephone.
   */
  async function refusable(gesture: Promise<void>): Promise<void> {
    try {
      await gesture
    } catch (cause: unknown) {
      if (cause instanceof CallSessionError && held !== null) {
        held = { ...held, failure: cause.failure }
        onChanged({ ...held })
      }
      throw cause
    }
  }

  function begin(scope: string, peerUserId: string): DeviceCall & CallOnScreen {
    const started = startDeviceCall(
      sessionClient,
      scope,
      {
        ownUserId: credentials.userId,
        peerUserId,
        // The device id, which is what the specification suggests a party id
        // be: it is what tells this device's answer from another of the same
        // account's, and answering elsewhere is a state the machine has.
        ownPartyId: credentials.deviceId,
      },
      state => {
        if (held !== null) held = { ...held, state }
        onChanged(held === null ? null : { ...held })
      },
    )
    const call = {
      ...started,
      scope,
      peerUserId,
      state: started.session.state(),
    }
    held = call
    // THE AUDIO SESSION IS TAKEN WHEN THE CALL BEGINS, NOT WHEN IT CONNECTS.
    //
    // A ringing telephone is already a call as far as the device is
    // concerned: the proximity sensor has to be watching before somebody
    // lifts it to their ear, and the platform has to be in its communication
    // mode before the first packet rather than after it. Taking it at
    // `inCall` would put the first seconds of every call through the media
    // path -- loudspeaker, media volume, no echo canceller.
    //
    // MEASURED MISSING ONCE. This line was written and did not land, and
    // nothing failed: the call connected, carried audio, and `dumpsys audio`
    // said `MODE_NORMAL` with no mode owner while two people were talking.
    // That is the whole hazard of this dependency -- everything works
    // without it, slightly wrong, and only a platform dump says so.
    deviceCallAudio.begin()
    onChanged({ ...call })
    return call
  }

  return {
    deliver: async (tick: SyncTick) => {
      const running = held
      if (running !== null) {
        await running.deliver(tick)
        return
      }
      // Nothing is running, so the only event worth starting anything for is
      // an invitation. Everything else belongs to a call that has ended, and
      // a session built to receive a stray candidate would be a telephone
      // ringing at nobody.
      for (const [scope, carried] of tick.timelineEvents) {
        const opened = await openCallEvents(deps, scope, carried)
        // Only when the poll carried something sealed: a line per tick
        // saying "no call in this one" would bury every line that matters.
        if (opened.length > 0) {
          logEvent('info', 'MESSAGR_CALL_POLL', {
            scope,
            carried: carried.length,
            opened: opened.map(event => (event as { type: string }).type),
          })
        }
        const invite = opened.find(
          event => (event as { type?: unknown }).type === 'm.call.invite',
        )
        if (invite === undefined) continue
        const from = (invite as { sender: string }).sender
        // Our own invitation, echoed back by the poll that carried it. The
        // caller already has a session; starting a second one to be rung by
        // itself is the loop this guard exists to refuse.
        if (from === credentials.userId) continue
        begin(scope, from).session.receive(opened)
        return
      }
    },

    place: async (scope, peerUserId) => {
      if (held !== null) throw new Error('a call is already running')
      await refusable(begin(scope, peerUserId).session.place())
    },
    answer: async () => {
      const running = held
      if (running === null) return
      await refusable(running.session.answer())
    },
    reject: () => held?.session.reject(),
    hangup: () => held?.session.hangup(),
    setMuted: muted => held?.session.setMuted(muted) ?? muted,
    setSpeaker: on => deviceCallAudio.speaker(on),
    release: async () => {
      const running = held
      held = null
      onChanged(null)
      // Before the session stops, and unconditionally: giving the audio
      // session back is what returns the device to its ringer volume and
      // lets the screen lock again. A call that failed to tear down cleanly
      // must not leave a telephone that behaves as though it is still on
      // one.
      deviceCallAudio.end()
      await running?.session.stop()
    },
  }
}
