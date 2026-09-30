import type { EncryptedFile } from '../timeline/encryptedFile'
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
 * Its imports are types, which the stripping erases. So the format is
 * stated here and nowhere else: the tool cannot drift from what the
 * application seals, and the store-build guard reads a key the way the
 * application does. The sizes of the suite are restated below rather than
 * taken from `hpke.ts`, for the same reason, and what opening a reported
 * file needs is said here once, for the application that reports it and the
 * tool that opens it (`openingOf`).
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
 *           "kind": "text",
 *           "text": "…"
 *         },
 *         {
 *           "event_id": "$second",
 *           "sent_at": 1790000030000,
 *           "sender": "@bob:example.org",
 *           "kind": "photograph",
 *           "file": {
 *             "v": "v2",
 *             "key": {
 *               "kty": "oct",
 *               "key_ops": ["encrypt", "decrypt"],
 *               "alg": "A256CTR",
 *               "k": "…",
 *               "ext": true
 *             },
 *             "iv": "…",
 *             "hashes": { "sha256": "…" },
 *             "url": "mxc://example.org/AbCdEf"
 *           },
 *           "mimetype": "image/jpeg",
 *           "name": "image.jpg",
 *           "size": 482113,
 *           "thumbnail": {
 *             "file": { "v": "v2", "key": { … }, "iv": "…", "hashes": { … },
 *                       "url": "mxc://example.org/GhIjKl" },
 *             "mimetype": "image/jpeg"
 *           }
 *         }
 *       ]
 *     }
 *
 * - `format`: this payload's number, 1. Another is refused, not guessed at.
 *   Photographs and documents (#471), then a photograph's thumbnail (#496),
 *   came without changing it: every report sealed before still reads. The
 *   reader of #468, which knows only words, still reads a report of words,
 *   whose messages only gained a `kind` it does not ask for, and shows a
 *   report carrying a file as it is rather than reading it wrong. The
 *   reader of #471 reads a photograph and leaves its `thumbnail` aside.
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
 *   `sent_at` in milliseconds, its `sender` as the event names it, and its
 *   `kind`, which says what else it carries and nothing else:
 *   - `text`: `text`, its words as the device showed them. A message of
 *     #468 has no `kind`: words were the only kind there was, and it is read
 *     as `text`.
 *   - `photograph` or `document` (#471): the description of its encrypted
 *     file, never the file. `file` is Matrix's `EncryptedFile` as the event
 *     carried it: `url`, the address of the encrypted copy on the
 *     homeserver; `key`, the JSON Web Key that opens it (AES-256-CTR, its
 *     `k`); `iv`, the counter it starts from; `hashes.sha256`, the hash of
 *     the encrypted copy. `openingOf` says what each must be for the file to
 *     open. Then its `mimetype`, its `name` and its `size` in bytes, as the
 *     event states them, each `null` when it states none. A photograph's name
 *     is the one its sender gave for clients that cannot draw it
 *     (`image.jpg` from this application).
 *   - A photograph's `thumbnail` too (#496), since the conversation draws a
 *     photograph from its thumbnail when it has one (`smallestCopyOf`), and
 *     the operator is to see what the person who reports saw: the
 *     description of the thumbnail's own encrypted file, `file`, as the
 *     event's `info.thumbnail_file` carried it, with its own key, and its
 *     `mimetype` as `info.thumbnail_info` states it, or `null`. `thumbnail`
 *     is `null` when the event has none, or one the operator could not open
 *     (`openingOf`): a thumbnail that fails is not a photograph that fails,
 *     and the photograph goes all the same. A photograph of #471 has no
 *     `thumbnail`, and reads as having none. A document carries none.
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

/** Where a message a report carries comes from. */
interface Sent {
  /** The event's identifier, which a takedown redacts. */
  readonly eventId: string
  /** The homeserver's timestamp, in milliseconds since the epoch. */
  readonly sentAt: number
  /** Who the event says sent it. */
  readonly sender: string
}

/** A message of words a report carries, as the device showed them. */
export interface ReportedWords extends Sent {
  readonly kind: 'text'
  readonly text: string
}

/**
 * What a photograph or a document a report carries has of its file: the
 * description of its encrypted file, never its bytes.
 */
interface Described extends Sent {
  /** Its encrypted file, as the event carried it: `openingOf` opens it. */
  readonly file: EncryptedFile
  /** Its type, as the event states it, or `null`. */
  readonly mimetype: string | null
  /** Its name, as the event states it, or `null`. */
  readonly name: string | null
  /** Its size in bytes, as the event states it, or `null`. */
  readonly size: number | null
}

/**
 * A photograph's thumbnail a report carries (#496): the description of its
 * own encrypted file, never its bytes.
 */
export interface ReportedThumbnail {
  /**
   * Its encrypted file, as `info.thumbnail_file` carried it, with a key of
   * its own: `openingOf` opens it.
   */
  readonly file: EncryptedFile
  /** Its type, as `info.thumbnail_info` states it, or `null`. */
  readonly mimetype: string | null
}

/** A photograph a report carries. */
export interface ReportedPhotograph extends Described {
  readonly kind: 'photograph'
  /**
   * Its thumbnail, what the conversation drew of it, or `null` when the
   * event has none, or one the operator could not open.
   */
  readonly thumbnail: ReportedThumbnail | null
}

/** A document a report carries. */
export interface ReportedDocument extends Described {
  readonly kind: 'document'
}

/** A photograph or a document a report carries. */
export type ReportedFile = ReportedPhotograph | ReportedDocument

/** A message a report carries, tagged by its `kind`. */
export type ReportedMessage = ReportedWords | ReportedFile

/**
 * What opening a reported file needs, read from its description: the
 * homeserver's media it is, and the key, the counter and the hash that open
 * and check its encrypted copy.
 */
export interface Opening {
  /** The server the media belongs to: `mxc://<server>/<mediaId>`. */
  readonly server: string
  /** The media's identifier on that server. */
  readonly mediaId: string
  /** The AES-256-CTR key, 32 bytes. */
  readonly key: Uint8Array
  /** The counter the decryption starts from, 16 bytes. */
  readonly counter: Uint8Array
  /** The SHA-256 hash of the encrypted copy, 32 bytes. */
  readonly sha256: Uint8Array
}

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
      messages: payload.messages.map(messageFields),
    }),
  )
}

