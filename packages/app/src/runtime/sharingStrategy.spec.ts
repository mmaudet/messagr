import { describe, expect, it } from 'vitest'

import { computeSharingStrategy } from './sharingStrategy'

const settled = {
  accountKeysFetched: true,
  identityKnown: false,
  privateKeysHeld: false,
  accountKeysAnswerUnsettled: false,
  identityPublicationPending: false,
}

describe('computeSharingStrategy', () => {
  it('is device-based for a machine with no identity of its own', () => {
    // What this application is today: it never creates a cross-signing
    // identity, so 0.4.0's change of strategy does not reach it.
    expect(computeSharingStrategy(settled)).toBe('device-based')
  })

  it('is identity-based once the machine both knows and holds its identity', () => {
    expect(
      computeSharingStrategy({
        ...settled,
        identityKnown: true,
        privateKeysHeld: true,
      }),
    ).toBe('identity-based')
  })

  it('is still device-based when the identity is known but this device cannot sign with it', () => {
    // Recognising an identity is not holding it. A machine that cannot sign
    // cannot use the identity-based strategy, which refuses outright for a
    // machine with no identity of its own.
    expect(computeSharingStrategy({ ...settled, identityKnown: true })).toBe(
      'device-based',
    )
  })

  it('refuses to answer before a key query has been answered', () => {
    // The library says the other two fields are only trustworthy alongside
    // this one: private keys from a restored backup can belong to an
    // identity the account has since replaced.
    expect(
      computeSharingStrategy({
        ...settled,
        accountKeysFetched: false,
        identityKnown: true,
        privateKeysHeld: true,
      }),
    ).toBe('unknown')
  })
})
