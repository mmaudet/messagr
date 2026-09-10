import { describe, expect, it } from 'vitest'

import { offerBackup } from './offerBackup'

const QUIET = { backedUp: false, asked: false, received: false }

describe('when the product offers to back up the keys', () => {
  it('says nothing on a device that has never received anything', () => {
    // Before a message has arrived there is nothing to lose, so the promise
    // is abstract and the refusal is free.
    expect(offerBackup(QUIET)).toEqual({ offer: false })
  })

  it('offers once the first message has arrived', () => {
    expect(offerBackup({ ...QUIET, received: true })).toEqual({ offer: true })
  })

  it('never asks twice, whatever the answer was', () => {
    // ADR-0013: a line in Réglages and nothing else. A product that nags
    // about security teaches people to dismiss it.
    expect(offerBackup({ ...QUIET, received: true, asked: true })).toEqual({
      offer: false,
    })
  })

  it('says nothing when the keys are already going somewhere', () => {
    expect(
      offerBackup({ backedUp: true, asked: false, received: true }),
    ).toEqual({ offer: false })
  })

  it('does not count what this device sent', () => {
    // Sending proves the account works. Receiving is the first time this
    // device holds a key nobody else has -- which is the thing at risk.
    expect(offerBackup({ ...QUIET, received: false })).toEqual({
      offer: false,
    })
  })

  it('stays silent after a refusal even once more arrives', () => {
    // The refusal is honoured for good, not until something changes.
    expect(
      offerBackup({ backedUp: false, asked: true, received: true }),
    ).toEqual({ offer: false })
  })
})
