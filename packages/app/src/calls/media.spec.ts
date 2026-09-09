import { describe, expect, it, vi } from 'vitest'

import type { IceConfig } from './ice'
import {
  startCallMedia,
  type TrackLike,
  type MediaConnectionState,
  type MediaListener,
  type PeerConnectionLike,
} from './media'
import type { Candidate, SessionDescription } from './wire'

/**
 * The media layer, tested without a device.
 *
 * That is what the ports are for. Every decision below is one this module
 * makes on its own -- when a candidate may go out, when a drop is a
 * reconnection and when it is a failure, what a mute toggle publishes -- and
 * none of them should need a telephone to catch.
 *
 * The two buffers get the most attention because they are the two things
 * that cost the previous implementation a debugging session each.
 */

const CONFIG: IceConfig = {
  uris: ['turn:relay.example.org:3478'],
  username: 'u',
  credential: 'c',
  transportPolicy: 'relay-only',
  ttlSeconds: 86400,
}

function description(type: string): SessionDescription {
  return { type, sdp: `v=0 ${type}` }
}

function candidate(name: string): Candidate {
  return { candidate: `candidate:${name}`, sdpMid: 'audio', sdpMLineIndex: 0 }
}

/** A peer connection that records what it was told and lets a test drive it. */
function fakeConnection(overrides: Partial<PeerConnectionLike> = {}) {
  const calls = {
    localDescriptions: [] as SessionDescription[],
    remoteDescriptions: [] as SessionDescription[],
    candidates: [] as Candidate[],
    audio: [] as TrackLike[],
    video: [] as TrackLike[],
    closed: 0,
    /** The order every call arrived in, which is what some rules are about. */
    order: [] as string[],
  }
  const pc: PeerConnectionLike = {
    createOffer: async () => {
      calls.order.push('createOffer')
      return description('offer')
    },
    createAnswer: async () => {
      calls.order.push('createAnswer')
      return description('answer')
    },
    setLocalDescription: async d => {
      calls.order.push('setLocal')
      calls.localDescriptions.push(d)
    },
    setRemoteDescription: async d => {
      calls.order.push('setRemote')
      calls.remoteDescriptions.push(d)
    },
    addIceCandidate: async c => {
      calls.order.push('addIceCandidate')
      calls.candidates.push(c)
    },
    addTrack: (kind, t) => {
      calls.order.push(kind === 'audio' ? 'addAudio' : 'addVideo')
      if (kind === 'audio') calls.audio.push(t)
      else calls.video.push(t)
    },
    close: () => {
      calls.closed += 1
    },
    ...overrides,
  }
  return { pc, calls }
}

function fakeTrack(answers?: (enabled: boolean) => boolean) {
  const held = { enabled: true, stopped: 0, asked: [] as boolean[] }
  const track: TrackLike = {
    setEnabled: enabled => {
      held.asked.push(enabled)
      held.enabled = answers ? answers(enabled) : enabled
      return held.enabled
    },
    stop: () => {
      held.stopped += 1
    },
  }
  return { track, state: held }
}

function fakeListener(): MediaListener & {
  readonly sent: Candidate[][]
  readonly events: string[]
} {
  const sent: Candidate[][] = []
  const events: string[] = []
  return {
    sent,
    events,
    onCandidates: cs => {
      sent.push([...cs])
    },
    onConnected: () => events.push('connected'),
    onDisconnected: () => events.push('disconnected'),
    onReconnected: () => events.push('reconnected'),
    onFailed: () => events.push('failed'),
  }
}

function build(options: {
  connection?: ReturnType<typeof fakeConnection>
  track?: ReturnType<typeof fakeTrack>
  captureRejects?: Error
  captureHangs?: boolean
  camera?: ReturnType<typeof fakeTrack>
  cameraRejects?: Error
}) {
  const connection = options.connection ?? fakeConnection()
  const track = options.track ?? fakeTrack()
  const camera = options.camera ?? fakeTrack()
  const listener = fakeListener()
  let release: (() => void) | undefined
  const media = startCallMedia(
    {
      createConnection: () => connection.pc,
      captureAudio: async () => {
        if (options.captureRejects !== undefined) throw options.captureRejects
        if (options.captureHangs === true) {
          await new Promise<void>(resolve => {
            release = resolve
          })
        }
        return track.track
      },
      captureVideo: async () => {
        if (options.cameraRejects !== undefined) throw options.cameraRejects
        return camera.track
      },
    },
    CONFIG,
    listener,
  )
  return {
    media,
    connection,
    track,
    camera,
    listener,
    release: () => release?.(),
  }
}

