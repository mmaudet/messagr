import type { Sealed } from './hpke'

/**
 * The format of a report sealed for the operator key (#465, ADR 0015, the
 * glossary's « Report » and « Operator key »), written once for both sides:
 * the application, which seals (`sealedReport.ts`), and the operator's tool,
 * which opens on the operator's machine
 * (`scripts/lib/ouvrir-un-signalement.mjs`).
 *
 * # NOTHING IMPORTED AT RUN TIME, AND THAT IS THE POINT
 *
 * The operator's tools load this file under Node, which strips its types but
 * resolves no import without its extension, as the application writes them.
 * Its one import is a type, which the stripping erases. So the format is
 * stated here and nowhere else: the tool cannot drift from what the
 * application seals, and the store-build guard reads a key the way the
 * application does. The sizes of the suite are restated below rather than
 * taken from `hpke.ts`, for the same reason.
 *
 * # THE FORMAT, WHICH THE BRIDGE KEEPS (#482)
 *
 * HPKE (RFC 9180) in its base mode, with the suite of the declared name
 * (`hpke.ts`): DHKEM(X25519, HKDF-SHA256), HKDF-SHA256, ChaCha20-Poly1305,
 * single-shot. The recipient is the operator key's public half.
 *
 * - `info` is the ASCII of `messagr report v1`, and nothing else is sealed
 *   under it.
 * - The associated data binds the two fields the service keeps unsealed, the
 *   reason code and the reporting account's ID (`reportAad`):
 *
 *       I2OSP(len(reason), 2) || reason || I2OSP(len(reporter), 2) || reporter
 *
 *   Each field is 1 to 255 characters of printable ASCII, U+0021 to U+007E,
 *   so it has one encoding only. The account ID travels as the Matrix user ID
 *   the service authenticates the request as, which Matrix caps at 255
 *   characters. Changing either field after sealing makes the report refuse
 *   to open.
 * - The plaintext is the payload, then one byte 0x80, then zero bytes up to
 *   the next multiple of 4,096 (`padded`). Every report of up to 4,095 bytes
 *   has the same size on the wire, so the service learns little of what a
 *   report holds from its length, as the sealed name pads for the same
 *   reason.
 * - The sealed report is the format's number, one byte 0x01, then the
 *   encapsulated key, 32 bytes, then the ciphertext, which ends with its
 *   16-byte tag (`toWire`): 49 + 4,096 × k bytes, for k blocks.
 * - Inside JSON it travels as one string, in standard base64 with its padding
 *   (RFC 4648, section 4), as the sealed name does (`base64Bytes`).
 *
 * `scripts/fixtures/signalement-de-test.json` holds a sealed report computed
 * outside this repository from this description, under the ephemeral key of
 * RFC 9180's appendix A.2.1. The application must seal exactly those bytes,
 * the operator's tool open them, and a second construction of the RFC on
 * node:crypto alone (`scripts/fixtures/hpke-independant.mjs`) seals and opens
 * them too (`sealedReport.spec.ts`). So must the bridge.
 */

/** The two fields of a report the service keeps unsealed, bound to it. */
export interface ReportBinding {
  /** The reason code, as the service records it. */
  readonly reason: string
  /** The reporting account's ID, as the service authenticates it. */
  readonly reporter: string
}

/** Why `fromWire` refused: another format's number, or not a report's size. */
type WireRefusal = 'format' | 'size'

/** HPKE's `info` for every report, and for nothing else. */
export const REPORT_INFO = ascii('messagr report v1')
/** The first byte of every sealed report: this format's number. */
export const REPORT_FORMAT = 0x01
/** The payload is padded to a multiple of this. */
const BLOCK_BYTES = 4096
/** Nenc, the size of an encapsulated key in this suite. */
const ENC_BYTES = 32
/** Nt, the size of ChaCha20-Poly1305's tag. */
const TAG_BYTES = 16
/** The format's number, the encapsulated key and the tag. */
const OVERHEAD_BYTES = 1 + ENC_BYTES + TAG_BYTES
/** The byte that ends the payload inside its padding. */
const MARKER = 0x80
/** Printable ASCII, one to 255 characters. */
const FIELD = /^[\x21-\x7e]{1,255}$/
/**
 * Standard base64, padded, and written the one way it can be: the character
 * before the padding carries no bit beyond the last byte.
 */
const BASE64 =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/][AQgw]==|[A-Za-z0-9+/]{2}[AEIMQUYcgkosw048]=)?$/

