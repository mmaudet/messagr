import { chacha20poly1305 } from '@noble/ciphers/chacha.js'
import { x25519 } from '@noble/curves/ed25519.js'
import { expand, extract } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'

/**
 * HPKE (RFC 9180) in its base mode, for one suite and no other:
 * DHKEM(X25519, HKDF-SHA256), HKDF-SHA256 and ChaCha20-Poly1305 (#405).
 *
 * What seals the name an inviter gives itself for the device of the person it
 * invites, and opens it there (`sealedName.ts`). The construction and the
 * libraries were chosen on #405: the primitives come from `@noble/curves`,
 * `@noble/ciphers` and `@noble/hashes`, all three audited, and this file only
 * assembles them as §4, §5.1 and §7.1.3 of the RFC say, checked against the
 * vectors of its appendix A.2.1 (`hpke.spec.ts`).
 *
 * SINGLE-SHOT: one message per encapsulation, so the nonce is the base nonce
 * itself, sequence number 0, as `SealBase` and `OpenBase` of §6.1.
 *
 * Outside the crypto bridge, which ADR 0001 otherwise keeps as the one place
 * for cryptography: its amendment of 27 September 2026 says why this may be.
 */

export interface KeyPair {
  readonly secretKey: Uint8Array
  readonly publicKey: Uint8Array
}

export interface Sealed {
  /** The encapsulated key: the ephemeral public key, 32 bytes. */
  readonly enc: Uint8Array
  readonly ciphertext: Uint8Array
}

const KEM_ID = 0x0020
const KDF_ID = 0x0001
const AEAD_ID = 0x0003
/** The suite's sizes, by the RFC's names: Nsecret, Nsk, Nk, Nn. */
const N_SECRET = 32
const N_SK = 32
const N_K = 32
const N_N = 12
/** Nenc: the size of an encapsulated key, which leads every envelope. */
export const ENC_BYTES = 32
/** Nt: the size of ChaCha20-Poly1305's tag, which ends every envelope. */
export const TAG_BYTES = 16
const MODE_BASE = 0x00
const EMPTY = new Uint8Array(0)

/** A label of the RFC, which are all ASCII. */
function ascii(text: string): Uint8Array {
  return Uint8Array.from(text, c => c.charCodeAt(0))
}

/** I2OSP: `value` as `length` bytes, big-endian. */
function i2osp(value: number, length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  let rest = value
  for (let at = length - 1; at >= 0; at -= 1) {
    bytes[at] = rest % 256
    rest = Math.floor(rest / 256)
  }
  return bytes
}

function concat(...parts: readonly Uint8Array[]): Uint8Array {
  const joined = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0))
  let at = 0
  for (const part of parts) {
    joined.set(part, at)
    at += part.length
  }
  return joined
}

const KEM_SUITE = concat(ascii('KEM'), i2osp(KEM_ID, 2))
const HPKE_SUITE = concat(
  ascii('HPKE'),
  i2osp(KEM_ID, 2),
  i2osp(KDF_ID, 2),
  i2osp(AEAD_ID, 2),
)

function labeledExtract(
  suite: Uint8Array,
  salt: Uint8Array,
  label: string,
  ikm: Uint8Array,
): Uint8Array {
  return extract(
    sha256,
    concat(ascii('HPKE-v1'), suite, ascii(label), ikm),
    salt,
  )
}

function labeledExpand(
  suite: Uint8Array,
  prk: Uint8Array,
  label: string,
  info: Uint8Array,
  length: number,
): Uint8Array {
  return expand(
    sha256,
    prk,
    concat(i2osp(length, 2), ascii('HPKE-v1'), suite, ascii(label), info),
    length,
  )
}

/** §4.1: the shared secret, bound to both public keys. */
function extractAndExpand(dh: Uint8Array, kemContext: Uint8Array): Uint8Array {
  const eaePrk = labeledExtract(KEM_SUITE, EMPTY, 'eae_prk', dh)
  return labeledExpand(KEM_SUITE, eaePrk, 'shared_secret', kemContext, N_SECRET)
}

