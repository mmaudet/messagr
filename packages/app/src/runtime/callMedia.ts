import {
  mediaDevices,
  MediaStream,
  MediaStreamTrack,
  RTCIceCandidate,
  RTCPeerConnection,
  RTCSessionDescription,
} from 'react-native-webrtc'

import { logEvent } from './log'
import type { IceConfig, IceTransportPolicy } from '../calls/ice'
import type {
  TrackLike,
  MediaConnectionState,
  MediaPorts,
  PeerConnectionLike,
} from '../calls/media'
import type { Candidate, SessionDescription } from '../calls/wire'

/**
 * The one file allowed to name `react-native-webrtc`.
 *
 * `media.ts` says why it is not this file: importing a native module there
 * would make the buffering rules -- the part with the bugs in it -- testable
 * only on a device. So the library lives here, behind the same kind of seam
 * `cryptoPump.ts` puts around the crypto bridge, and everything above it is
 * written against `PeerConnectionLike` and `TrackLike`.
 *
 * Which means this file has no tests, and that is the trade: it is the
 * translation layer, so what belongs in it is only the translation. Anything
 * here that starts making a decision belongs upstairs where it can be
 * tested.
 *
 * # RELAY-ONLY IS TRANSLATED, NOT ASSUMED
 *
 * `ice.ts` makes the policy a union with one member so that no other policy
 * is expressible, and argues that a second one would be added there, in the
 * type, "where every place that reads it stops compiling until it has been
 * thought about". `relayPolicy` below is one of those places: it is a total
 * switch, so the day `'relay-only'` gains a sibling this file fails to
 * compile rather than quietly sending host candidates.
 */

/**
 * What this device promises never to exceed, per direction.
 *
 * The instance's coturn allows `max-bps=400000` -- 3.2 Mbit/s -- and its
 * configuration says why: *"the product's ceiling is a relayed 1:1 video call
 * at ~3 Mbit/s per direction"*. Half of that leaves room for the audio, the
 * retransmissions and the relay's own framing, and 1.2 Mbit/s is a decent
 * 720p.
 *
 * A NUMBER TO MEASURE, NOT TO BELIEVE. #199 asks for this compared against
 * 2.5 Mbit/s on a real call between two telephones, because nobody can pick
 * it from a desk -- only check it from a Pixel.
 */
const VIDEO_CEILING_BPS = 1_200_000

/** WebRTC's word for what `ice.ts` calls `relay-only`. */
function relayPolicy(policy: IceTransportPolicy): 'relay' {
  switch (policy) {
    case 'relay-only':
      return 'relay'
  }
}

/**
 * The native track behind an `TrackLike`.
 *
 * `addAudio` is handed the thing `captureAudio` returned, and needs the
 * library object inside it. A `WeakMap` rather than a field, because the
 * port's shape is `media.ts`'s and adding a library-typed field to it would
 * put `react-native-webrtc` back in the module this file exists to keep it
 * out of.
 */
const behind = new WeakMap<TrackLike, MediaStreamTrack>()

/**
 * The stream a captured track belongs to.
 *
 * `addTrack` wants one: a track with no stream negotiates, but the peer
 * receives it with no `MediaStream` to attach, and on some stacks that is a
 * call where nobody can hear anything.
 */
const streamOf = new WeakMap<TrackLike, MediaStream>()

/**
 * What the connection reports, in the vocabulary the call speaks.
 *
 * `new` and `closed` are dropped rather than mapped: `media.ts` says why --
 * the first is "nothing has happened yet" and the second is this
 * application's own doing, and neither is news about whether media flows.
 */
function reportable(state: string): MediaConnectionState | null {
  switch (state) {
    case 'connecting':
      return 'connecting'
    case 'connected':
      return 'connected'
    case 'disconnected':
      return 'disconnected'
    case 'failed':
      return 'failed'
    default:
      return null
  }
}

function described(description: unknown): SessionDescription {
  const answer = description as { type?: unknown; sdp?: unknown }
  return {
    type: typeof answer.type === 'string' ? answer.type : '',
    sdp: typeof answer.sdp === 'string' ? answer.sdp : '',
  }
}

