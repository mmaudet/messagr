import { hmac } from '@noble/hashes/hmac.js'
import { sha256 } from '@noble/hashes/sha2.js'

import { numberBytes } from './findContacts'
import { base64Of } from './receiveImage'

/**
 * A number's fingerprint, for the page that keeps what looking for contacts
 * found (#402): HMAC-SHA-256 of the number in international form, under the
 * page's own key, in base64.
 *
 * Keyed, because a number is short enough to guess: a plain hash of every
 * number of a country is a table anybody can compute once and match against
 * any page. Under a key minted on this device, the same number has another
 * fingerprint elsewhere. It does not hide the number from a reader who holds
 * the key as well: `discoveryResultsStore.ts` says what that is worth.
 *
 * # NOT THE CRYPTOGRAPHY ADR 0001 KEEPS IN ONE PLACE
 *
 * ADR 0001 allows one implementation of Matrix's cryptography, which is the
 * crypto bridge's, and its amendment of 26 September 2026 records that the
 * masking of discovery was first planned in TypeScript and moved into the
 * bridge only for speed. This hash protects nothing in transit and takes no
 * part in the protocol: it indexes a page of this device's notebook. Hence
 * `@noble/hashes`, on the owner's choice of 26 September 2026, rather than a
 * call into the bridge.
 */
export function numberFingerprint(key: Uint8Array, number: string): string {
  return base64Of(hmac(sha256, key, numberBytes(number)))
}
