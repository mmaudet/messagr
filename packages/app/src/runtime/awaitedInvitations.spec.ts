import { describe, expect, it } from 'vitest'

import { awaitedInvitations, theAwaitedInvitations } from './awaitedInvitations'

describe('awaitedInvitations', () => {
  it('waits for nothing until a link has been spent', () => {
    // A launch that restored the session it already had asked nobody for
    // anything, so there is no invitation it is expecting.
    expect(awaitedInvitations().count()).toBe(0)
  })

  it('waits for one invitation per link spent', () => {
    const waited = awaitedInvitations()
    waited.claimed()
    waited.claimed()
    expect(waited.count()).toBe(2)
  })

  it('stops waiting for the ones that have been answered', () => {
    const waited = awaitedInvitations()
    waited.claimed()
    waited.claimed()
    waited.settled(1)
    expect(waited.count()).toBe(1)
  })

  it('never waits for fewer than none', () => {
    // More invitations answered than links spent: an invitation this device
    // was waiting for can arrive beside one it entered on a previous tick.
    // The count is a floor at zero rather than a debt.
    const waited = awaitedInvitations()
    waited.claimed()
    waited.settled(4)
    expect(waited.count()).toBe(0)
  })

  it('ignores an answer about nothing', () => {
    const waited = awaitedInvitations()
    waited.claimed()
    waited.settled(0)
    expect(waited.count()).toBe(1)
  })

  it('keeps one register for the whole process', () => {
    // Entry spends the links and the pump enters the invitations, in two
    // modules that never meet. What joins them is this one register.
    const before = theAwaitedInvitations.count()
    theAwaitedInvitations.claimed()
    expect(theAwaitedInvitations.count()).toBe(before + 1)
    theAwaitedInvitations.settled(1)
    expect(theAwaitedInvitations.count()).toBe(before)
  })
})