/**
 * The two pictures a call screen draws, as handles `RTCView` understands.
 *
 * # WHY THEY COME OUT THIS WAY AND NOT THROUGH `media.ts`
 *
 * `media.ts` is pure and knows nothing of `MediaStream`, `RTCView` or the
 * string those two agree on -- that is the whole point of the ports, and
 * threading a rendering handle through them would put a react-native-webrtc
 * concept into a module that is tested without a device.
 *
 * So the handles leave from here, which is already the only file that
 * imports the library. A screen subscribes, and a call publishes.
 *
 * # ONE SUBSCRIBER, BECAUSE THERE IS ONE CALL
 *
 * A module-level watcher rather than one per connection: this application
 * refuses a second call while one is up, so "the pictures" is a fact about
 * the device rather than about a particular connection. `callPump.ts` holds
 * the one subscription and the screen reads it from there.
 */
export interface Pictures {
  /** This side's own camera, or `null` while it is not sending one. */
  readonly local: string | null
  /** The far end's, or `null` until a track arrives. */
  readonly remote: string | null
}

let pictures: Pictures = { local: null, remote: null }
let watcher: ((pictures: Pictures) => void) | null = null

function publish(next: Pictures): void {
  pictures = next
  watcher?.(next)
}

/** Replaces the previous watcher: there is one call, so there is one screen. */
export function watchPictures(
  onPictures: (pictures: Pictures) => void,
): () => void {
  watcher = onPictures
  onPictures(pictures)
  return () => {
    if (watcher === onPictures) watcher = null
  }
}

function connectionFor(config: IceConfig): PeerConnectionLike {
  const pc = new RTCPeerConnection({
    iceServers: [
      {
        urls: [...config.uris],
        username: config.username,
        credential: config.credential,
      },
    ],
    iceTransportPolicy: relayPolicy(config.transportPolicy),
  })

  const like: PeerConnectionLike = {
    createOffer: async () => described(await pc.createOffer({})),
    createAnswer: async () => described(await pc.createAnswer()),
    setLocalDescription: async description => {
      await pc.setLocalDescription(new RTCSessionDescription(description))
    },
    setRemoteDescription: async description => {
      await pc.setRemoteDescription(new RTCSessionDescription(description))
    },
    addIceCandidate: async candidate => {
      await pc.addIceCandidate(new RTCIceCandidate(candidate))
    },
    addTrack: (kind, track) => {
      const native = behind.get(track)
      const stream = streamOf.get(track)
      if (native === undefined || stream === undefined) {
        // A track this adapter did not make. Throwing reaches `place()` as a
        // call that could not be placed, which is the truth; doing nothing
        // would give a connected call that carries silence, and silence is
        // the one failure nobody can tell from a working call.
        throw new Error(`${kind} track was not captured by this media adapter`)
      }
      const sender = pc.addTrack(native, stream)
      if (kind === 'video') publish({ ...pictures, local: stream.toURL() })
      // THE CEILING, APPLIED HERE BECAUSE NOWHERE ELSE CAN.
      //
      // The relay allows `max-bps=400000` -- 3.2 Mbit/s a direction -- and
      // coturn at its ceiling **drops**, which is indistinguishable from a
      // bad network and would cost a day to diagnose. Telling the sender
      // instead makes WebRTC drop resolution, which looks like a softer
      // picture and says so honestly.
      //
      // The sender used to be discarded here, so there was no seam at all.
      // `VIDEO_CEILING_BPS` is the one place the number lives.
      if (kind === 'video' && sender !== undefined) {
        const parameters = sender.getParameters()
        const first = parameters.encodings?.[0]
        if (first !== undefined) {
          first.maxBitrate = VIDEO_CEILING_BPS
          // Never awaited by the caller: a ceiling that could not be set is
          // a call that still works, at a bitrate coturn will police less
          // kindly. Saying so beats failing the call over it.
          sender.setParameters(parameters).catch(() => undefined)
        }
      }
    },
    close: () => {
      // BEFORE THE CONNECTION GOES, not after: a screen still drawing a
      // handle whose stream has been released renders whatever the native
      // side last held, which on a call that just ended is the other
      // person's face, frozen.
      publish({ local: null, remote: null })
      pc.close()
    },
  }

  // The `on*` setters rather than `addEventListener`: the library's own
  // typings expose these and not the other, and one listener per event is
  // all this adapter wants anyway.
  pc.onicecandidate = (event: unknown) => {
    const found = (event as { candidate: RTCIceCandidate | null }).candidate
    // `null` is the end of gathering, which version 1 carries as an
    // `m.call.candidates` with an empty `candidate` -- `wire.ts` says so, and
    // `media.ts` forwards it like any other.
    like.onCandidate?.(
      found === null
        ? { candidate: '' }
        : ({
            candidate: found.candidate,
            ...(found.sdpMid === null ? {} : { sdpMid: found.sdpMid }),
            ...(found.sdpMLineIndex === null
              ? {}
              : { sdpMLineIndex: found.sdpMLineIndex }),
          } satisfies Candidate),
    )
  }

  // THE FAR END'S PICTURE. Only video: an audio track arrives here too, and
  // it has nothing to draw.
  pc.ontrack = (event: unknown) => {
    const arrived = event as {
      track?: { kind?: string }
      streams?: readonly MediaStream[]
    }
    if (arrived.track?.kind !== 'video') return
    const stream = arrived.streams?.[0]
    if (stream === undefined) return
    publish({ ...pictures, remote: stream.toURL() })
  }

  pc.onconnectionstatechange = () => {
    const state = reportable(pc.connectionState)
    if (state !== null) like.onConnectionState?.(state)
  }

  return like
}