function state(
  connection: ReturnType<typeof fakeConnection>,
  next: MediaConnectionState,
) {
  connection.pc.onConnectionState?.(next)
}

describe('offer and answer', () => {
  it('captures audio, offers, and keeps its own description', async () => {
    const { media, connection, track } = build({})
    const offer = await media.offer()
    expect(offer.type).toBe('offer')
    expect(connection.calls.audio).toEqual([track.track])
    expect(connection.calls.localDescriptions).toEqual([offer])
  })

  it('sets the remote description before producing an answer', async () => {
    // Not a formality: an answer has to be produced against what was
    // offered, and a candidate applied before it has nothing to attach to.
    const { media, connection } = build({})
    await media.answer(description('offer'))
    expect(connection.calls.order.indexOf('setRemote')).toBeLessThan(
      connection.calls.order.indexOf('createAnswer'),
    )
  })

  it('builds exactly one connection across a whole call', async () => {
    const { media, connection } = build({})
    await media.offer()
    await media.applyAnswer(description('answer'))
    await media.addRemoteCandidates([candidate('a')])
    expect(connection.calls.closed).toBe(0)
    media.stop()
    expect(connection.calls.closed).toBe(1)
  })
})

describe('our candidates, gathered before the call can carry them', () => {
  /**
   * The real sequence, and the reason the buffer exists.
   *
   * `offer()` sets the local description, which is what starts ICE
   * gathering -- so candidates begin arriving *inside* that call, before the
   * transport has the offer, let alone a call the machine would accept
   * `sendCandidates` for. `open()` is the transport saying the call now
   * exists.
   */
  async function gathering() {
    const built = build({})
    await built.media.offer()
    return built
  }

  it('holds what ICE gathers before open, and sends it all at once', async () => {
    const { media, connection, listener } = await gathering()
    connection.pc.onCandidate?.(candidate('a'))
    connection.pc.onCandidate?.(candidate('b'))
    expect(listener.sent).toEqual([])

    media.open()
    expect(listener.sent).toEqual([[candidate('a'), candidate('b')]])
  })

  it('sends straight through once the call is open', async () => {
    const { media, connection, listener } = await gathering()
    media.open()
    connection.pc.onCandidate?.(candidate('a'))
    expect(listener.sent).toEqual([[candidate('a')]])
  })

  it('clears what it held, so a second open sends nothing twice', async () => {
    const { media, connection, listener } = await gathering()
    connection.pc.onCandidate?.(candidate('a'))
    media.open()
    media.open()
    expect(listener.sent).toEqual([[candidate('a')]])
  })

  it('does not call the listener at all when nothing was held', async () => {
    const { media, listener } = await gathering()
    media.open()
    expect(listener.sent).toEqual([])
  })

  it('drops a candidate that arrives after the call stopped', async () => {
    // The window between a call ending and the connection closing is real,
    // and this runs on the library's own callback, where a throw belongs to
    // nobody.
    const { media, connection, listener } = await gathering()
    media.open()
    media.stop()
    expect(() => connection.pc.onCandidate?.(candidate('late'))).not.toThrow()
    expect(listener.sent).toEqual([])
  })

  it('forgets what it was holding when the call stops', async () => {
    const { media, connection, listener } = await gathering()
    connection.pc.onCandidate?.(candidate('a'))
    media.stop()
    media.open()
    expect(listener.sent).toEqual([])
  })
})

