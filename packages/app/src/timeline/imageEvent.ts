import { fileOf, type Uploaded } from './encryptedFile'

import type { ImageBytes, PickedImage } from '../runtime/pickImage'

/**
 * An image, as the event that carries it.
 *
 * # The secret is read, and the bridge says not to
 *
 * `SealedAttachment.secret` is documented as opaque: *« you have no reason to
 * read it »*. There is exactly one, and it is worth writing down rather than
 * doing quietly.
 *
 * Matrix already has a place for this. An encrypted `m.image` carries a
 * `file` object holding the address **and** the key material — `v`, `key`,
 * `iv`, `hashes` — and that object is byte-for-byte what the bridge
 * serialises into `secret`, because both are `MediaEncryptionInfo`. Putting
 * the secret in unparsed, as a string beside a `url`, would produce an event
 * only this application could read, in a protocol whose whole point is that
 * it is not only this application. So the secret is parsed, the address is
 * added to it, and what goes out is an ordinary encrypted image that Element
 * renders.
 *
 * The cost of reading it is having to say what happens when it is not what
 * was expected, which is why `describeImage` refuses rather than sending an
 * event nobody can open.
 *
 * # The thumbnail is a second file with a second key
 *
 * `info.thumbnail_file` is the same `EncryptedFile` shape as `file`, and it
 * holds a key of its own because it is a separate sealing: a server cannot
 * thumbnail ciphertext, so the sender is the only party who can produce one,
 * and it is sealed the way the photograph is. Sharing the photograph's key
 * would be an invention — the specification gives the thumbnail its own file
 * object precisely so it is an independent one — and it would also mean that
 * anyone handed the thumbnail's key could open the photograph.
 *
 * `info.thumbnail_info` carries the thumbnail's own width, height, type and
 * size rather than the photograph's, because a picker is free to re-encode
 * and a screen sizing a tile from the wrong numbers reflows when the picture
 * lands.
 *
 * # An event with no thumbnail is the ordinary case, not a defect
 *
 * Every photograph sent before #117 has none, as does every one sent by a
 * client that does not make them. `readImageEvent` answers `null` for the
 * thumbnail and `smallestCopyOf` falls back to the photograph, which is the
 * behaviour that already existed.
 *
 * # `body` is not the filename
 *
 * A filename off somebody's camera roll carries a date, sometimes a place,
 * occasionally a person's name. It travels inside the conversation's
 * encryption like everything else, so this is not a disclosure to the server
 * — but it is a disclosure to whoever is in the conversation, and nobody
 * chose to make it by choosing a photograph. `body` is the fallback a client
 * shows when it cannot render the picture, and "image.jpg" does that job.
 */

export type { Uploaded } from './encryptedFile'

/** What a picture is, as `info` states it. Matrix's `ThumbnailInfo` shape. */
interface StatedInfo {
  readonly mimetype: string
  readonly w: number
  readonly h: number
  readonly size: number
}

export interface ImageContent {
  readonly msgtype: 'm.image'
  readonly body: string
  readonly info: StatedInfo & {
    /** The thumbnail's own address and key material. Absent when there is none. */
    readonly thumbnail_file?: Record<string, unknown>
    /** The thumbnail's own dimensions, type and size — never the photograph's. */
    readonly thumbnail_info?: StatedInfo
  }
  /** The address and the key material, which Matrix keeps in one object. */
  readonly file: Record<string, unknown>
}

/**
 * One encrypted file, as much of it as a screen needs to fetch and draw it.
 *
 * A thumbnail is a file in exactly this sense, which is why the shape is
 * named rather than repeated: everything that downloads and decrypts takes
 * one of these and does not care which of the two it was handed.
 */
export interface ReadFile {
  readonly url: string
  /** Handed back to `decryptAttachment` unchanged — minus the address. */
  readonly secret: string
  readonly mimeType: string | null
  readonly width: number | null
  readonly height: number | null
}

/** What a received image amounts to, once it has been read defensively. */
export interface ReadImage extends ReadFile {
  /**
   * The sender's own downscaled copy, when they sent one.
   *
   * `null` rather than absent: an event without a thumbnail is the common
   * case rather than the exception, and a field that is sometimes missing is
   * one every caller forgets to consider.
   */
  readonly thumbnail: ReadFile | null
}

/** Extensions by type, for the fallback name only. */
const EXTENSIONS: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/heic': 'heic',
}

export function describeImage(
  image: PickedImage,
  /** Where the photograph's ciphertext went, and its key. */
  photograph: Uploaded,
  /** The same for the thumbnail, or `null` when none was made. */
  thumbnail: Uploaded | null,
): ImageContent {
  const small = image.thumbnail

  // A thumbnail whose bytes were never picked cannot be described, and an
  // address with no dimensions beside it is an `info` a recipient cannot size
  // a tile from. Refusing the pair outright beats emitting half of it.
  if (thumbnail !== null && small === undefined) {
    throw new Error('a thumbnail was uploaded for an image that has none')
  }

  return {
    msgtype: 'm.image',
    body: `image.${EXTENSIONS[image.mimeType] ?? 'bin'}`,
    info: {
      ...statedInfoOf(image),
      // The second half of the test is the type system's rather than the
      // product's: the throw above has already ruled it out.
      ...(thumbnail === null || small === undefined
        ? {}
        : {
            thumbnail_file: fileOf(thumbnail),
            thumbnail_info: statedInfoOf(small),
          }),
    },
    file: fileOf(photograph),
  }
}

function statedInfoOf(image: ImageBytes): StatedInfo {
  return {
    mimetype: image.mimeType,
    w: image.width,
    h: image.height,
    size: image.bytes.length,
  }
}

export function readImageEvent(
  content: Record<string, unknown>,
): ReadImage | null {
  if (content.msgtype !== 'm.image') return null

  const info = asRecord(content.info)
  const photograph = readFile(content.file, info)
  // An unencrypted `m.image` in an encrypted conversation is refused rather
  // than rendered. This application does not fetch plaintext media, and
  // showing one would say the conversation carries things it does not.
  if (photograph === null) return null

  return {
    ...photograph,
    // A thumbnail this application cannot read costs nothing: the photograph
    // is still there and still draws. So a malformed one is dropped rather
    // than taking the picture down with it.
    thumbnail: readFile(info?.thumbnail_file, asRecord(info?.thumbnail_info)),
  }
}

function readFile(
  file: unknown,
  info: Record<string, unknown> | null,
): ReadFile | null {
  if (file === null || typeof file !== 'object') return null

  const { url, ...material } = file as Record<string, unknown>
  if (typeof url !== 'string' || url === '') return null

  return {
    url,
    // The address comes off again: `decryptAttachment` is given what the
    // bridge produced, and `url` was not part of it.
    secret: JSON.stringify(material),
    mimeType: typeof info?.mimetype === 'string' ? info.mimetype : null,
    width: typeof info?.w === 'number' ? info.w : null,
    height: typeof info?.h === 'number' ? info.h : null,
  }
}

/**
 * The copy to fetch for a surface that is not the full-screen viewer.
 *
 * A plate tile is about 130 points and a conversation bubble not much more,
 * and the photograph behind either can be twelve megabytes: the download, the
 * decryption and the base64 all scale with a size neither surface can use, and
 * so does the `data:` URI that then sits in memory. The thumbnail is the same
 * picture at a few per cent of the bytes.
 *
 * Falling back to the photograph is not a degradation to apologise for. It is
 * what every event sent before #117 needs, which is most of them.
 */
export function smallestCopyOf(image: ReadImage): ReadFile {
  return image.thumbnail ?? image
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : null
}
