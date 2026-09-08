import {
  mediaDevices,
  MediaStream,
  MediaStreamTrack,
  RTCIceCandidate,
  RTCPeerConnection,
  RTCSessionDescription,
} from 'react-native-webrtc'

import type { IceConfig, IceTransportPolicy } from '../calls/ice'
import type {
  AudioTrackLike,
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
 * written against `PeerConnectionLike` and `AudioTrackLike`.
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

/** WebRTC's word for what `ice.ts` calls `relay-only`. */
function relayPolicy(policy: IceTransportPolicy): 'relay' {
  switch (policy) {
    case 'relay-only':
      return 'relay'
  }
}

/**
 * The native track behind an `AudioTrackLike`.
 *
 * `addAudio` is handed the thing `captureAudio` returned, and needs the
 * library object inside it. A `WeakMap` rather than a field, because the
 * port's shape is `media.ts`'s and adding a library-typed field to it would
 * put `react-native-webrtc` back in the module this file exists to keep it
 * out of.
 */
const behind = new WeakMap<AudioTrackLike, MediaStreamTrack>()

/**
 * The stream a captured track belongs to.
 *
 * `addTrack` wants one: a track with no stream negotiates, but the peer
 * receives it with no `MediaStream` to attach, and on some stacks that is a
 * call where nobody can hear anything.
 */
const streamOf = new WeakMap<AudioTrackLike, MediaStream>()

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
    addAudio: track => {
      const native = behind.get(track)
      const stream = streamOf.get(track)
      if (native === undefined || stream === undefined) {
        // A track this adapter did not make. Throwing reaches `place()` as a
        // call that could not be placed, which is the truth; doing nothing
        // would give a connected call that carries silence, and silence is
        // the one failure nobody can tell from a working call.
        throw new Error('audio track was not captured by this media adapter')
      }
      pc.addTrack(native, stream)
    },
    close: () => pc.close(),
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

  pc.onconnectionstatechange = () => {
    const state = reportable(pc.connectionState)
    if (state !== null) like.onConnectionState?.(state)
  }

  return like
}

async function captureAudio(): Promise<AudioTrackLike> {
  // Audio only, and no constraints beyond it: this lot is an audio call, and
  // asking for a camera the interface never shows would light an indicator
  // on somebody's telephone for a picture nobody sends.
  const stream = await mediaDevices.getUserMedia({ audio: true, video: false })
  const [track] = stream.getAudioTracks()
  if (track === undefined) {
    // The permission dialog was answered and the hardware still gave nothing.
    // Rejecting is what `captureAudio`'s contract asks for, and reaches a
    // screen as a call that was not placed.
    throw new Error('the microphone was opened and carried no audio track')
  }

  const like: AudioTrackLike = {
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
}
