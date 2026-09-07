import type { IceConfig } from './ice'
import type { Candidate, SessionDescription } from './wire'

/**
 * The media half of a call: one peer connection, one audio track, and the
 * two buffers that exist because ICE does not wait for the protocol.
 *
 * # It names no library, and that is the point
 *
 * `react-native-webrtc` is a native module: importing it here would make
 * every test in this file need a device, which is exactly what the machine
 * and the transport were written to avoid. So this takes ports -- a function
 * that builds a connection, a function that captures audio -- and the
 * application passes the library's while a test passes a fake. The module
 * below is the *decisions*; the library is a detail two files away.
 *
 * # Audio, and no video transceiver at all
 *
 * #88 says video is not offered, and this does not offer it: capture asks
 * for audio, and nothing here ever adds a video track. That is stronger than
 * a control that is hidden -- there is no video to un-hide.
 *
 * Renegotiation still exists, because the *peer* may offer one and the
 * specification requires an answer. Answering a renegotiation that adds
 * video yields an answer with no video to send, which is the honest reply.
 *
 * # The two buffers, and why each has to be there
 *
 * **Ours, gathered too early.** ICE begins gathering the moment the local
 * description is set -- which happens inside `offer()` and `answer()`,
 * before the caller has had a chance to hand the result to the transport.
 * The machine refuses `sendCandidates` outside a live call, so a candidate
 * emitted in that window would be dropped or would throw. They are held
 * until `open()` says the call exists.
 *
 * **Theirs, arriving too early.** On the glare path the machine can deliver
 * remote candidates alongside the invite, before this side has built a
 * connection at all -- the connection is built by the answer being produced.
 * They are held until there is something to apply them to.
 *
 * Both were found in the previous implementation's engine, where each cost
 * its own debugging session. They are carried across rather than
 * rediscovered.
 */

/** What this needs from a peer connection, and nothing more. */
export interface PeerConnectionLike {
  readonly createOffer: () => Promise<SessionDescription>
  readonly createAnswer: () => Promise<SessionDescription>
  readonly setLocalDescription: (
    description: SessionDescription,
  ) => Promise<void>
  readonly setRemoteDescription: (
    description: SessionDescription,
  ) => Promise<void>
  readonly addIceCandidate: (candidate: Candidate) => Promise<void>
  /** Attach the captured audio, so the offer carries a track to negotiate. */
  readonly addAudio: (track: AudioTrackLike) => void
  readonly close: () => void
  /** Each locally gathered candidate. An empty `candidate` ends the gathering. */
  onCandidate?: (candidate: Candidate) => void
  /** The connection's own view of whether media can flow. */
  onConnectionState?: (state: MediaConnectionState) => void
}

/**
 * The states this reacts to, which are fewer than WebRTC publishes.
 *
 * `new` and `closed` are not here: the first says nothing has happened yet
 * and the second is this module's own doing. What the call cares about is
 * whether media flows, whether it stopped, and whether it will never flow.
 */
export type MediaConnectionState =
  'connecting' | 'connected' | 'disconnected' | 'failed'

export interface AudioTrackLike {
  /** Set the track's enabled flag and answer what it holds afterwards. */
  readonly setEnabled: (enabled: boolean) => boolean
  readonly stop: () => void
}

/** The functions the media layer is built from. It builds no library object itself. */
export interface MediaPorts {
  readonly createConnection: (config: IceConfig) => PeerConnectionLike
  /**
   * Capture the microphone.
   *
   * Rejects when the person refused permission or the hardware is busy --
   * both of which are a call that cannot be placed, and both of which reach
   * a screen as a failure rather than as a call that silently never
   * connects.
   */
  readonly captureAudio: () => Promise<AudioTrackLike>
}

/** What the media layer tells the transport. Every one of these is a report. */
export interface MediaListener {
  /** Candidates gathered locally, once the call is live enough to carry them. */
  readonly onCandidates: (candidates: readonly Candidate[]) => void
  readonly onConnected: () => void
  /** Lost on a call that was up. Not terminal: the machine gives it a window. */
  readonly onDisconnected: () => void
  readonly onReconnected: () => void
  readonly onFailed: () => void
}

export interface CallMedia {
  /** The caller's offer. Starts capture and gathering. */
  readonly offer: () => Promise<SessionDescription>
  /** The callee's answer to a remote offer. Starts capture and gathering. */
  readonly answer: (remote: SessionDescription) => Promise<SessionDescription>
  /** The caller applies the answer it selected. */
  readonly applyAnswer: (remote: SessionDescription) => Promise<void>
  /** Remote candidates, buffered when there is nothing to apply them to yet. */
  readonly addRemoteCandidates: (
    candidates: readonly Candidate[],
  ) => Promise<void>
  /** Answer the peer's renegotiation offer, per the specification's must. */
  readonly answerRenegotiation: (
    remote: SessionDescription,
  ) => Promise<SessionDescription>
  /** Apply the peer's answer to a renegotiation we offered. */
  readonly applyRenegotiationAnswer: (
    remote: SessionDescription,
  ) => Promise<void>
  /**
   * The call is live: locally gathered candidates may now be sent, and the
   * ones held since the description was set go out at once.
   */
  readonly open: () => void
  /**
   * Mute or unmute, answering **what the track holds afterwards**.
   *
   * Not what was asked. A toggle that publishes its own intent draws a
   * muted microphone that is still recording the room, which is the worst
   * failure this control has. Carried over from the previous
   * implementation, where the mute half honoured this and the speaker half
   * did not, and a review caught it.
   */
  readonly setMuted: (muted: boolean) => boolean
  readonly muted: () => boolean
  /** Tear down: track stopped, connection closed, buffers dropped. */
  readonly stop: () => void
}