async function captureAudio(): Promise<TrackLike> {
  // AUDIO ONLY, AND THAT IS STILL TRUE OF THIS FUNCTION. It used to say the
  // reason was that the lot had no video at all -- "asking for a camera the
  // interface never shows would light an indicator on somebody's telephone
  // for a picture nobody sends". The lot has video now (§4.5, #199), and the
  // rule survives in the narrower form that always mattered: the camera is
  // opened by `captureVideo` at the moment somebody asks for a picture, and
  // an audio call never touches it.
  const stream = await mediaDevices.getUserMedia({ audio: true, video: false })
  const [track] = stream.getAudioTracks()
  if (track === undefined) {
    // The permission dialog was answered and the hardware still gave nothing.
    // Rejecting is what `captureAudio`'s contract asks for, and reaches a
    // screen as a call that was not placed.
    throw new Error('the microphone was opened and carried no audio track')
  }
  return trackLike(track, stream)
}

/**
 * The camera, front by default.
 *
 * `facingMode: 'user'` rather than a device identifier: a call starts on the
 * camera pointing at the person, and which hardware that is depends on the
 * telephone. Switching to the other one is `applyConstraints`, and it is
 * #201's business rather than this ticket's.
 *
 * ITS REJECTION IS NOT A FAILED CALL. `media.ts` says why: without a
 * microphone there is no call, and without a camera there is still a whole
 * one.
 */
async function captureVideo(): Promise<TrackLike> {
  const stream = await mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: 'user' },
  })
  const [track] = stream.getVideoTracks()
  if (track === undefined) {
    throw new Error('the camera was opened and carried no video track')
  }
  return trackLike(track, stream)
}

/** The two captures differ in what they ask for and in nothing after it. */
function trackLike(track: MediaStreamTrack, stream: MediaStream): TrackLike {
  const like: TrackLike = {
    setEnabled: enabled => {
      track.enabled = enabled
      // Answering the track rather than the argument: `setMuted` reports what
      // the microphone actually holds, and a track that refused is a mute
      // that did not happen.
      return track.enabled
    },
    stop: () => {
      // Both, and in this order. Stopping the track releases the hardware;
      // releasing the stream is what takes the recording indicator off some
      // versions of Android, which keep it lit for a stream with no live
      // tracks left in it.
      track.stop()
      stream.release()
    },
  }
  behind.set(like, track)
  streamOf.set(like, stream)
  return like
}

/** The media half of a call, bound to the device. */
export const deviceMedia: MediaPorts = {
  createConnection: connectionFor,
  captureAudio,
  captureVideo,
  onCameraRefused: cause =>
    logEvent('warn', 'MESSAGR_CAMERA_REFUSED', {
      reason: cause instanceof Error ? cause.message : String(cause),
    }),
}
