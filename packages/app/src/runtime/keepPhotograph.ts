/**
 * Putting a photograph into the photothèque of the telephone.
 *
 * # THIS IS DELIBERATELY OUTSIDE EVERYTHING THIS PRODUCT PROTECTS
 *
 * ADR-0006 refuses decrypted content on disk, and this writes a decrypted
 * photograph to the one place on the device that is not this application's:
 * the gallery, where the camera's own pictures live. That is not a hole in
 * the decision, it is a person exercising the thing the decision exists to
 * protect -- their own choice about their own picture. The ADR carries the
 * amendment; what matters here is that it happens **once, per photograph,
 * because somebody asked**, and never on arrival.
 *
 * What a person gets and should know they are getting: a picture in the
 * gallery is backed up by whatever backs their gallery up, readable by every
 * application they have given photo access to, and no longer removable by
 * anybody on the other end of the conversation. Saving is the end of this
 * product's part in it.
 *
 * # THE TEMPORARY FILE, AND WHY THERE IS ONE
 *
 * The photograph reaches the screen as a `data:` URI -- `fetchImage`
 * decrypts into one and throws the bytes away -- and neither platform's
 * gallery takes those. Both take a file. So the bytes are written to the
 * temporary directory, handed over by path, and unlinked immediately after,
 * whether the hand-over worked or not.
 *
 * That file is decrypted content on a disk, for the length of one call. It is
 * the smallest window this can be done in; a wider one would be a cache, and
 * a cache is what ADR-0006 refuses. `finally` rather than a happy path:
 * a failure that left the plaintext behind would be the exact defect.
 */

/** What the gesture needs from the platform, so a test can drive it. */
export interface Keeping {
  /** Where a file may be written and then forgotten. */
  readonly temporary: string
  /** Writes base64 bytes at a path. */
  readonly write: (path: string, base64: string) => Promise<void>
  /** Hands the file at that path to the photothèque. */
  readonly keep: (path: string) => Promise<void>
  /** Removes the file. Its failure is not the caller's problem. */
  readonly forget: (path: string) => Promise<void>
  /** Something no two calls share. Injected so a test is not a clock. */
  readonly name: () => string
}

export type Kept =
  { readonly kept: true } | { readonly kept: false; readonly reason: string }

/**
 * The extensions the two galleries recognise, by what the data URI declares.
 *
 * A gallery decides what a file is by its extension, not by its bytes, so
 * this table is what makes a saved picture openable. Anything not on it is
 * refused rather than guessed: a `.jpg` holding something else is a file the
 * person will find and not be able to open, which is worse than being told
 * now.
 */
const EXTENSIONS: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/heic': 'heic',
}

/** What a `data:` URI carries, or nothing when it is not one. */
export function readDataUri(
  uri: string,
): { readonly extension: string; readonly base64: string } | null {
  // Deliberately narrow: `data:<mime>;base64,<payload>`, which is the only
  // shape `fetchImage` produces. A parser for the whole grammar would be a
  // parser for inputs this application never makes.
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(uri)
  if (match === null) return null
  const [, mime, base64] = match
  if (mime === undefined || base64 === undefined) return null
  const extension = EXTENSIONS[mime.toLowerCase()]
  if (extension === undefined) return null
  return { extension, base64 }
}

/**
 * Writes the photograph where the person keeps their own pictures.
 *
 * Answers rather than throws, like every other gesture a screen offers: what
 * a person needs is a sentence, and the difference between "the picture is in
 * your gallery" and "it is not" is the only thing they can act on.
 */
export async function keepPhotograph(
  deps: Keeping,
  dataUri: string,
): Promise<Kept> {
  const read = readDataUri(dataUri)
  if (read === null) {
    return { kept: false, reason: 'this is not a photograph this device made' }
  }

  const path = `${deps.temporary}/${deps.name()}.${read.extension}`
  try {
    await deps.write(path, read.base64)
    await deps.keep(path)
    return { kept: true }
  } catch (cause: unknown) {
    return {
      kept: false,
      reason: cause instanceof Error ? cause.message : String(cause),
    }
  } finally {
    // NOT AWAITED FOR ITS ANSWER, and its failure is swallowed on purpose.
    // A temporary file that will not delete is a file the system clears on
    // its own; reporting it would replace the sentence about the photograph
    // with one about housekeeping.
    await deps.forget(path).catch(() => undefined)
  }
}
