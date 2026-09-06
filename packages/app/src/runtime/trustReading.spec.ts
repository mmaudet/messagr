import { describe, expect, it } from 'vitest'

import { headlineOf, readWhatIsKnown } from './trustReading'

const unverified = { trust: 'unverified' as const }
const recognized = { trust: 'recognized' as const }
const verified = { trust: 'verified' as const }

describe('readWhatIsKnown', () => {
  it('counts the devices this account knows of', () => {
    expect(
      readWhatIsKnown([unverified, recognized, verified], false).devices,
    ).toBe(3)
  })

  it('separates what their account asserts from what this side confirmed', () => {
    // The two are not a scale. A device that person signed as theirs and a
    // device confirmed in person from here are different claims by different
    // parties, and folding them into one number would let the weaker one
    // read as the stronger.
    const reading = readWhatIsKnown([recognized, recognized, verified], false)
    expect(reading.claimedByThem).toBe(2)
    expect(reading.confirmedHere).toBe(1)
  })

  it('counts a device established by nobody in neither column', () => {
    const reading = readWhatIsKnown([unverified, unverified], false)
    expect(reading).toEqual({
      devices: 2,
      confirmedHere: 0,
      claimedByThem: 0,
      vouchedFor: false,
    })
  })

  it('carries whether somebody already inside answered for them', () => {
    expect(readWhatIsKnown([unverified], true).vouchedFor).toBe(true)
  })

  it('is a real answer for a person with no device this account knows of', () => {
    expect(readWhatIsKnown([], false)).toEqual({
      devices: 0,
      confirmedHere: 0,
      claimedByThem: 0,
      vouchedFor: false,
    })
  })

  it('treats a state this build does not know as not established', () => {
    // `TrustState` may be appended to by a later library version. The safe
    // reading of a state nobody here has seen is "nothing established",
    // never a guess in the direction that reassures.
    const future = [{ trust: 'something-later' as unknown as 'verified' }]
    const reading = readWhatIsKnown(future, false)
    expect(reading.devices).toBe(1)
    expect(reading.confirmedHere).toBe(0)
    expect(reading.claimedByThem).toBe(0)
  })
})

describe('headlineOf', () => {
  it('leads with a device confirmed from here, which settles the question', () => {
    expect(headlineOf(readWhatIsKnown([unverified, verified], false))).toBe(
      'confirmed',
    )
  })

  it('leads with a confirmed device even when nobody vouched', () => {
    expect(headlineOf(readWhatIsKnown([verified], false))).toBe('confirmed')
  })

  it('leads with the vouch when nothing was confirmed here', () => {
    expect(headlineOf(readWhatIsKnown([recognized], true))).toBe('vouched')
  })

  it('does not let a device that person signed count as a vouch', () => {
    // Their own account signing their own device is not somebody answering
    // for them. An attacker holding the account would sign a device exactly
    // the same way.
    expect(headlineOf(readWhatIsKnown([recognized, recognized], false))).toBe(
      'nothing-yet',
    )
  })

  it('says nothing yet for the ordinary starting state', () => {
    expect(headlineOf(readWhatIsKnown([unverified], false))).toBe('nothing-yet')
  })
})
