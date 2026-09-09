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
 * # IT ADDS VIDEO NOW, AND THE PARAGRAPH THIS REPLACES WAS RIGHT
 *
 * It said: *"Audio, and no video transceiver at all. #88 says video is not
 * offered, and this does not offer it: capture asks for audio, and nothing
 * here ever adds a video track. That is stronger than a control that is
 * hidden -- there is no video to un-hide."*
 *
 * That was true of #88 and it was the right way to be true of it: a product
 * that hides a control still has the capability, and the capability is what
 * lights an indicator. What changed is not the argument but the scope --
 * §4.5 puts 1:1 video in V1, and the instance's own TURN was sized for it a
 * month before anything asked (`max-bps=400000`, "the product's ceiling is a
 * relayed 1:1 video call at ~3 Mbit/s per direction").
 *
 * So the rule the old paragraph protected survives in a narrower form, and
 * `captureVideo` below carries it: **the camera is captured at the moment
 * somebody asks for video and at no other**. An audio call never touches it.
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
  /** Attach a captured track, so the offer carries one to negotiate. */
  readonly addTrack: (kind: TrackKind, track: TrackLike) => void
  /**
   * Take one away again.
   *
   * DISABLING IS NOT ENOUGH, which is why this exists rather than a call to
   * `setEnabled(false)`. A disabled video track keeps its transceiver and
   * keeps sending -- black frames, or the last one, depending on the stack.
   * #202 is explicit that the far end must see an avatar and never a frozen
   * face, and that is only true once the track is gone from the connection
   * and the sides have renegotiated without it.
   */
  readonly removeTrack: (kind: TrackKind, track: TrackLike) => void
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

/**
 * A captured track, of either kind.
 *
 * It was `TrackLike` while there was only one kind. The shape never
 * cared: a microphone and a camera are both something you can silence and
 * something you must stop.
 */
export interface TrackLike {
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
  readonly captureAudio: () => Promise<TrackLike>
  /**
   * Capture the camera.
   *
   * ITS REJECTION MEANS SOMETHING ELSE ENTIRELY. Without a microphone there
   * is no call, so `captureAudio` rejecting is a call that cannot be placed.
   * Without a camera there is still a whole call -- so this rejecting leaves
   * the audio alone and the screen says the picture did not come. Failing a
   * conversation because an image is missing would punish somebody for
   * saying no to an optional request. #199.
   */
  readonly captureVideo: () => Promise<TrackLike>
  /** Told when the camera refused, so a silent decision leaves a trace. */
  readonly onCameraRefused?: (cause: unknown) => void
  /**
   * Front camera to back and back again, on a track already captured.
   *
   * A port rather than a method on `TrackLike`, because switching is the one
   * thing this layer asks of a track that is not "silence it" or "stop it" --
   * and the two devices behind it are a fact about hardware, which is
   * exactly what a port is for. Absent on a platform that cannot.
   */
  readonly switchCamera?: (track: TrackLike) => void
}

/** Which of the two. Named, so `addTrack` cannot be given the wrong one silently. */
export type TrackKind = 'audio' | 'video'

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
  /**
   * The caller's offer. Starts capture and gathering.
   *
   * `video` opens the camera as well as the microphone. A camera that
   * refuses leaves the call whole and audio-only -- see `captureVideo`.
   */
  readonly offer: (wants?: Wants) => Promise<SessionDescription>
  /**
   * The callee's answer to a remote offer. Starts capture and gathering.
   *
   * `video` is what THIS side sends back, and it is not implied by what was
   * offered: answering a video call without a picture is a whole gesture
   * (#200), and the caller keeps sending theirs either way.
   */
  readonly answer: (
    remote: SessionDescription,
    wants?: Wants,
  ) => Promise<SessionDescription>
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
  /** Whether this side is sending a picture. */
  readonly sendingVideo: () => boolean
  /**
   * Turns this side's camera on or off during a call.
   *
   * Answers **the offer to renegotiate with**, or `null` when nothing
   * changed -- already in that state, or a camera that would not open. The
   * caller sends it; this module does not know what a Matrix event is.
   *
   * A CAMERA THAT REFUSES ANSWERS `null` RATHER THAN THROWING, exactly as
   * `captureVideo` does at the start of a call: the call is whole either
   * way, and `sendingVideo()` afterwards is what a screen draws from.
   */
  readonly setCameraOn: (on: boolean) => Promise<SessionDescription | null>
  /**
   * Front to back and back again. Costs no renegotiation: the track stays,
   * only what it points at changes.
   */
  readonly switchCamera: () => void
  /** Tear down: tracks stopped, connection closed, buffers dropped. */
  readonly stop: () => void
}

