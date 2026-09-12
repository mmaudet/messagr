/**
 * Keeping a document somebody sent, where the person keeps their own files.
 *
 * # This is the photograph's gesture, and it inherits its decision
 *
 * ADR-0006 refuses decrypted content on this device's disk, and amended
 * itself once, for `keepPhotograph.ts`: a photograph a person explicitly asks
 * to keep is written to the temporary directory, handed over, and unlinked in
 * a `finally`, including when the hand-over fails. The reasoning transfers
 * whole -- « the gallery is not this application's storage », and the Files
 * app is the same shelf for a document.
 *
 * What does NOT transfer is the automatic half: the amendment is « once, per
 * photograph, because somebody asked », and nothing here may run on arrival,
 * in the background, or as a side effect of looking at a conversation.
 *
 * # Why a system dialogue rather than opening the file
 *
 * Handing the file to a viewer application would be one gesture instead of
 * two, and it is what other messengers do. It also makes the moment to delete
 * the plaintext unknowable: the share sheet's promise resolves when the sheet
 * closes, not when the other application has finished reading, so the
 * `finally` above would be racing it. `shareKeyVault.ts` shares a file that
 * way and says in its own words why it is allowed to: what it hands over is
 * encrypted under a passphrase, « so it is not the plaintext
 * `keepPhotograph.ts` is careful about ». A document is.
 *
 * With a save dialogue the copy the person keeps is one they chose the
 * destination of, and the one this application made is gone before the
 * function returns.
 */

/** What the gesture needs from the platform, so a test can drive it. */
export interface KeepingDocument {
  /** Where a file may be written and then forgotten. */
  readonly temporary: string
  /** Writes base64 bytes at a path. */
  readonly write: (path: string, base64: string) => Promise<void>
  /**
   * Opens the system's « save as » dialogue on the file at that path,
   * suggesting `name`.
   */
  readonly save: (path: string, name: string) => Promise<void>
  /** Removes the file. Its failure is not the caller's problem. */
  readonly forget: (path: string) => Promise<void>
  /** Something no two calls share. Injected so a test is not a clock. */
  readonly name: () => string
}

export type Kept =
  { readonly kept: true } | { readonly kept: false; readonly reason: string }

/**
 * The sender's filename, or `null` when it cannot be part of a path.
 *
 * `body` and `filename` are fields on an event somebody else wrote. This is
 * the one place where that string is joined to a directory this application
 * owns, so it is the one place where a name that climbs out of it has to be
 * refused -- not sanitised. A name rewritten into something safe is a file
 * the person receives under a name nobody sent, and the honest answer to
 * « ../../ailleurs.pdf » is that it is not a filename.
 */
export function safeName(name: string): string | null {
  const trimmed = name.trim()
  if (trimmed === '') return null
  if (trimmed === '.' || trimmed === '..') return null
  if (trimmed.includes('/') || trimmed.includes('\\')) return null
  // eslint-disable-next-line no-control-regex -- the control byte is the point
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return null
  return trimmed
}

/**
 * Writes the document where the person keeps their own files.
 *
 * Answers rather than throws, like every other gesture a screen offers: what
 * a person needs is a sentence, and « it is saved » or « it is not » is the
 * only part of this they can act on.
 */
export async function keepDocument(
  deps: KeepingDocument,
  document: { readonly base64: string; readonly name: string },
): Promise<Kept> {
  const named = safeName(document.name)
  if (named === null) {
    return { kept: false, reason: 'this file arrived without a usable name' }
  }

  const path = `${deps.temporary}/${deps.name()}-${named}`
  try {
    await deps.write(path, document.base64)
    await deps.save(path, named)
    return { kept: true }
  } catch (cause: unknown) {
    return {
      kept: false,
      reason: cause instanceof Error ? cause.message : String(cause),
    }
  } finally {
    // NOT AWAITED FOR ITS ANSWER, and its failure is swallowed on purpose.
    // A temporary file that will not delete is one the system clears on its
    // own; reporting it would replace the sentence about the document with
    // one about housekeeping.
    await deps.forget(path).catch(() => undefined)
  }
}
