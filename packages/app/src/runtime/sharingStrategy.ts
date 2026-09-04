// Type-only, like every other module that names the crypto package outside
// cryptoPump.ts.
import type { IdentityStatus } from 'react-native-matrix-crypto'

/**
 * Which strategy the crypto machine uses to decide who receives a room key.
 *
 * `react-native-matrix-crypto` 0.4.0 changed this without a caller opting in:
 * a machine holding a verified cross-signing identity of its own collects
 * recipients by identity (MSC4153) rather than sharing with every
 * unblacklisted device. A device no identity vouches for — including a
 * user's own unverified device — then receives no key and decrypts nothing
 * sent afterwards.
 *
 * That is the recommended posture and what mainstream Matrix clients do. It
 * is also the one entry in that release that changes behaviour on its own,
 * so this application reads which strategy applies **out of the machine**
 * rather than reasoning about it from a changelog. This function is that
 * reading.
 *
 * The strategy is not a parameter and cannot be one: the identity-based
 * collection refuses outright for a machine with no identity of its own,
 * before it looks at a single recipient, so it has to follow from the
 * machine's state.
 */
export type SharingStrategy =
  /** Every unblacklisted device, which is what 0.3.0 always did. */
  | 'device-based'
  /** Devices an identity vouches for. MSC4153. */
  | 'identity-based'
  /** Nothing has been asked yet, so nothing is claimed. */
  | 'unknown'

export function computeSharingStrategy(
  status: IdentityStatus,
): SharingStrategy {
  // The library is explicit that the other two fields are only trustworthy
  // alongside this one: private keys restored from a backup can belong to an
  // identity the account has since replaced. Before a key query has been
  // answered, a refusal to guess is the only honest answer.
  if (!status.accountKeysFetched) {
    return 'unknown'
  }

  // Both, not either. Recognising an identity is not holding it, and a
  // machine that cannot sign with the identity cannot use the strategy that
  // requires one.
  return status.identityKnown && status.privateKeysHeld
    ? 'identity-based'
    : 'device-based'
}
