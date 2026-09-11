/**
 * Opening a key vault: a file chosen, a passphrase given, keys back.
 *
 * # THE OTHER HALF OF `shareKeyVault`, AND IT ACCEPTS FILES FROM ELSEWHERE
 *
 * The acceptance criterion is *« Importer un tel fichier rend les messages
 * lisibles, qu'il vienne de Messagr ou d'ailleurs »*, and that second clause
 * is the whole point of using the standard Matrix format rather than one of
 * this product's own. A vault exported from Element opens here. Nothing in
 * this module knows or cares which made it — the bridge reads the armour and
 * either it is one or it is not.
 *
 * # FOUR ANSWERS, AND THE TWO THAT LOOK ALIKE ARE THE ONES THAT MATTER
 *
 * `cancelled` is somebody who opened the picker and changed their mind. It
 * is a normal thing to do and the screen must show nothing at all for it —
 * not a failure, not a message.
 *
 * `wrong-passphrase` and `not-a-vault` both mean "that did not open", and
 * collapsing them is the same mistake `RecoveryKeyEntry` refuses: one sends
 * somebody back to what they typed, the other sends them back to which file
 * they chose, and a person told the wrong one hunts in the wrong place.
 *
 * # NOTHING IS KEPT
 *
 * The armour is read, handed to the bridge, and dropped. It is not written
 * anywhere by this path — the file it came from is the person's own, in
 * their own storage, and this application has no business copying it
 * somewhere it would then have to remember to delete.
 *
 * That is why there is no `finally` here and one in `shareKeyVault.ts`: that
 * one MAKES a file, this one only reads one.
 */
export interface Opening {
  /** Chooses a file and reads it. See `documentFile.ts`. */
  readonly choose: () => Promise<
    | { readonly picked: true; readonly text: string }
    | { readonly picked: false; readonly cancelled: boolean }
  >
  /**
   * The bridge's `openKeyVault`. Answers how many keys came back.
   *
   * Rejects with a kind: `wrong_passphrase` for a passphrase that does not
   * open it, `malformed_payload` for something that is not a vault.
   */
  readonly open: (
    vault: string,
    passphrase: string,
  ) => Promise<{ readonly imported: number }>
}

export type VaultOpened =
  | { readonly opened: true; readonly imported: number }
  /** Dismissed. Say nothing. */
  | { readonly opened: false; readonly because: 'cancelled' }
  | { readonly opened: false; readonly because: 'wrong-passphrase' }
  | { readonly opened: false; readonly because: 'not-a-vault' }
  | { readonly opened: false; readonly because: 'failed' }

/**
 * Which of the two refusals this is.
 *
 * Read off the kind the bridge raises rather than off a message, because a
 * message is a sentence somebody may translate and a kind is a contract.
 * Anything else is `failed`, which is the honest answer for a cause this
 * does not recognise — inventing one of the two would send somebody looking
 * in a place the product guessed.
 */
function refusalFor(
  cause: unknown,
): 'wrong-passphrase' | 'not-a-vault' | 'failed' {
  const kind =
    typeof cause === 'object' && cause !== null && 'kind' in cause
      ? (cause as { readonly kind: unknown }).kind
      : undefined
  if (kind === 'wrong_passphrase') return 'wrong-passphrase'
  if (kind === 'malformed_payload') return 'not-a-vault'
  return 'failed'
}

export async function openVault(
  deps: Opening,
  passphrase: string,
): Promise<VaultOpened> {
  let chosen
  try {
    chosen = await deps.choose()
  } catch {
    return { opened: false, because: 'failed' }
  }
  if (!chosen.picked) {
    // A picker that failed for its own reasons is not a cancel, and saying
    // « vous avez annulé » to somebody who did not would be the product
    // telling them what they did.
    return {
      opened: false,
      because: chosen.cancelled ? 'cancelled' : 'failed',
    }
  }

  try {
    const { imported } = await deps.open(chosen.text, passphrase)
    return { opened: true, imported }
  } catch (cause: unknown) {
    return { opened: false, because: refusalFor(cause) }
  }
}
