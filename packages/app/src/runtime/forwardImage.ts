import type { ImageSource } from './receiveImage'
import type { ReadFile } from '../timeline/imageEvent'
import type { ImageBytes } from './pickImage'
import { getErrorMessage } from './errors'

/**
 * A photograph, taken out of one conversation and made ready for another.
 *
 * # RE-SEALED, NEVER RE-SENT
 *
 * An `m.image` carries the key to its own file. Forwarding the event
 * verbatim would hand that key to a conversation with no right to it --
 * which is not a copy, it is access to the original upload, for everybody in
 * the destination, for ever. #169 and #194 both say so.
 *
 * So a forward is: download, decrypt, and hand the plaintext to `sendImage`,
 * which seals it afresh with a key of its own and uploads it again. The two
 * conversations end up holding two unrelated files that happen to look
 * alike, which is exactly what they should be.
 *
 * # IT DOWNLOADS AGAIN, DELIBERATELY
 *
 * `fetchImage` decrypts to a `data:` URI and keeps only that -- the bytes
 * are discarded, and decoding base64 back to bytes needs a decoder this
 * application does not carry. Rather than widen that cache to hold two
 * shapes of the same picture, a forward pays for its own round trip. It is
 * a deliberate, rare gesture, and paying for it once beats holding every
 * photograph twice for the ones nobody forwards.
 *
 * # NO THUMBNAIL
 *
 * `sendImage` takes an optional one and the sender's picker is what usually
 * makes it. There is no picker here, and re-encoding a downscaled copy on
 * the JavaScript thread is what `receiveImage.ts` measures as the slowest
 * part of drawing a photograph at all. The destination gets the full
 * picture, which is the picture.
 */

export type ImageForwarded =
  | { readonly ready: true; readonly image: ImageBytes }
  | { readonly ready: false; readonly reason: string }

export async function openForForward(
  source: ImageSource,
  image: ReadFile,
): Promise<ImageForwarded> {
  try {
    const ciphertext = await source.download(image.url)
    const plaintext = await source.open(ciphertext, image.secret)
    return {
      ready: true,
      image: {
        bytes: plaintext,
        mimeType: image.mimeType ?? ASSUMED_TYPE,
        // THE ORIGINAL'S DIMENSIONS, BECAUSE NOTHING HERE CAN MEASURE THEM.
        //
        // Decoding a JPEG to ask how wide it is means a decoder, on the
        // JavaScript thread, for a number the sender already wrote down.
        // A zero is honest when they did not: `sendImage` carries it through
        // to `info`, and a recipient sizing a tile from zero falls back to
        // the proportions it draws by default -- the same thing it does for
        // a photograph from a client that said nothing.
        width: image.width ?? 0,
        height: image.height ?? 0,
      },
    }
  } catch (cause: unknown) {
    return { ready: false, reason: getErrorMessage(cause) }
  }
}

/** What a photograph is when its sender did not say. The same value `receiveImage` assumes. */
const ASSUMED_TYPE = 'image/jpeg'
