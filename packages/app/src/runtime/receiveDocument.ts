import type { ReadDocument } from '../timeline/fileEvent'
import { getErrorMessage } from './errors'
import { base64Of, type ImageSource } from './receiveImage'

/**
 * Fetching a document somebody sent, for the one gesture that asks for it.
 *
 * # No cache, and that is the whole difference from `receiveImage.ts`
 *
 * `fetchImage` holds twelve `data:` URIs, because a photograph is drawn on
 * several surfaces -- a bubble, a plate, a full screen -- and fetching it
 * again for each would pay the download, the decryption and the base64 three
 * times over.
 *
 * A document is drawn nowhere. Its row shows a name and a size, both read
 * off the event, and the bytes are wanted exactly once: when somebody asks
 * to save it. Holding twelve of them would be the crash `MOST_HELD` exists
 * to prevent, in a module that has no reason to hold any.
 *
 * # Base64 rather than bytes
 *
 * What happens next is `keepDocument.ts`, which writes to a path through the
 * file system library -- and that library takes base64. Handing back bytes
 * would mean every caller converting them the same way.
 */

export type DocumentFetched =
  | { readonly ready: true; readonly base64: string; readonly name: string }
  | { readonly ready: false; readonly reason: string }

export async function fetchDocument(
  source: ImageSource,
  document: ReadDocument,
): Promise<DocumentFetched> {
  let ciphertext: Uint8Array
  try {
    ciphertext = await source.download(document.url)
  } catch (cause: unknown) {
    return { ready: false, reason: `downloading: ${getErrorMessage(cause)}` }
  }

  try {
    const plaintext = await source.open(ciphertext, document.secret)
    return { ready: true, base64: base64Of(plaintext), name: document.name }
  } catch (cause: unknown) {
    // A decryption that failed is a key that never arrived, which has nothing
    // to do with a network that did not answer. Told apart here so the line
    // in the log says which one it was.
    return { ready: false, reason: `decrypting: ${getErrorMessage(cause)}` }
  }
}