/** A message as the payload writes it: see « THE PAYLOAD ». */
function messageFields(message: ReportedMessage): object {
  const sent = {
    event_id: message.eventId,
    sent_at: message.sentAt,
    sender: message.sender,
    kind: message.kind,
  }
  if (message.kind === 'text') return { ...sent, text: message.text }
  const described = {
    ...sent,
    file: message.file,
    mimetype: message.mimetype,
    name: message.name,
    size: message.size,
  }
  if (message.kind === 'document') return described
  const { thumbnail } = message
  return {
    ...described,
    thumbnail:
      thumbnail === null
        ? null
        : { file: thumbnail.file, mimetype: thumbnail.mimetype },
  }
}

/** What JSON gives back, read field by field. */
type Fields = { readonly [field: string]: unknown } | null

/**
 * The payload `bytes` hold, or `null` when they are not one the format
 * writes: not UTF-8, not JSON, another format's number, a reason outside the
 * eight, a field missing or of another type, no message, or a message that
 * is not exactly its `kind`.
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

/**
 * A message of a payload, by its `kind`, or `null` when a field is missing
 * or mistyped, or when it carries what another kind carries. A message of
 * #468, which has no `kind`, is words.
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
  const kind = fields.kind === undefined ? 'text' : fields.kind
  if (kind === 'text') {
    return typeof fields.text === 'string' &&
      fields.file === undefined &&
      fields.thumbnail === undefined
      ? { ...sent, kind, text: fields.text }
      : null
  }
  if (kind !== 'photograph' && kind !== 'document') return null
  const file = encryptedFileOf(fields.file)
  if (
    file === null ||
    fields.text !== undefined ||
    !stringOrNull(fields.mimetype) ||
    !stringOrNull(fields.name) ||
    !(typeof fields.size === 'number' || fields.size === null)
  ) {
    return null
  }
  const described = {
    ...sent,
    file,
    mimetype: fields.mimetype,
    name: fields.name,
    size: fields.size,
  }
  if (kind === 'document') {
    return fields.thumbnail === undefined ? { ...described, kind } : null
  }
  // A photograph of #471 has no `thumbnail`: it carries none.
  if (fields.thumbnail === undefined || fields.thumbnail === null) {
    return { ...described, kind, thumbnail: null }
  }
  const thumbnail = thumbnailOf(fields.thumbnail)
  return thumbnail === null ? null : { ...described, kind, thumbnail }
}

/**
 * A photograph's thumbnail as a payload carries it, or `null` when it is
 * not one the format writes: its file, which must open (`openingOf`), and
 * its type, text or `null`.
 */
function thumbnailOf(value: unknown): ReportedThumbnail | null {
  const fields = value as Fields
  const file = encryptedFileOf(fields?.file)
  const mimetype = fields?.mimetype
  return file !== null && stringOrNull(mimetype) ? { file, mimetype } : null
}

/**
 * A homeserver's media: the name of a server, then the media's identifier,
 * in the alphabet the specification gives it. Nothing that could leave a
 * URL path segment, or add one.
 */
const MXC = /^mxc:\/\/([A-Za-z0-9.:[\]-]+)\/([A-Za-z0-9_-]+)$/