export function startCallMedia(
  ports: MediaPorts,
  config: IceConfig,
  listener: MediaListener,
): CallMedia {
  let connection: PeerConnectionLike | undefined
  let track: AudioTrackLike | undefined
  let muted = false
  let stopped = false

  // Ours, gathered before the call could carry them. See the module note.
  let holding: Candidate[] = []
  let open = false
  // Theirs, arrived before there was a connection to apply them to.
  const waiting: Candidate[] = []
  // Whether media has ever flowed. A drop before the first connection is a
  // call that never worked, which is `failed`; a drop after one is
  // `disconnected`, which the machine gives a reconnection window.
  let flowed = false

  function connect(): PeerConnectionLike {
    if (connection !== undefined) return connection
    const made = ports.createConnection(config)
    made.onCandidate = candidate => {
      // AFTER `stop`, THIS IS NOT AN ERROR. The window between a call ending
      // and the connection closing is real, and a candidate landing in it
      // must go nowhere quietly -- this runs on the library's own callback,
      // where a throw belongs to nobody.
      if (stopped) return
      if (open) listener.onCandidates([candidate])
      else holding.push(candidate)
    }
    made.onConnectionState = state => {
      if (stopped) return
      if (state === 'connected') {
        if (flowed) listener.onReconnected()
        else {
          flowed = true
          listener.onConnected()
        }
        return
      }
      if (state === 'disconnected') {
        // Only if it ever worked. Otherwise there is nothing to reconnect to
        // and the machine would wait out a window for a call that never was.
        if (flowed) listener.onDisconnected()
        return
      }
      if (state === 'failed') listener.onFailed()
    }
    connection = made
    return made
  }

  async function capture(pc: PeerConnectionLike): Promise<void> {
    if (track !== undefined) return
    const captured = await ports.captureAudio()
    // Between the await and here somebody may have hung up. Stopping the
    // track is what releases the microphone; leaving it running would light
    // the recording indicator on a call that has ended.
    if (stopped) {
      captured.stop()
      return
    }
    track = captured
    // The mute state survives a renegotiation, so it is applied to the track
    // rather than assumed to be false on a fresh one.
    if (muted) captured.setEnabled(false)
    pc.addAudio(captured)
  }

  async function drainWaiting(pc: PeerConnectionLike): Promise<void> {
    while (waiting.length > 0) {
      const candidate = waiting.shift()
      if (candidate === undefined) continue
      // One rejection does not cost the others: candidates are independent,
      // and ICE only needs one path to work.
      await pc.addIceCandidate(candidate).catch(() => undefined)
    }
  }

  return {
    offer: async () => {
      const pc = connect()
      await capture(pc)
      const description = await pc.createOffer()
      await pc.setLocalDescription(description)
      await drainWaiting(pc)
      return description
    },

    answer: async remote => {
      const pc = connect()
      // The remote description first: the answer has to be produced against
      // what was offered, and a candidate applied before it has nothing to
      // attach to.
      await pc.setRemoteDescription(remote)
      await capture(pc)
      const description = await pc.createAnswer()
      await pc.setLocalDescription(description)
      await drainWaiting(pc)
      return description
    },

    applyAnswer: async remote => {
      const pc = connect()
      await pc.setRemoteDescription(remote)
      await drainWaiting(pc)
    },

    addRemoteCandidates: async candidates => {
      if (stopped) return
      const pc = connection
      if (pc === undefined) {
        // The glare path: the machine delivers these with the invite, and
        // this side builds its connection when it produces the answer.
        waiting.push(...candidates)
        return
      }
      for (const candidate of candidates) {
        await pc.addIceCandidate(candidate).catch(() => undefined)
      }
    },

    answerRenegotiation: async remote => {
      const pc = connect()
      await pc.setRemoteDescription(remote)
      const description = await pc.createAnswer()
      await pc.setLocalDescription(description)
      return description
    },

    applyRenegotiationAnswer: async remote => {
      const pc = connect()
      await pc.setRemoteDescription(remote)
    },

    open: () => {
      open = true
      if (holding.length === 0) return
      const held = holding
      // Cleared before the callback, not after: the listener sends, and a
      // send that throws must not leave the same candidates queued to go a
      // second time.
      holding = []
      listener.onCandidates(held)
    },

    setMuted: next => {
      muted = next
      const held = track
      if (held === undefined) {
        // Nothing captured yet. The intent is remembered and applied when
        // the track arrives, and reporting it is honest: there is no
        // hardware to disagree with.
        return next
      }
      // `enabled` is what the track holds; `muted` is what a screen draws.
      // They are the same thing read from opposite ends, and this reads the
      // hardware's end.
      muted = !held.setEnabled(!next)
      return muted
    },

    muted: () => muted,

    stop: () => {
      stopped = true
      holding = []
      waiting.length = 0
      track?.stop()
      track = undefined
      connection?.close()
      connection = undefined
    },
  }
}
