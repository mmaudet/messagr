/**
 * Handing somebody the key vault: a file, shared, and gone.
 *
 * # THE SECOND ROUTE OF ADR-0013, AND WHO IT IS FOR
 *
 * Somebody with a reason to want no key material on a server at all. The
 * vault is the standard Matrix export — the armoured `MEGOLM SESSION DATA`
 * file, under a passphrase of its own — and the point of the format is that
 * **any Matrix client opens it**, Element included.
 *
 * A draft ADR wanted to encrypt it with the recovery key, so there would be
 * one secret instead of two. That would make a vault only Messagr can open,
 * which is the opposite of what this product claims to be, and the exact
 * reason the bridge's author refused to write `exportSecrets`.
 *
 * # THE FILE, AND THE `finally` AROUND IT
 *
 * Neither platform's share sheet takes a string of two megabytes; both take
 * a file. So the armour is written to the temporary directory, handed over
 * by path, and unlinked immediately after — **whether the hand-over worked
 * or not**.
 *
 * That file is key material on a disk for the length of one gesture. It is
 * encrypted under the passphrase, so it is not the plaintext
 * `keepPhotograph.ts` is careful about, but the discipline is the same and
 * for a stronger reason: a photograph left behind is one photograph, and a
 * vault left behind opens everything that was ever said. `finally` rather
 * than a happy path — a failure that left it there would be the whole
 * defect.
 *
 * # THE PASSPHRASE IS NOT CHECKED HERE, AND THAT IS NOT AN OVERSIGHT
 *
 * The bridge derives a key from it over half a million PBKDF2 iterations and
 * has no opinion about its shape. Neither has this. A rule invented here —
 * a length, a class of character — would be this product telling somebody
 * how to protect a file it will never see again, and it would be enforced in
 * exactly one of the clients that can open it.
 *
 * What the screen owes instead is the sentence about what the file is worth,
 * which is what the place it is put is worth.
 *
 * # A DEVICE WITH NO KEYS PRODUCES A VALID, EMPTY VAULT
 *
 * The bridge says so outright, and it is a true statement about that device
 * rather than a failure. A caller that wants to say « there is nothing to
 * export » reads `getKeyBackupState().total` first; this does not decide it,
 * because refusing here would mean this module holding an opinion about
 * somebody else's screen.
 */

/** What the gesture needs from the platform, so a test can drive it. */
export interface Vaulting {
  /** The bridge's `createKeyVault`. The armour, as a string. */
  readonly create: (passphrase: string) => Promise<string>
  /** Where a file may be written and then forgotten. */
  readonly temporary: string
  /** Writes text at a path. */
  readonly write: (path: string, text: string) => Promise<void>
  /** Hands the file at that path to the share sheet. */
  readonly share: (path: string) => Promise<void>
  /** Removes the file. Its failure is not the caller's problem. */
  readonly forget: (path: string) => Promise<void>
  /** Something no two calls share. Injected so a test is not a clock. */
  readonly name: () => string
}

export type VaultShared =
  | { readonly shared: true }
  | { readonly shared: false; readonly reason: string }

/**
 * The name the file carries out of the application.
 *
 * `.txt` because that is what the armour is and what every platform will let
 * somebody keep, mail and reopen. An invented extension would be a file the
 * operating system offers no application for, which is a vault nobody can
 * put anywhere.
 */
const EXTENSION = 'txt'

export async function shareKeyVault(
  deps: Vaulting,
  passphrase: string,
): Promise<VaultShared> {
  // OUTSIDE THE `try` THAT OWNS THE FILE, because there is no file yet. A
  // passphrase the bridge refuses, or a device with no crypto machine, must
  // not reach the `finally` and unlink a path nothing wrote.
  let armour: string
  try {
    armour = await deps.create(passphrase)
  } catch (cause: unknown) {
    return { shared: false, reason: reasonFor(cause) }
  }

  const path = `${deps.temporary}/${deps.name()}.${EXTENSION}`
  try {
    await deps.write(path, armour)
    await deps.share(path)
    return { shared: true }
  } catch (cause: unknown) {
    return { shared: false, reason: reasonFor(cause) }
  } finally {
    // NOT AWAITED FOR ITS ANSWER, and its failure is swallowed on purpose.
    // A temporary file that will not delete is one the system clears on its
    // own; reporting it would replace the sentence about the vault with one
    // about housekeeping.
    await deps.forget(path).catch(() => undefined)
  }
}

function reasonFor(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