describe('their candidates, arriving before there is anything to apply them to', () => {
  it('holds them until a connection exists, then applies them', async () => {
    // The glare path: the machine can deliver remote candidates alongside
    // the invite, and this side builds its connection while producing the
    // answer.
    const { media, connection } = build({})
    await media.addRemoteCandidates([candidate('a'), candidate('b')])
    expect(connection.calls.candidates).toEqual([])

    await media.answer(description('offer'))
    expect(connection.calls.candidates).toEqual([
      candidate('a'),
      candidate('b'),
    ])
  })

  it('applies them after the local description, not before', async () => {
    const { media, connection } = build({})
    await media.addRemoteCandidates([candidate('a')])
    await media.answer(description('offer'))
    expect(connection.calls.order.indexOf('setLocal')).toBeLessThan(
      connection.calls.order.indexOf('addIceCandidate'),
    )
  })

  it('applies them directly once a connection exists', async () => {
    const { media, connection } = build({})
    await media.offer()
    await media.addRemoteCandidates([candidate('a')])
    expect(connection.calls.candidates).toEqual([candidate('a')])
  })

  it('drains only once, so a later offer does not replay them', async () => {
    const { media, connection } = build({})
    await media.addRemoteCandidates([candidate('a')])
    await media.answer(description('offer'))
    await media.applyAnswer(description('answer'))
    expect(connection.calls.candidates).toEqual([candidate('a')])
  })

  it('survives one candidate the library refuses', async () => {
    // Candidates are independent and ICE needs one working path, so a
    // rejection must not cost the ones behind it.
    const refusing = fakeConnection({
      addIceCandidate: async c => {
        if (c.candidate.endsWith('bad')) throw new Error('malformed')
        return undefined
      },
    })
    const { media } = build({ connection: refusing })
    await media.offer()
    await expect(
      media.addRemoteCandidates([candidate('bad'), candidate('good')]),
    ).resolves.toBeUndefined()
  })

  it('ignores them entirely once the call stopped', async () => {
    const { media, connection } = build({})
    await media.offer()
    media.stop()
    await media.addRemoteCandidates([candidate('late')])
    expect(connection.calls.candidates).toEqual([])
  })
})

describe('what a connection state change means', () => {
  it('reports the first connection as connected', async () => {
    const { media, connection, listener } = build({})
    await media.offer()
    state(connection, 'connected')
    expect(listener.events).toEqual(['connected'])
  })

  it('reports a later one as reconnected, not as a second connection', async () => {
    const { media, connection, listener } = build({})
    await media.offer()
    state(connection, 'connected')
    state(connection, 'disconnected')
    state(connection, 'connected')
    expect(listener.events).toEqual([
      'connected',
      'disconnected',
      'reconnected',
    ])
  })

  it('says nothing about a drop on a call that never connected', async () => {
    // There is nothing to reconnect to, and the machine would otherwise
    // wait out a reconnection window for a call that never worked.
    const { media, connection, listener } = build({})
    await media.offer()
    state(connection, 'connecting')
    state(connection, 'disconnected')
    expect(listener.events).toEqual([])
  })

  it('reports a failure whether or not media ever flowed', async () => {
    const { media, connection, listener } = build({})
    await media.offer()
    state(connection, 'failed')
    expect(listener.events).toEqual(['failed'])
  })

  it('says nothing at all after the call stopped', async () => {
    const { media, connection, listener } = build({})
    await media.offer()
    media.stop()
    state(connection, 'connected')
    state(connection, 'failed')
    expect(listener.events).toEqual([])
  })
})

describe('mute publishes what the hardware did', () => {
  it('answers the track, not the request', async () => {
    // The failure this prevents is a muted microphone drawn on a track that
    // is still recording the room.
    const stubborn = fakeTrack(() => true)
    const { media } = build({ track: stubborn })
    await media.offer()
    expect(media.setMuted(true)).toBe(false)
    expect(media.muted()).toBe(false)
  })

  it('answers muted when the track obeyed', async () => {
    const { media } = build({})
    await media.offer()
    expect(media.setMuted(true)).toBe(true)
    expect(media.muted()).toBe(true)
    expect(media.setMuted(false)).toBe(false)
  })

  it('remembers a mute asked for before there was a track', async () => {
    const { media, track } = build({})
    expect(media.setMuted(true)).toBe(true)
    await media.offer()
    expect(track.state.enabled).toBe(false)
  })

  it('leaves an unmuted track alone', async () => {
    const { media, track } = build({})
    await media.offer()
    expect(track.state.asked).toEqual([])
  })
})

