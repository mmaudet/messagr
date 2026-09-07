// Type-only for the crypto package, as everywhere it is named outside
// `cryptoPump.ts`; the functions themselves come through `encryptingDeps`.
import type { createClient } from 'matrix-js-sdk'

import { openCallEvents } from '../calls/inbox'
import type { CallState } from '../calls/machine'
import { fetchTurnServer } from '../calls/ice'
import {
  startCallSession,
  type CallSession,
  type CallSessionConfig,
} from '../calls/session'
import type { CallEvent } from '../calls/wire'
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
