import type { PickedDocument } from '../timeline/fileEvent'

/**
 * Choosing a document, as an interface rather than as a library.
 *
 * # The same port argument as `pickImage.ts`, and one difference that matters
 *
 * The reasons are that module's: three targets, no library covering all
 * three, bytes rather than a path so the plaintext goes from the picker into
 * the bridge without touching this application's storage (ADR-0006).
 *
 * The difference is that a document picker states a file's SIZE before
 * anything is read. `refuseImage` cannot answer until the bytes are in
 * memory, which is the very memory its limit exists to protect; here the
 * refusal happens first, and a file too large to hold is never held.
 *
 * # What a document is not
 *
 * Not a photograph with a different name. It has no dimensions, no thumbnail,
 * and its filename is the content rather than a disclosure -- `fileEvent.ts`
 * argues that inversion where it is enacted.
 */

/**
 * The most a document may weigh, in bytes.
 *
 * The same number as a photograph and for the same reason, which is not a
 * policy about documents: `encryptAttachment` holds the plaintext and the
 * ciphertext at once, and the bytes cross the bridge as base64, a third
 * larger again. A phone asked to hold three copies of a large file is killed
 * rather than slowed.
 *
 * Raising it is not a matter of raising it. It needs a sealing that streams,
 * which is a different piece of work, and `pickImage.ts` says the same thing
 * about the same limit.
 */
export const LARGEST_DOCUMENT_BYTES = 12 * 1024 * 1024

/** What the picker says about a file before it is opened. */
export interface StatedDocument {
  readonly name: string
  readonly mimeType: string
  /**
   * `null` when the picker did not say.
   *
   * Android's `content://` does not always carry one. An absence is not a
   * refusal: the bytes are bounded again once read.
   */
  readonly size: number | null
}

export type DocumentRefusal = 'too-large' | 'unreadable' | 'unnamed'

/**
 * Whether a document can be sent, or why not.
 *
 * Takes what the picker STATED rather than what was read, so the limit is
 * enforced before the file is in memory. Separate from the picker so it is
 * testable without one, and so a second adapter inherits it rather than
 * reinventing it.
 */
export function refuseDocument(stated: StatedDocument): DocumentRefusal | null {
  if (stated.name === '') return 'unnamed'
  if (stated.size !== null && stated.size === 0) return 'unreadable'
  if (stated.size !== null && stated.size > LARGEST_DOCUMENT_BYTES) {
    return 'too-large'
  }
  return null
}

/** What choosing a document can come to. */
export type DocumentChoice =
  | { readonly chose: true; readonly document: PickedDocument }
  /** The person backed out. Not a failure, and nothing to report. */
  | { readonly chose: false; readonly because: null }
  | { readonly chose: false; readonly because: DocumentRefusal }
