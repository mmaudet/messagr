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
 *
 * The invitation service takes one to sixteen blocks (`report.rs`): a
 * payload of `MOST_PAYLOAD_BYTES`, 65,535 bytes, at most. The application
 * checks it before sealing, since a longer one could never be sent.
 *
 * # THE PAYLOAD, WHAT THE OPERATOR READS (#468)
 *
 * What the application seals is one JSON object, in UTF-8 (`payloadBytes`),
 * assembled in memory and never written anywhere (ADR 0006):
 *
 *     {
 *       "format": 1,
 *       "reason": "harassment",
 *       "reported_at": 1790000060000,
 *       "reporting_account": "@alice:example.org",
 *       "reported_account": "@bob:example.org",
 *       "room_id": "!room:example.org",
 *       "messages": [
 *         {
 *           "event_id": "$first",
 *           "sent_at": 1790000000000,
 *           "sender": "@bob:example.org",
 *           "text": "…"
 *         },
 *         {
 *           "event_id": "$second",
 *           "sent_at": 1790000030000,
 *           "sender": "@bob:example.org",
 *           "photograph": {
 *             "file": {
 *               "v": "v2",
 *               "key": {
 *                 "kty": "oct",
 *                 "key_ops": ["encrypt", "decrypt"],
 *                 "alg": "A256CTR",
 *                 "k": "…",
 *                 "ext": true
 *               },
 *               "iv": "…",
 *               "hashes": { "sha256": "…" },
 *               "url": "mxc://example.org/AbCdEf"
 *             },
 *             "mimetype": "image/jpeg",
 *             "name": "image.jpg",
 *             "size": 482113
 *           }
 *         }
 *       ]
 *     }
 *
 * - `format`: this payload's number, 1. Another is refused, not guessed at.
 *   Photographs and documents (#471) came without changing it: a report of
 *   words is written exactly as #468 wrote it, so every report sealed before
 *   still reads, and a reader that knows only words shows a report carrying
 *   a file as it is rather than reading it wrong.
 * - `reason`: the reason's code, the same as the one bound to the seal.
 * - `reported_at`: when the report was made, in milliseconds since the
 *   epoch, by the reporting device's clock.
 * - `reporting_account`: the account ID that reports, the same as the one
 *   bound to the seal.
 * - `reported_account`: the one account every message is from. A report
 *   names one.
 * - `room_id`: the Matrix room the messages were read in, which a takedown
 *   needs.
 * - `messages`: the messages the person selected, one at least, in the order
 *   the conversation reads them, and nothing else of the conversation. Each
 *   carries its `event_id`, which a takedown redacts, the homeserver's
 *   `sent_at` in milliseconds, its `sender` as the event names it, and
 *   exactly one of:
 *   - `text`, its words as the device showed them;
 *   - `photograph` or `document` (#471), the description of its encrypted
 *     file, never the file: `file` is Matrix's `EncryptedFile` as the event
 *     carried it, whose `url` is the address of the encrypted copy on the
 *     homeserver, `key` the JSON Web Key that opens it (AES-256-CTR, its
 *     `k`), `iv` the counter it starts from, and `hashes.sha256` the hash of
 *     the encrypted copy (`encryptedFileOf` says what must be there); then
 *     its `mimetype`, its `name` and its `size` in bytes, as the event
 *     states them, each `null` when it states none. A photograph's name is
 *     the one its sender gave for clients that cannot draw it (`image.jpg`
 *     from this application).
 *
 * Nothing is uploaded again: the operator downloads the encrypted copy
 * already on the homeserver, checks its hash, and opens it on its own
 * machine, on demand (`scripts/ouvrir-un-signalement.mjs`). A description
 * weighs a few hundred bytes, whatever the file weighs.
 */

/**
 * The eight reasons of the terms, in their order, by the codes the service
 * takes (`services/invitations/src/report.rs`) and the seal binds.
 */
export const REPORT_REASONS = [
  'child_sexual_abuse',
  'threat',
  'harassment',
  'impersonation',
  'hate',
  'sexual_without_consent',
  'solicitation',
  'other_illegal',
] as const

export type ReportReason = (typeof REPORT_REASONS)[number]

/** The two fields of a report the service keeps unsealed, bound to it. */
export interface ReportBinding {
  /** The reason code, as the service records it. */
  readonly reason: ReportReason
  /** The reporting account's ID, as the service authenticates it. */
  readonly reporter: string
}

/**
 * Matrix's `EncryptedFile`, as the event that carried a photograph or a
 * document gave it: where its encrypted copy is, and what opens and checks
 * it. `encryptedFileOf` says what must be there; the rest is carried as the
 * event gave it.
 */
export interface EncryptedFile {
  /** The address of the encrypted copy on the homeserver, `mxc://…`. */
  readonly url: string
  /** The JSON Web Key that opens it: AES-256-CTR, its `k` in base64url. */
  readonly key: { readonly k: string; readonly [field: string]: unknown }
  /** The counter the decryption starts from, in unpadded base64. */
  readonly iv: string
  /** Its `sha256` is the hash of the encrypted copy, in unpadded base64. */
  readonly hashes: {
    readonly sha256: string
    readonly [field: string]: unknown
  }
  readonly [field: string]: unknown
}

/** A photograph or a document a report carries: never its bytes. */
export interface ReportedFile {
  readonly file: EncryptedFile
  /** Its type, as the event states it, or `null`. */
  readonly mimetype: string | null
  /** Its name, as the event states it, or `null`. */
  readonly name: string | null
  /** Its size in bytes, as the event states it, or `null`. */
  readonly size: number | null
}

/** Where a message a report carries comes from. */
interface Sent {
  /** The event's identifier, which a takedown redacts. */
  readonly eventId: string
  /** The homeserver's timestamp, in milliseconds since the epoch. */
  readonly sentAt: number
  /** Who the event says sent it. */
  readonly sender: string
}

/**
 * A message a report carries, as the reporting device read it: its words,
 * or the description of the photograph or the document it is.
 */
export type ReportedMessage =
  | (Sent & { readonly text: string })
  | (Sent & { readonly photograph: ReportedFile })
  | (Sent & { readonly document: ReportedFile })

/** What a report carries, sealed: see « THE PAYLOAD » above. */
export interface ReportPayload {
  /** The reason's code. */
  readonly reason: ReportReason
  /** When the report was made, in milliseconds since the epoch. */
  readonly reportedAt: number
  /** The account ID that reports. */
  readonly reportingAccount: string
  /** The account ID every message is from. */
  readonly reportedAccount: string
  /** The Matrix room the messages were read in. */
  readonly roomId: string
  /** One at least, in the order the conversation reads them. */
  readonly messages: readonly ReportedMessage[]
}

/** Why `fromWire` refused: another format's number, or not a report's size. */
type WireRefusal = 'format' | 'size'

/** HPKE's `info` for every report, and for nothing else. */
export const REPORT_INFO = ascii('messagr report v1')
/** The first byte of every sealed report: this format's number. */
export const REPORT_FORMAT = 0x01
/** The payload's own number, inside the seal. */
const PAYLOAD_FORMAT = 1
/** The payload is padded to a multiple of this. */
const BLOCK_BYTES = 4096
/** The most blocks the service takes (`report.rs`). */
const MOST_BLOCKS = 16
/**
 * The longest payload the service takes: sixteen blocks, less the byte that
 * ends the payload inside its padding. A longer one could never be sent.
 */
export const MOST_PAYLOAD_BYTES = MOST_BLOCKS * BLOCK_BYTES - 1
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

/** The bytes of `payload`, as the format lays them out, to be sealed. */
export function payloadBytes(payload: ReportPayload): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      format: PAYLOAD_FORMAT,
      reason: payload.reason,
      reported_at: payload.reportedAt,
      reporting_account: payload.reportingAccount,
      reported_account: payload.reportedAccount,
      room_id: payload.roomId,
      messages: payload.messages.map(message => ({
        event_id: message.eventId,
        sent_at: message.sentAt,
        sender: message.sender,
        ...carriedBy(message),
      })),
    }),
  )
}

