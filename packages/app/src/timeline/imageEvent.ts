import type { PickedImage } from '../runtime/pickImage'

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
 * # `body` is not the filename
 *
 * A filename off somebody's camera roll carries a date, sometimes a place,
 * occasionally a person's name. It travels inside the conversation's
 * encryption like everything else, so this is not a disclosure to the server
 * — but it is a disclosure to whoever is in the conversation, and nobody
 * chose to make it by choosing a photograph. `body` is the fallback a client
 * shows when it cannot render the picture, and "image.jpg" does that job.
 */

export interface ImageContent {
  readonly msgtype: 'm.image'
  readonly body: string
  readonly info: {
    readonly mimetype: string
    readonly w: number
    readonly h: number
    readonly size: number
  }
  /** The address and the key material, which Matrix keeps in one object. */
  readonly file: Record<string, unknown>
}

/** What a received image amounts to, once it has been read defensively. */
export interface ReadImage {
  readonly url: string
  /** Handed back to `decryptAttachment` unchanged — minus the address. */
  readonly secret: string
  readonly mimeType: string | null
  readonly width: number | null
  readonly height: number | null
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
  /** Where the ciphertext was uploaded. */
  url: string,
  /** `SealedAttachment.secret`, verbatim. */
  secret: string,
): ImageContent {
  let material: unknown
  try {
    material = JSON.parse(secret)
  } catch {
    throw new Error('the attachment secret is not readable')
  }
  if (material === null || typeof material !== 'object') {
    throw new Error('the attachment secret is not an object')
  }

  return {
    msgtype: 'm.image',
    body: `image.${EXTENSIONS[image.mimeType] ?? 'bin'}`,
    info: {
      mimetype: image.mimeType,
      w: image.width,
      h: image.height,
      size: image.bytes.length,
    },
    // The address first, so a secret that somehow carried one cannot
    // overwrite where the bytes actually went.
    file: { ...(material as Record<string, unknown>), url },
  }
}

export function readImageEvent(
  content: Record<string, unknown>,
): ReadImage | null {
  if (content.msgtype !== 'm.image') return null

  const file = content.file
  // An unencrypted `m.image` in an encrypted conversation is refused rather
  // than rendered. This application does not fetch plaintext media, and
  // showing one would say the conversation carries things it does not.
  if (file === null || typeof file !== 'object') return null

  const { url, ...material } = file as Record<string, unknown>
  if (typeof url !== 'string' || url === '') return null

  const info = asRecord(content.info)
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : null
}
