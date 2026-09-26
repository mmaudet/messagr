import { hmac } from '@noble/hashes/hmac.js'
import { sha256 } from '@noble/hashes/sha2.js'

import type { Fingerprint } from './discoveryResultsStore'
import { base64Of } from './receiveImage'

/**
 * A number's fingerprint, for the page that keeps what looking for contacts
 * found (#402): HMAC-SHA-256 of the number in international form, under the
 * page's own key, in base64.
 *
 * Keyed, because a number is short enough to guess: a plain hash of every
 * number of a country is a table anybody can compute, and it would read the
 * page back as numbers. Under a key minted on this device, the fingerprint
 * says nothing without the key.
 *
 * The number is encoded byte for byte, as the masking encodes it: an
 * international number is a plus sign and digits.
 */
export const numberFingerprint: Fingerprint = (key, number) =>
  base64Of(
    hmac(
      sha256,
      key,
      Uint8Array.from(number, c => c.charCodeAt(0)),
    ),
  )