/** What a message carries, as the payload writes it: see « THE PAYLOAD ». */
function carriedBy(message: ReportedMessage): object {
  if ('text' in message) return { text: message.text }
  return 'photograph' in message
    ? { photograph: fileFields(message.photograph) }
    : { document: fileFields(message.document) }
}

function fileFields(file: ReportedFile): object {
  return {
    file: file.file,
    mimetype: file.mimetype,
    name: file.name,
    size: file.size,
  }
}

/** What JSON gives back, read field by field. */
type Fields = { readonly [field: string]: unknown } | null

/**
 * The payload `bytes` hold, or `null` when they are not one the format
 * writes: not UTF-8, not JSON, another format's number, a reason outside the
 * eight, a field missing or of another type, no message, or a message that
 * carries not exactly one of words, a photograph or a document.
 *
 * Read field by field: JSON's `null`, a number, a string or a list has none
 * of these fields, and fails the first test that asks for one.
 */
export function payloadOf(bytes: Uint8Array): ReportPayload | null {
  let value: Fields
  try {
    value = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    ) as Fields
  } catch {
    return null
  }
  const messages = Array.isArray(value?.messages)
    ? value.messages.map(messageOf)
    : []
  if (
    value?.format !== PAYLOAD_FORMAT ||
    !isReason(value.reason) ||
    typeof value.reported_at !== 'number' ||
    typeof value.reporting_account !== 'string' ||
    typeof value.reported_account !== 'string' ||
    typeof value.room_id !== 'string' ||
    messages.length === 0 ||
    messages.some(message => message === null)
  ) {
    return null
  }
  return {
    reason: value.reason,
    reportedAt: value.reported_at,
    reportingAccount: value.reporting_account,
    reportedAccount: value.reported_account,
    roomId: value.room_id,
    messages: messages as ReportedMessage[],
  }
}