/** What a side asks to send. Absent means audio, which is every audio call. */
export interface Wants {
  readonly video?: boolean
}

export function startCallMedia(
  ports: MediaPorts,
  config: IceConfig,
  listener: MediaListener,
): CallMedia {
  let connection: PeerConnectionLike | undefined
  let track: TrackLike | undefined
  let camera: TrackLike | undefined
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

  /**
   * Opens the camera, and does not fail the call if it will not open.
   *
   * `media.ts`'s own note on `captureVideo` says why: without a microphone
   * there is no call, and without a camera there is still a whole one. So
   * the refusal is swallowed here rather than propagated, and
   * `sendingVideo()` afterwards is what tells a screen the picture did not
   * come.
   */
  async function captureCamera(pc: PeerConnectionLike): Promise<void> {
    if (camera !== undefined) return
    let captured: TrackLike
    try {
      captured = await ports.captureVideo()
    } catch (cause: unknown) {
      // SWALLOWED, AND SAID. Swallowing is the decision -- a camera that
      // will not open leaves a whole call standing -- but a failure with no
      // trace at all is what made a missing picture take an hour to explain
      // on 9 September, when the cause turned out to be somewhere else
      // entirely. `onCameraRefused` is a report, never a failure.
      ports.onCameraRefused?.(cause)
      return
    }
    // Between the await and here somebody may have hung up. The same window
    // the microphone has, and the same answer: stop it, or the camera
    // indicator stays lit on a call that has ended.
    if (stopped) {
      captured.stop()
      return
    }
    camera = captured
    pc.addTrack('video', captured)
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
    pc.addTrack('audio', captured)
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
    offer: async wants => {
      const pc = connect()
      await capture(pc)
      if (wants?.video === true) await captureCamera(pc)
      const description = await pc.createOffer()
      await pc.setLocalDescription(description)
      await drainWaiting(pc)
      return description
    },

    answer: async (remote, wants) => {
      const pc = connect()
      // The remote description first: the answer has to be produced against
      // what was offered, and a candidate applied before it has nothing to
      // attach to.
      await pc.setRemoteDescription(remote)
      await capture(pc)
      if (wants?.video === true) await captureCamera(pc)
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

    setCameraOn: async on => {
      // Nothing to renegotiate when the call is already in that state. Said
      // here rather than at the screen, so a double press costs nothing
      // rather than costing an offer.
      if (on === (camera !== undefined)) return null
      const pc = connect()
      if (on) {
        await captureCamera(pc)
        // The camera refused. `captureCamera` has already reported it and
        // swallowed it; there is simply nothing to offer.
        if (camera === undefined) return null
      } else {
        const going = camera
        camera = undefined
        if (going !== undefined) {
          pc.removeTrack('video', going)
          // Stopped after it leaves the connection, not before: a track
          // stopped while still attached is the frozen-face case #202
          // refuses, for the window between the two.
          going.stop()
        }
      }
      const description = await pc.createOffer()
      await pc.setLocalDescription(description)
      return description
    },

    switchCamera: () => {
      if (camera !== undefined) ports.switchCamera?.(camera)
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

    sendingVideo: () => camera !== undefined,

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
      // The camera too, and this is the one that shows: a call that ends
      // with the indicator still lit is the failure this whole module is
      // careful about.
      camera?.stop()
      camera = undefined
      connection?.close()
      connection = undefined
    },
  }
}