/**
 * The associated data that binds a report to its reason and to its reporting
 * account's ID. Throws a `RangeError` for a field that is not 1 to 255
 * characters of printable ASCII.
 */
export function reportAad(binding: ReportBinding): Uint8Array {
  const reason = field('reason', binding.reason)
  const reporter = field('reporter', binding.reporter)
  const aad = new Uint8Array(2 + reason.length + 2 + reporter.length)
  aad.set(i2osp2(reason.length), 0)
  aad.set(reason, 2)
  aad.set(i2osp2(reporter.length), 2 + reason.length)
  aad.set(reporter, 2 + reason.length + 2)
  return aad
}

/** `payload`, then the marker byte, then zeros to a whole number of blocks. */
export function padded(payload: Uint8Array): Uint8Array {
  const blocks = Math.ceil((payload.length + 1) / BLOCK_BYTES)
  const plaintext = new Uint8Array(blocks * BLOCK_BYTES)
  plaintext.set(payload)
  plaintext[payload.length] = MARKER
  return plaintext
}

/**
 * The payload `plaintext` pads, or `null` when it is not padded as `padded`
 * pads: not whole blocks, or no marker byte before the zeros.
 */
export function unpadded(plaintext: Uint8Array): Uint8Array | null {
  if (plaintext.length === 0 || plaintext.length % BLOCK_BYTES !== 0) {
    return null
  }
  let end = plaintext.length - 1
  while (end >= 0 && plaintext[end] === 0) end -= 1
  return end >= 0 && plaintext[end] === MARKER
    ? plaintext.subarray(0, end)
    : null
}

/** The bytes of a sealed report: the format's number, `enc`, the ciphertext. */
export function toWire(sealed: Sealed): Uint8Array {
  const wire = new Uint8Array(1 + sealed.enc.length + sealed.ciphertext.length)
  wire[0] = REPORT_FORMAT
  wire.set(sealed.enc, 1)
  wire.set(sealed.ciphertext, 1 + sealed.enc.length)
  return wire
}

/**
 * The encapsulated key and the ciphertext `wire` carries, or why it is not a
 * sealed report of this format: another format's number, or a size that is
 * not 49 bytes and a whole number of blocks.
 */
export function fromWire(
  wire: Uint8Array,
):
  | { readonly ok: true; readonly sealed: Sealed }
  | { readonly ok: false; readonly refusal: WireRefusal } {
  if (wire[0] !== REPORT_FORMAT) return { ok: false, refusal: 'format' }
  const blocks = wire.length - OVERHEAD_BYTES
  if (blocks < BLOCK_BYTES || blocks % BLOCK_BYTES !== 0) {
    return { ok: false, refusal: 'size' }
  }
  return {
    ok: true,
    sealed: {
      enc: wire.subarray(1, 1 + ENC_BYTES),
      ciphertext: wire.subarray(1 + ENC_BYTES),
    },
  }
}

/**
 * The bytes `text` holds in standard base64, padded (RFC 4648, section 4),
 * or `null` for anything else: another alphabet, spaces, missing padding, or
 * bits left over after the last byte. So a sealed report or a key has one
 * spelling, which the service, the application and the tools read alike.
 */
export function base64Bytes(text: unknown): Uint8Array | null {
  if (typeof text !== 'string' || !BASE64.test(text)) return null
  return Uint8Array.from(atob(text), c => c.charCodeAt(0))
}

/**
 * The 32 bytes of an X25519 key, written in standard base64, or `null`. The
 * one reading of a key, for the application's (`operatorKey.ts`), the
 * store-build guard and the operator's key files.
 */
export function keyBytesOf(text: unknown): Uint8Array | null {
  const bytes = base64Bytes(text)
  return bytes?.length === 32 ? bytes : null
}

function field(name: string, value: string): Uint8Array {
  // `typeof` first: the operator's tool is JavaScript, where a number would
  // pass the pattern as its digits and then encode as nothing.
  if (typeof value !== 'string' || !FIELD.test(value)) {
    throw new RangeError(
      `${name}: 1 to 255 characters of printable ASCII, without spaces`,
    )
  }
  return ascii(value)
}

/** RFC 9180's I2OSP(length, 2): a length as two bytes, big-endian. */
function i2osp2(length: number): Uint8Array {
  return Uint8Array.of(Math.floor(length / 256), length % 256)
}

/** ASCII text, one byte per character. */
function ascii(text: string): Uint8Array {
  return Uint8Array.from(text, c => c.charCodeAt(0))
}
