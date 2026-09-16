import { describe, expect, it } from 'vitest'

import type { CallState } from './machine'
import {
  RINGBACK_LIFETIME_MS,
  startRingback,
  type RingbackPorts,
} from './ringback'

/**
 * The caller's own tone, and what bounds it.
 *
 * The telephone here is a list: every start and every stop is written down,
 * and the clock only moves when a test moves it. Nothing below plays a
 * sound, so nothing below proves one was heard -- what it proves is when
 * this module asks for one and when it gives it up, which is the half that
 * was missing (#294).
 */
function telephone(at = 1_000) {
  let clock = at
  const heard: ('tone' | 'silence')[] = []
  const ports: RingbackPorts = {
    now: () => clock,
    play: () => heard.push('tone'),
    silence: () => heard.push('silence'),
  }
  return {
    ports,
    heard,
    advance: (ms: number) => {
      clock += ms
    },
  }
}

const OUTGOING: CallState = { call: 'outgoingInvite', callId: 'call-1' }

describe("a caller's tone while the application is not in front", () => {
  it('is given up when the application leaves, and taken again while the invitation is still alive', () => {
    const phone = telephone()
    const tone = startRingback(phone.ports, true)
    // The audio session was taken with the tone already sounding, so
    // nothing is asked for here.
    tone.began()
    tone.state(OUTGOING)
    expect(phone.heard).toEqual([])

    tone.foreground(false)
    expect(phone.heard).toEqual(['silence'])

    phone.advance(10_000)
    tone.foreground(true)
    expect(phone.heard).toEqual(['silence', 'tone'])
  })

  it('is not taken again once the invitation has run out, though nothing ticked meanwhile', () => {
    // #294 ITSELF. The timers are suspended with the application, so the
    // machine has not noticed its own deadline; the clock has. A tone that
    // came back here would be a telephone ringing at somebody who can no
    // longer answer.
    const phone = telephone()
    const tone = startRingback(phone.ports, true)
    tone.began()
    tone.state(OUTGOING)
    tone.foreground(false)

    phone.advance(RINGBACK_LIFETIME_MS + 1)
    tone.foreground(true)

    expect(phone.heard).toEqual(['silence'])
  })
})

describe('the deadline', () => {
  it('is read from the clock, and stops the tone at the first thing reported past it', () => {
    // The application is in front the whole time and nothing has ended the
    // call: the machine is what would normally say so, and here it says
    // nothing at all. The tone stops anyway.
    const phone = telephone()
    const tone = startRingback(phone.ports, true)
    tone.began()
    tone.state(OUTGOING)

    phone.advance(RINGBACK_LIFETIME_MS)
    tone.state(OUTGOING)
    expect(phone.heard).toEqual([])

    phone.advance(1)
    tone.state(OUTGOING)
    expect(phone.heard).toEqual(['silence'])
  })

  it('counts from the invitation leaving, not from the audio session being taken', () => {
    // Between the two there is a relay to ask for and a microphone to open,
    // and on a first call a dialog as well. Counting from the earlier of the
    // two would cut the tone short of the invitation it reports.
    const phone = telephone()
    const tone = startRingback(phone.ports, true)
    tone.began()
    phone.advance(5_000)
    tone.state(OUTGOING)

    phone.advance(RINGBACK_LIFETIME_MS)
    tone.state(OUTGOING)
    expect(phone.heard).toEqual([])
  })
})

describe('the tone belongs to one end of one call', () => {
  it('stops when the far end picks up', () => {
    const phone = telephone()
    const tone = startRingback(phone.ports, true)
    tone.began()
    tone.state(OUTGOING)
    tone.state({ call: 'connecting', callId: 'call-1' })
    expect(phone.heard).toEqual(['silence'])
  })

  it('never sounds for a call this device did not place', () => {
    // The callee is not waiting for anything: they are being rung, and the
    // ring is the notification's own sound.
    const phone = telephone()
    const tone = startRingback(phone.ports, true)
    tone.state({
      call: 'incomingInvite',
      callId: 'call-theirs',
      autoAccept: false,
      offer: { type: 'offer', sdp: 'v=0' },
    })
    tone.foreground(false)
    tone.foreground(true)
    expect(phone.heard).toEqual([])
  })

  it('does not come back after the audio session has been given back', () => {
    const phone = telephone()
    const tone = startRingback(phone.ports, true)
    tone.began()
    tone.state(OUTGOING)
    tone.foreground(false)
    tone.over()
    tone.foreground(true)
    expect(phone.heard).toEqual(['silence'])
  })

  it('asks for nothing it has already asked for', () => {
    const phone = telephone()
    const tone = startRingback(phone.ports, true)
    tone.began()
    tone.state(OUTGOING)
    tone.foreground(true)
    tone.state(OUTGOING)
    expect(phone.heard).toEqual([])

    tone.foreground(false)
    tone.foreground(false)
    tone.state(OUTGOING)
    expect(phone.heard).toEqual(['silence'])
  })
})

describe('a call that never left the device', () => {
  it('does not get its tone back when the application returns', () => {
    // Between the audio session and the invitation there is a relay to ask
    // for and a microphone to open, and either can refuse: the tone is
    // sounding on a call that will never ring. Coming back to a silent
    // screen must not start it again.
    const phone = telephone()
    const tone = startRingback(phone.ports, true)
    tone.began()
    tone.foreground(false)
    expect(phone.heard).toEqual(['silence'])

    tone.foreground(true)
    expect(phone.heard).toEqual(['silence'])

    // And it does come back the moment the invitation reports itself gone.
    tone.state(OUTGOING)
    expect(phone.heard).toEqual(['silence', 'tone'])
  })
})

describe('a call placed while the application is already away', () => {
  it('gives the tone up rather than leaving it sounding behind', () => {
    // An application that is not in front when the audio session is taken --
    // the call placed from a notification, the screen locked in the second
    // it went out -- still started the tone, because the session and the
    // tone are one call into the platform.
    const phone = telephone()
    const tone = startRingback(phone.ports, false)
    tone.began()
    expect(phone.heard).toEqual(['silence'])
  })
})