/** §5.1, in the base mode: no pre-shared key. */
function keySchedule(
  sharedSecret: Uint8Array,
  info: Uint8Array,
): { readonly key: Uint8Array; readonly baseNonce: Uint8Array } {
  const pskIdHash = labeledExtract(HPKE_SUITE, EMPTY, 'psk_id_hash', EMPTY)
  const infoHash = labeledExtract(HPKE_SUITE, EMPTY, 'info_hash', info)
  const context = concat(Uint8Array.of(MODE_BASE), pskIdHash, infoHash)
  const secret = labeledExtract(HPKE_SUITE, sharedSecret, 'secret', EMPTY)
  return {
    key: labeledExpand(HPKE_SUITE, secret, 'key', context, N_K),
    baseNonce: labeledExpand(HPKE_SUITE, secret, 'base_nonce', context, N_N),
  }
}

/** A fresh key pair, from the platform's secure randomness. */
export function generateKeyPair(): KeyPair {
  const { secretKey, publicKey } = x25519.keygen()
  return { secretKey, publicKey }
}

/** §7.1.3: the key pair `ikm` determines. What the RFC's vectors start from. */
export function deriveKeyPair(ikm: Uint8Array): KeyPair {
  const dkpPrk = labeledExtract(KEM_SUITE, EMPTY, 'dkp_prk', ikm)
  const secretKey = labeledExpand(KEM_SUITE, dkpPrk, 'sk', EMPTY, N_SK)
  return { secretKey, publicKey: publicKeyOf(secretKey) }
}

/** The public half of `secretKey`. */
export function publicKeyOf(secretKey: Uint8Array): Uint8Array {
  return x25519.getPublicKey(secretKey)
}

/**
 * Seals `plaintext` for `recipientPublicKey`, under an ephemeral key drawn
 * for this message alone.
 *
 * Throws for a public key X25519 refuses: one of low order.
 */
export function seal(
  recipientPublicKey: Uint8Array,
  info: Uint8Array,
  aad: Uint8Array,
  plaintext: Uint8Array,
): Sealed {
  return sealWithEphemeral(
    generateKeyPair(),
    recipientPublicKey,
    info,
    aad,
    plaintext,
  )
}

/**
 * `seal`, under the ephemeral key given: FOR THE RFC'S VECTORS ONLY, which fix
 * it. The same ephemeral key used twice for the same recipient gives the same
 * key and nonce to two messages, and gives both away.
 */
export function sealWithEphemeral(
  ephemeral: KeyPair,
  recipientPublicKey: Uint8Array,
  info: Uint8Array,
  aad: Uint8Array,
  plaintext: Uint8Array,
): Sealed {
  const dh = x25519.getSharedSecret(ephemeral.secretKey, recipientPublicKey)
  const enc = ephemeral.publicKey
  const { key, baseNonce } = keySchedule(
    extractAndExpand(dh, concat(enc, recipientPublicKey)),
    info,
  )
  return {
    enc,
    ciphertext: chacha20poly1305(key, baseNonce, aad).encrypt(plaintext),
  }
}

/**
 * The plaintext `sealed` holds, or `null` when this secret key does not open
 * it: sealed for another key, for another `info` or `aad`, or altered on the
 * way.
 */
export function open(
  recipientSecretKey: Uint8Array,
  sealed: Sealed,
  info: Uint8Array,
  aad: Uint8Array,
): Uint8Array | null {
  try {
    const dh = x25519.getSharedSecret(recipientSecretKey, sealed.enc)
    const recipientPublicKey = publicKeyOf(recipientSecretKey)
    const { key, baseNonce } = keySchedule(
      extractAndExpand(dh, concat(sealed.enc, recipientPublicKey)),
      info,
    )
    return chacha20poly1305(key, baseNonce, aad).decrypt(sealed.ciphertext)
  } catch {
    return null
  }
}
