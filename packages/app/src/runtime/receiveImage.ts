import type { ReadImage } from '../timeline/imageEvent'
import { getErrorMessage } from './errors'

/**
 * Getting a photograph back: download, decrypt, and hand a screen something
 * it can draw.
 *
 * # Why a data URI and not a file
 *
 * `<Image>` takes a URI. The obvious one is a path to a decrypted file, and
 * ADR-0006 forbids exactly that: nothing decrypted goes to disk. So the
 * plaintext stays in memory and reaches the view as `data:` — which the
 * platform's image loader accepts, and which no other process can read.
 *
 * The cost is honest and worth stating: a data URI is the image base64'd,
 * so it is a third larger than the file and it lives as a JavaScript string
 * for as long as the view holds it. That bounds how large a photograph this
 * application can show, and it is the same bound `LARGEST_IMAGE_BYTES`
 * already puts on sending. A product that needed to show fifty-megapixel
 * images would need a decrypting image loader on the native side, which is a
 * different piece of work and not a bigger buffer.
 *
 * # Two failures, told apart
 *
 * The bridge distinguishes a malformed secret from bytes that are not what
 * the secret announced, and that distinction survives to here: the first is
 * a bug upstream of the download, the second is a download worth making
 * again. A screen that said "could not show this image" for both would throw
 * away the only actionable half.
 */

export interface ImageSource {
  readonly download: (url: string) => Promise<Uint8Array>
  /** `decryptAttachment`, behind a port. */
  readonly open: (ciphertext: Uint8Array, secret: string) => Promise<Uint8Array>
}

export type ShownImage =
  | { readonly shown: true; readonly uri: string }
  | { readonly shown: false; readonly reason: string }

/** What a photograph is when its sender did not say. */
const ASSUMED_TYPE = 'image/jpeg'

export async function fetchImage(
  source: ImageSource,
  image: ReadImage,
): Promise<ShownImage> {
  try {
    const ciphertext = await source.download(image.url)
    const plaintext = await source.open(ciphertext, image.secret)
    const type = image.mimeType ?? ASSUMED_TYPE
    return { shown: true, uri: `data:${type};base64,${base64Of(plaintext)}` }
  } catch (cause: unknown) {
    return { shown: false, reason: getErrorMessage(cause) }
  }
}

const ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/**
 * Bytes to base64, written out rather than reached for.
 *
 * Hermes has no `Buffer`, and `btoa` takes a string — which means going
 * through a string conversion that mangles every byte above 127, and a
 * photograph is nothing but bytes above 127. Three bytes to four characters,
 * padded, is small enough to write correctly and is tested against every
 * byte value there is.
 *
 * `no-bitwise` is off for the body and nowhere else. The rule is there to
 * catch a `&` written where `&&` was meant; base64 is bit manipulation by
 * definition, and rewriting it in arithmetic to satisfy a lint would make it
 * slower and harder to check against the definition.
 */
/* eslint-disable no-bitwise */
export function base64Of(bytes: Uint8Array): string {
  let out = ''
  for (let at = 0; at < bytes.length; at += 3) {
    const one = bytes[at]!
    const two = bytes[at + 1]
    const three = bytes[at + 2]

    out += ALPHABET[one >> 2]
    out += ALPHABET[((one & 0b11) << 4) | ((two ?? 0) >> 4)]
    out +=
      two === undefined
        ? '='
        : ALPHABET[((two & 0b1111) << 2) | ((three ?? 0) >> 6)]
    out += three === undefined ? '=' : ALPHABET[three & 0b111111]
  }
  return out
}
/* eslint-enable no-bitwise */
