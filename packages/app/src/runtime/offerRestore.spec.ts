import { describe, expect, it } from 'vitest'

import { offerRestore } from './offerRestore'

const NOTHING_WRONG = { backupExists: true, unreadable: 0, asked: false }

describe('when the product offers to bring a past back', () => {
  it('says nothing on a device that can read everything it has', () => {
    expect(offerRestore(NOTHING_WRONG)).toEqual({ offer: false })
  })

  it('offers when there is a backup and something it cannot read', () => {
    expect(offerRestore({ ...NOTHING_WRONG, unreadable: 412 })).toEqual({
      offer: true,
      unreadable: 412,
    })
  })

  it('says nothing when no backup exists to restore from', () => {
    // Offering here would be offering to open a door nobody built. A device
    // whose owner never accepted a backup is unreadable for good, and the
    // honest screen for that is the one that says so rather than one that
    // asks for a key that opens nothing.
    expect(
      offerRestore({ backupExists: false, unreadable: 412, asked: false }),
    ).toEqual({ offer: false })
  })

  it('never asks twice', () => {
    expect(
      offerRestore({ backupExists: true, unreadable: 412, asked: true }),
    ).toEqual({ offer: false })
  })

  it('carries the count, so the screen can say what is at stake', () => {
    // A number somebody can check against what they can see is the
    // difference between a sentence they believe and one they skip.
    const offer = offerRestore({ ...NOTHING_WRONG, unreadable: 1 })

    expect(offer).toEqual({ offer: true, unreadable: 1 })
  })

  it('does not offer on a device with nothing in it at all', () => {
    // The case a "is the store fresh" test would have got wrong in the
    // noisy direction: a device that has never had a conversation has
    // nothing to restore, and an offer there is a product asking somebody to
    // find a secret for a past they do not have.
    expect(
      offerRestore({ backupExists: true, unreadable: 0, asked: false }),
    ).toEqual({ offer: false })
  })

  it('offers on a store that survived but lost some of its keys', () => {
    // The case a "is the store fresh" test would have got wrong in the other
    // direction: nothing was reinstalled, the store is old, and some keys
    // are gone. Counting what cannot be read asks the question the person is
    // actually asking.
    expect(
      offerRestore({ backupExists: true, unreadable: 3, asked: false }),
    ).toEqual({ offer: true, unreadable: 3 })
  })

  it('treats a negative count as nothing to restore', () => {
    // Not reachable from a counter, and the guard is `<= 0` rather than
    // `=== 0` so that it cannot become reachable by arithmetic somewhere
    // else answering with a difference.
    expect(offerRestore({ ...NOTHING_WRONG, unreadable: -1 })).toEqual({
      offer: false,
    })
  })
})