/** What a message may carry, one of them exactly. */
const CARRIED = ['text', 'photograph', 'document'] as const

/**
 * A message of a payload, or `null` when a field is missing or mistyped, or
 * when it carries not exactly one of words, a photograph or a document.
 */
function messageOf(value: unknown): ReportedMessage | null {
  const fields = value as Fields
  if (
    typeof fields?.event_id !== 'string' ||
    typeof fields.sent_at !== 'number' ||
    typeof fields.sender !== 'string'
  ) {
    return null
  }
  const sent: Sent = {
    eventId: fields.event_id,
    sentAt: fields.sent_at,
    sender: fields.sender,
  }
  const carried = CARRIED.filter(one => fields[one] !== undefined)
  if (carried.length !== 1) return null
  if (carried[0] === 'text') {
    return typeof fields.text === 'string'
      ? { ...sent, text: fields.text }
      : null
  }
  const file = reportedFileOf(fields[carried[0]!])
  if (file === null) return null
  return carried[0] === 'photograph'
    ? { ...sent, photograph: file }
    : { ...sent, document: file }
}

/** A photograph or a document of a payload, or `null`. */
function reportedFileOf(value: unknown): ReportedFile | null {
  const fields = value as Fields
  const file = encryptedFileOf(fields?.file)
  if (
    file === null ||
    !stringOrNull(fields?.mimetype) ||
    !stringOrNull(fields?.name) ||
    !(typeof fields?.size === 'number' || fields?.size === null)
  ) {
    return null
  }
  return {
    file,
    mimetype: fields.mimetype,
    name: fields.name,
    size: fields.size,
  }
}

/**
 * `value` as Matrix's `EncryptedFile`, or `null` when it lacks what opening
 * the file needs: an `mxc://` address, a key with its `k`, a counter, and the
 * encrypted copy's SHA-256 hash, each a string. Nothing else is required,
 * and whatever else the event gave is kept as it gave it.
 */
export function encryptedFileOf(value: unknown): EncryptedFile | null {
  const fields = value as Fields
  const key = fields?.key as Fields
  const hashes = fields?.hashes as Fields
  if (
    typeof fields?.url !== 'string' ||
    !fields.url.startsWith('mxc://') ||
    typeof key?.k !== 'string' ||
    typeof fields.iv !== 'string' ||
    typeof hashes?.sha256 !== 'string'
  ) {
    return null
  }
  return value as EncryptedFile
}

function stringOrNull(value: unknown): value is string | null {
  return typeof value === 'string' || value === null
}

function isReason(value: unknown): value is ReportReason {
  return (REPORT_REASONS as readonly unknown[]).includes(value)
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