describe('teardown', () => {
  it('stops the track and closes the connection', async () => {
    const { media, connection, track } = build({})
    await media.offer()
    media.stop()
    expect(track.state.stopped).toBe(1)
    expect(connection.calls.closed).toBe(1)
  })

  it('releases a microphone captured after the call had already ended', async () => {
    // Otherwise the recording indicator stays lit on a call nobody is on.
    const { media, track, release } = build({ captureHangs: true })
    const offering = media.offer()
    media.stop()
    release()
    await offering.catch(() => undefined)
    expect(track.state.stopped).toBe(1)
  })

  it('does not attach a track captured after the call ended', async () => {
    const { media, connection, release } = build({ captureHangs: true })
    const offering = media.offer()
    media.stop()
    release()
    await offering.catch(() => undefined)
    expect(connection.calls.audio).toEqual([])
  })

  it('lets a capture failure reach the caller', async () => {
    // A refused microphone is a call that cannot be placed, and a screen has
    // to say so rather than show a call that silently never connects.
    const { media } = build({ captureRejects: new Error('denied') })
    await expect(media.offer()).rejects.toThrow('denied')
  })
})

describe('renegotiation', () => {
  it('answers the peer offer, which the specification requires', async () => {
    const { media, connection } = build({})
    await media.offer()
    const answer = await media.answerRenegotiation(description('offer'))
    expect(answer.type).toBe('answer')
    expect(connection.calls.localDescriptions).toContainEqual(answer)
  })

  it('applies the peer answer to one we offered', async () => {
    const { media, connection } = build({})
    await media.offer()
    await media.applyRenegotiationAnswer(description('answer'))
    expect(connection.calls.remoteDescriptions).toContainEqual(
      description('answer'),
    )
  })

  it('does not capture a second time for a renegotiation', async () => {
    // One microphone, one track. A renegotiation that captured again would
    // add a second audio track to the call.
    const captureAudio = vi.fn(async () => fakeTrack().track)
    const connection = fakeConnection()
    const media = startCallMedia(
      {
        createConnection: () => connection.pc,
        captureAudio,
        captureVideo: async () => fakeTrack().track,
      },
      CONFIG,
      fakeListener(),
    )
    await media.offer()
    await media.answerRenegotiation(description('offer'))
    expect(captureAudio).toHaveBeenCalledTimes(1)
  })
})

describe('the camera', () => {
  it('is not opened by an audio call', async () => {
    const { media, connection, camera } = build({})
    await media.offer()
    expect(connection.calls.video).toHaveLength(0)
    expect(camera.state.stopped).toBe(0)
    expect(media.sendingVideo()).toBe(false)
  })

  it('is added to the offer when the call asks for a picture', async () => {
    const { media, connection } = build({})
    await media.offer({ video: true })
    expect(connection.calls.video).toHaveLength(1)
    expect(media.sendingVideo()).toBe(true)
  })

  it('is added to the answer when this side sends one back', async () => {
    const { media, connection } = build({})
    await media.answer(description('offer'), { video: true })
    expect(connection.calls.video).toHaveLength(1)
  })

  it('is left shut when a video call is answered without one', async () => {
    // #200's gesture, and the media layer is where it has to be true: the
    // caller keeps sending a picture, and this side sends none.
    const { media, connection } = build({})
    await media.answer(description('offer'))
    expect(connection.calls.video).toHaveLength(0)
    expect(media.sendingVideo()).toBe(false)
  })

  it('leaves the call whole when it refuses to open', async () => {
    // WITHOUT A MICROPHONE THERE IS NO CALL; without a camera there is a
    // whole one. A refusal here must not reach the caller as a rejection.
    const { media, connection } = build({
      cameraRejects: new Error('permission denied'),
    })
    const offer = await media.offer({ video: true })
    expect(offer.type).toBe('offer')
    expect(connection.calls.audio).toHaveLength(1)
    expect(connection.calls.video).toHaveLength(0)
    expect(media.sendingVideo()).toBe(false)
  })

  it('is stopped when the call is torn down', async () => {
    const { media, camera } = build({})
    await media.offer({ video: true })
    media.stop()
    expect(camera.state.stopped).toBe(1)
  })

  it('is stopped rather than left lit when the call ends during capture', async () => {
    const { media, camera } = build({})
    const offering = media.offer({ video: true })
    media.stop()
    await offering.catch(() => undefined)
    expect(camera.state.stopped).toBe(1)
  })
})