/**
 * What opening the encrypted file `value` describes needs, or `null` when
 * it could not be opened: THE ONE DEFINITION, which the application reads
 * before it reports a file (`reportable`, through `encryptedFileOf`) and the
 * operator's tool before it downloads one (`ouvrir-un-fichier-signale.mjs`).
 *
 * An `mxc://` address of one media; a key of 32 bytes; a counter of 16
 * bytes; a SHA-256 hash of 32 bytes.
 *
 * # WHAT THE DISPLAY OPENS, AND NOTHING IT REFUSES (#496)
 *
 * A photograph the application shows is one it can report, and nothing the
 * application could not show is reported. The display decrypts through the
 * bridge (`decryptAttachment`), which reads a description as ruma-events
 * 0.34 reads one, then asks, as matrix-sdk-crypto does, for version 2 and a
 * SHA-256 hash. So it is read the same way here, for the application and
 * the tool alike:
 *
 * - `v` is `v2`;
 * - the JSON Web Key is `kty` `oct`, `alg` `A256CTR`, `key_ops` a list of
 *   words holding `encrypt` and `decrypt`, `ext` `true`, and `k` 32 bytes
 *   in the URL-safe alphabet of base64;
 * - `iv` is 16 bytes, and `hashes.sha256` 32, in the standard alphabet;
 * - every other hash in `hashes` is text in the standard alphabet too,
 *   which the display reads, and refuses when it cannot, whatever it is
 *   for;
 * - base64 as ruma reads it (`bytesOfBase64`): with its padding, part of it
 *   or none, and the bits of the last character beyond the last byte
 *   ignored. The other alphabet, more padding than the bytes need, a space
 *   or a byte more or less are refused, as the display refuses them.
 *
 * Fields the display does not read are left as they are. The address is the
 * one thing read more narrowly than the display reads it (`MXC`): every
 * address a homeserver gives passes, and nothing that could leave the path
 * of the operator's download. And the tool still checks the hash of what it
 * downloads before it decrypts anything.
 */
export function openingOf(value: unknown): Opening | null {
  const fields = value as Fields
  const jwk = fields?.key as Fields
  const hashes = fields?.hashes as Fields
  const media = typeof fields?.url === 'string' ? MXC.exec(fields.url) : null
  const key = ofLength(bytesOfBase64(jwk?.k, 'url'), 32)
  const counter = ofLength(bytesOfBase64(fields?.iv, 'standard'), 16)
  const sha256 = ofLength(bytesOfBase64(hashes?.sha256, 'standard'), 32)
  if (
    media === null ||
    key === null ||
    counter === null ||
    sha256 === null ||
    fields?.v !== 'v2' ||
    !isAesCtrKeyForBothWays(jwk) ||
    !Object.values(hashes ?? {}).every(
      hash => bytesOfBase64(hash, 'standard') !== null,
    )
  ) {
    return null
  }
  return { server: media[1]!, mediaId: media[2]!, key, counter, sha256 }
}

/**
 * Whether `jwk` is the JSON Web Key the display takes (`openingOf`): an
 * AES-256-CTR key that encrypts and decrypts, and says it is extractable.
 */
function isAesCtrKeyForBothWays(jwk: Fields): boolean {
  const operations = jwk?.key_ops
  return (
    jwk?.kty === 'oct' &&
    jwk.alg === 'A256CTR' &&
    jwk.ext === true &&
    Array.isArray(operations) &&
    operations.every(operation => typeof operation === 'string') &&
    operations.includes('encrypt') &&
    operations.includes('decrypt')
  )
}

/** `bytes` when they are `length` bytes, or `null`. */
function ofLength(bytes: Uint8Array | null, length: number): Uint8Array | null {
  return bytes?.length === length ? bytes : null
}

/**
 * `value` as Matrix's `EncryptedFile`, kept as the event gave it, or `null`
 * when it could not be opened (`openingOf`).
 */
export function encryptedFileOf(value: unknown): EncryptedFile | null {
  return openingOf(value) === null ? null : (value as EncryptedFile)
}

/** The characters of each alphabet of base64, without its padding. */
const ALPHABETS = {
  standard: /^[A-Za-z0-9+/]*$/,
  url: /^[A-Za-z0-9_-]*$/,
} as const

/** The standard alphabet, each character at its value. */
const STANDARD_SYMBOLS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/**
 * The bytes `text` holds in base64 of `alphabet`, as ruma reads an
 * encrypted file's for the display (`openingOf`): characters of the
 * alphabet, never one alone past a whole block, then their padding, whole,
 * in part or none, the bits of the last character beyond the last byte
 * ignored. `null` for anything else.
 */
function bytesOfBase64(
  text: unknown,
  alphabet: keyof typeof ALPHABETS,
): Uint8Array | null {
  if (typeof text !== 'string') return null
  const written = text.replace(/[=]+$/, '')
  const padding = (4 - (written.length % 4)) % 4
  if (
    written.length % 4 === 1 ||
    !ALPHABETS[alphabet].test(written) ||
    text.length - written.length > padding
  ) {
    return null
  }
  if (written === '') return new Uint8Array(0)
  const standard =
    alphabet === 'url' ? written.replace(/-/g, '+').replace(/_/g, '/') : written
  // The last character without the bits beyond the last byte, its lowest
  // ones: the one spelling of those bytes, which `base64Bytes` reads.
  const beyond = (written.length * 6) % 8
  const last = STANDARD_SYMBOLS.indexOf(standard.slice(-1))
  const kept = last - (last % 2 ** beyond)
  return base64Bytes(
    standard.slice(0, -1) + STANDARD_SYMBOLS[kept] + '='.repeat(padding),
  )
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
