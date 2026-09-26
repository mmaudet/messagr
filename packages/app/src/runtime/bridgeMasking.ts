import {
  blindOprf,
  finalizeOprf,
  isCryptoError,
} from 'react-native-matrix-crypto'

import type { Masking } from './findContacts'

/**
 * The masking of `findContacts.ts`, by the crypto bridge's client of RFC
 * 9497's oblivious pseudorandom function (#395, #400).
 *
 * The one translation it needs: the bridge refuses an answer whose batch
 * proof does not verify against the public key with the error kind
 * `proof_rejected`, and the search reads that as an answer that did not come
 * from the published key. Any other failure is thrown on, and the search
 * reads it as a service it could not reach.
 */
export const bridgeMasking: Masking = {
  blind: blindOprf,
  finalize: async (blinding, evaluationElements, batchProof, publicKey) => {
    try {
      return await finalizeOprf(
        blinding,
        evaluationElements,
        batchProof,
        publicKey,
      )
    } catch (e) {
      if (isCryptoError(e) && e.kind === 'proof_rejected') {
        return 'not-the-published-key'
      }
      throw e
    }
  },
}
