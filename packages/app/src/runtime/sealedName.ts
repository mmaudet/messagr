import { bytesOf } from './base64'
import { cleanDeclaredName, DECLARED_LIMIT } from './declaredName'
import { ENC_BYTES, open, seal, TAG_BYTES } from './hpke'
import { base64Of } from './receiveImage'

/**
 * The name an inviter gives itself, sealed for the device of the person it
 * invites (#405, the glossary's « Declared name »).
 *
 * A link carries that name in its fragment, which never reaches a server
 * (`declaredName.ts`). An invitation delivered inside Messagr has no link, so
 * the inviter's device seals the name for the envelope key the recipient's
 * device published with its proof (`envelopeKeys.ts`), which the directory
 * lists with the reference. The service passes the envelope on without being
 * able to open it, and erases it once the invitation is answered or runs out
 * (`services/invitations/src/handlers/delivered.rs`).
 *
 * # THE SAME SIZE FOR EVERY NAME, AND FOR NONE
 *
 * The name is padded with zero bytes to the 48 a declared name may take
 * (`DECLARED_LIMIT`), so the envelope says nothing of its length: always
 * `SEALED_NAME_BYTES`, the size the service accepts and no other. A zero byte
 * cannot be part of a name, since `cleanDeclaredName` removes every control
 * character, so the first one ends it.
 *
 * And a person who declares no name still sends an envelope, of zeros only,
 * which opens as no name: the service cannot tell a name given from none.
 *
 * # OPENED AS A LINK'S NAME IS READ
 *
 * What comes out goes through `cleanDeclaredName`, as a name read from a
 * fragment does: it is somebody else's text on its way to the screen where a
 * decision is made. An envelope that does not open, sealed for a key this
 * device no longer holds or altered on the way, is shown without a name and
 * without an error.
 */

/** HPKE's `info`: what the key schedule binds every envelope to. */
const PURPOSE = new TextEncoder().encode('messagr declared name v1')
const NO_AAD = new Uint8Array(0)
/** An envelope key: an X25519 public key. */
const ENVELOPE_KEY_BYTES = 32

/** The size of every sealed name, the one `delivered.rs` accepts. */
export const SEALED_NAME_BYTES = ENC_BYTES + DECLARED_LIMIT + TAG_BYTES

/**
 * `name`, cleaned as a declared name is, sealed for `envelopeKey` (base64),
 * in base64. No name, or one that cleans to nothing, is sealed all the same,
 * as zeros. `null` only when the key is not one.
 */
export function sealName(
  envelopeKey: string,
  name: string | null,
): string | null {
  const recipient = decoded(envelopeKey)
  if (recipient?.length !== ENVELOPE_KEY_BYTES) return null
  // `cleanDeclaredName` caps the name at `DECLARED_LIMIT` bytes.
  const padded = new Uint8Array(DECLARED_LIMIT)
  padded.set(new TextEncoder().encode(cleanDeclaredName(name ?? '') ?? ''))
  try {
    const { enc, ciphertext } = seal(recipient, PURPOSE, NO_AAD, padded)
    const envelope = new Uint8Array(SEALED_NAME_BYTES)
    envelope.set(enc)
    envelope.set(ciphertext, ENC_BYTES)
    return base64Of(envelope)
  } catch {
    // A key X25519 refuses, of low order: no name, rather than no invitation.
    return null
  }
}

/**
 * The name `sealed` (base64) holds, opened with the first of `secretKeys`
 * that opens it, or `null`.
 */
export function openSealedName(
  secretKeys: readonly Uint8Array[],
  sealed: string,
): string | null {
  const bytes = decoded(sealed)
  if (bytes?.length !== SEALED_NAME_BYTES) return null
  const envelope = {
    enc: bytes.subarray(0, ENC_BYTES),
    ciphertext: bytes.subarray(ENC_BYTES),
  }
  for (const secretKey of secretKeys) {
    const padded = open(secretKey, envelope, PURPOSE, NO_AAD)
    if (padded === null) continue
    const end = padded.indexOf(0)
    return cleanDeclaredName(
      new TextDecoder().decode(end === -1 ? padded : padded.subarray(0, end)),
    )
  }
  return null
}

function decoded(base64: string): Uint8Array | null {
  try {
    return bytesOf(base64)
  } catch {
    return null
  }
}
