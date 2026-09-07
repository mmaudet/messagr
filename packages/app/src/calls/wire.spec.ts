import { describe, expect, it } from 'vitest'

import {
  answerEvent,
  answerEventVersionZero,
  callIdOf,
  hangupEvent,
  hangupEventVersionZero,
  hangupReasonOf,
  inviteEvent,
  isVersionZero,
  partyIdOf,
  rejectEvent,
  selectAnswerEvent,
} from './wire'

const OFFER = { type: 'offer', sdp: 'v=0 offer-sdp' }
const ANSWER = { type: 'answer', sdp: 'v=0 answer-sdp' }

describe('isVersionZero', () => {
  it('reads the numeric zero as the legacy version, which is how it travels', () => {
    expect(isVersionZero(0)).toBe(true)
  })

  it('reads the string "1" as version 1', () => {
    expect(isVersionZero('1')).toBe(false)
  })

  it('reads the numeric 1 as version 1, which the specification names explicitly', () => {
    // "If clients see events with version other than 0 or "1" (including,
    // for example, the numeric value 1), they should treat these the same as
    // if they had version == "1"."
    expect(isVersionZero(1)).toBe(false)
  })

  it('does not read the string "0" as legacy, because the specification writes that version unquoted', () => {
    // Being more generous here would answer a modern client with an answer
    // carrying no party_id -- the one thing multi-device semantics cannot do
    // without.
    expect(isVersionZero('0')).toBe(false)
  })

  it('treats a version from the future as version 1 rather than refusing it', () => {
    expect(isVersionZero('2')).toBe(false)
    expect(isVersionZero('org.example.custom')).toBe(false)
  })
})

describe('hangupReasonOf', () => {
  it('reads a missing reason as user_hangup', () => {
    // "a missing value should be treated as user_hangup".
    expect(hangupReasonOf({ call_id: 'call1', version: '1' })).toBe(
      'user_hangup',
    )
  })

  it('passes a stated reason through untouched', () => {
    expect(
      hangupReasonOf({ call_id: 'call1', version: '1', reason: 'ice_timeout' }),
    ).toBe('ice_timeout')
  })

  it('passes through a reason no version of this build has heard of', () => {
    // Refusing to end a call over an unknown string would be the worse
    // failure: the peer has hung up either way.
    expect(
      hangupReasonOf({ call_id: 'call1', version: '1', reason: 'org.example' }),
    ).toBe('org.example')
  })
})

describe('the events this machine sends', () => {
  it('stamp version 1 on everything', () => {
    const events = [
      inviteEvent('call1', 'aliceP', 90_000, OFFER, '@bob:example.org'),
      answerEvent('call1', 'bobP', ANSWER),
      selectAnswerEvent('call1', 'aliceP', 'bobP'),
      rejectEvent('call1', 'bobP'),
      hangupEvent('call1', 'aliceP', 'user_hangup'),
    ]
    for (const event of events) {
      expect(event.content.version).toBe('1')
    }
  })

  it('address an invite to the one person it is meant for, and say how long it is good for', () => {
    const event = inviteEvent(
      'call1',
      'aliceP',
      90_000,
      OFFER,
      '@bob:example.org',
    )
    expect(event.type).toBe('m.call.invite')
    expect(event.content).toEqual({
      call_id: 'call1',
      party_id: 'aliceP',
      lifetime: 90_000,
      offer: OFFER,
      version: '1',
      invitee: '@bob:example.org',
    })
  })

  it('leave the party id off a version-0 answer, because that version has none', () => {
    const event = answerEventVersionZero('call1', ANSWER)
    expect(event.content.version).toBe(0)
    expect(partyIdOf(event)).toBeUndefined()
  })

  it('refuse a version-0 invite with a hangup that states its reason', () => {
    const event = hangupEventVersionZero('call1')
    expect(event.type).toBe('m.call.hangup')
    expect(event.content).toEqual({
      call_id: 'call1',
      version: 0,
      reason: 'user_hangup',
    })
  })
})

describe('reading an event without knowing its kind', () => {
  it('finds the call on every one of them', () => {
    expect(
      callIdOf(inviteEvent('call1', 'aliceP', 90_000, OFFER, '@bob:e.org')),
    ).toBe('call1')
    expect(callIdOf(rejectEvent('call1', 'bobP'))).toBe('call1')
    expect(callIdOf(hangupEvent('call1', 'aliceP', 'user_hangup'))).toBe(
      'call1',
    )
  })

  it('finds the party on the kinds that carry one', () => {
    expect(partyIdOf(selectAnswerEvent('call1', 'aliceP', 'bobP'))).toBe(
      'aliceP',
    )
    expect(partyIdOf(answerEvent('call1', 'bobP', ANSWER))).toBe('bobP')
  })
})
