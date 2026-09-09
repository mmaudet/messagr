import { describe, expect, it } from 'vitest'

import { offersVideo } from './sdp'

/** The shape a real offer has, trimmed to what this reads. */
function offer(...sections: string[]): string {
  return ['v=0', 'o=- 1 1 IN IP4 0.0.0.0', 's=-', 't=0 0', ...sections].join(
    '\r\n',
  )
}

const AUDIO = ['m=audio 9 UDP/TLS/RTP/SAVPF 111', 'a=sendrecv']

describe('whether an offer carries a picture', () => {
  it('says no to an audio-only offer', () => {
    expect(offersVideo(offer(...AUDIO))).toBe(false)
  })

  it('says yes to an offer that sends video', () => {
    expect(
      offersVideo(
        offer(...AUDIO, 'm=video 9 UDP/TLS/RTP/SAVPF 96', 'a=sendrecv'),
      ),
    ).toBe(true)
  })

  it('says yes when the section names no direction', () => {
    // The specification's default for a section that says nothing.
    expect(offersVideo(offer(...AUDIO, 'm=video 9 UDP/TLS/RTP/SAVPF 96'))).toBe(
      true,
    )
  })

  it('says no to a receive-only line', () => {
    // "I can receive a picture, I am not sending one." A screen announcing a
    // video call here would promise a face that never arrives.
    expect(
      offersVideo(
        offer(...AUDIO, 'm=video 9 UDP/TLS/RTP/SAVPF 96', 'a=recvonly'),
      ),
    ).toBe(false)
  })

  it('says no to an inactive line', () => {
    expect(
      offersVideo(
        offer(...AUDIO, 'm=video 9 UDP/TLS/RTP/SAVPF 96', 'a=inactive'),
      ),
    ).toBe(false)
  })

  it('says no to a section turned off with port zero', () => {
    // How a renegotiation withdraws a picture. Treating it as an offer would
    // announce one the far end has just taken away.
    expect(
      offersVideo(
        offer(...AUDIO, 'm=video 0 UDP/TLS/RTP/SAVPF 96', 'a=sendrecv'),
      ),
    ).toBe(false)
  })

  it('inherits a direction stated before the first media line', () => {
    // THE CASE A SEARCH FOR `m=video` GETS WRONG. A session-level
    // `a=recvonly` applies to every section that does not override it, so
    // this offer sends nothing at all.
    expect(
      offersVideo(
        offer('a=recvonly', ...AUDIO, 'm=video 9 UDP/TLS/RTP/SAVPF 96'),
      ),
    ).toBe(false)
  })

  it('lets a section override the session it sits in', () => {
    expect(
      offersVideo(
        offer(
          'a=recvonly',
          ...AUDIO,
          'm=video 9 UDP/TLS/RTP/SAVPF 96',
          'a=sendrecv',
        ),
      ),
    ).toBe(true)
  })

  it('reads a video section that is not the last one', () => {
    expect(
      offersVideo(
        offer(
          'm=video 9 UDP/TLS/RTP/SAVPF 96',
          'a=sendrecv',
          'm=audio 9 UDP/TLS/RTP/SAVPF 111',
          'a=sendrecv',
        ),
      ),
    ).toBe(true)
  })

  it('does not mistake an audio section for a video one', () => {
    expect(
      offersVideo(offer('m=audio 9 UDP/TLS/RTP/SAVPF 111', 'a=sendrecv')),
    ).toBe(false)
  })

  it('answers false for something that is not an offer at all', () => {
    expect(offersVideo('')).toBe(false)
    expect(offersVideo('not an sdp')).toBe(false)
  })

  it('reads an offer with unix line endings', () => {
    expect(
      offersVideo(
        'v=0\nm=audio 9 UDP/TLS/RTP/SAVPF 111\nm=video 9 UDP/TLS/RTP/SAVPF 96',
      ),
    ).toBe(true)
  })
})
