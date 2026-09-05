import { getErrorMessage } from './errors'
import type { SecretStore } from './sessionStore'

/**
 * Moving a keystore entry to the accessibility ADR-0008 decided on.
 *
 * `AfterFirstUnlockThisDeviceOnly`: readable once the device has been
 * unlocked at least since it was powered on, screen locked or not, and never
 * carried into a backup. The application decides that a push carries no
 * content and wakes to decrypt locally (ADR-0009), and that wake is worth
 * nothing if it cannot open the crypto store.
 *
 * WHY A MARKER RATHER THAN A QUESTION. Changing the option does not rewrite
 * an entry already stored, so an existing installation keeps the old form
 * silently while the code claims otherwise. The obvious fix would be to ask
 * the keystore what form an entry is in — and there is no such question:
 * `react-native-keychain`'s `getGenericPassword` hands back a username and a
 * password and nothing else. So the fact is recorded beside the value, in an
 * entry of its own written in the new form.
 *
 * WHY NOT SIMPLY REWRITE ON EVERY LAUNCH, which would need no marker at all.
 * Because a rewrite is the one operation that can lose the value: a store
 * that clears before it writes, interrupted, leaves nothing. Losing this
 * particular value is losing every room key the device holds — a store
 * reopened with a new passphrase is not a degraded store, it is a different
 * and empty one. One rewrite over an installation's life is a risk worth
 * taking once and not once a day.
 *
 * The marker is written *after* the value, never before. Interrupted between
 * the two, the next launch finds no marker and does the whole thing again,
 * which is harmless. The other order would mark an entry that had not moved.
 */

/**
 * The form entries are written in. A string rather than the library's enum so
 * that this module stays testable without the native module, and so that the
 * marker's stored value says what it means to somebody reading a keystore
 * dump. It is the value of `ACCESSIBLE.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`,
 * and `deviceSecrets.ts` is where the two are held together.
 */
export const CURRENT_FORM = 'AccessibleAfterFirstUnlockThisDeviceOnly'

export type FormOutcome =
  /** The marker already said so. Nothing was read and nothing was written. */
  | 'current'
  /** An old value was read and written back in the current form. */
  | 'rewritten'
  /** No value was stored, so the first write will be the current form. */
  | 'nothing-stored'
  /** A background wake. Reading the old form needs the device unlocked. */
  | 'deferred'
  /** Attempted and could not. The old value is intact. */
  | 'failed'

export interface FormMigration {
  readonly outcome: FormOutcome
  /**
   * Whether the marker was written — that is, whether this is settled or will
   * be attempted again on the next launch. A rewrite that could not be marked
   * is not a failure: the value did move, and repeating a move that has
   * already happened costs one read and one write.
   */
  readonly marked: boolean
  /** Why, when the outcome is one that needs a why. */
  readonly reason?: string
}

/**
 * Reads the value and writes it straight back, which is all a migration is:
 * `deviceSecrets.ts` passes the accessibility on every write, so a value
 * written by this application at all is a value in the current form.
 *
 * `foreground` is asked for rather than read here, and it is not a
 * convenience. ADR-0008 names the trap: reading the old value requires the
 * device unlocked, which is precisely what the old accessibility means. A
 * migration attempted on a background wake fails, and that failure is
 * indistinguishable from a device that has not been unlocked since it was
 * powered on — so a wake must not try, rather than try and mis-read the
 * result.
 *
 * The marker is read first, before the foreground question, because the
 * marker is itself in the new form: a background wake on an installation that
 * has already moved can answer `current` without touching anything.
 */
export async function migrateKeystoreForm(
  value: SecretStore,
  marker: SecretStore,
  foreground: boolean,
): Promise<FormMigration> {
  let held: string | null
  try {
    held = await marker.read()
  } catch {
    // A marker that cannot be read is treated as absent rather than as a
    // failure: the answer is the same, and it is the safe one — attempt the
    // migration, which is idempotent.
    held = null
  }
  if (held === CURRENT_FORM) return { outcome: 'current', marked: true }

  if (!foreground) {
    return {
      outcome: 'deferred',
      marked: false,
      reason: 'a background wake cannot read an entry in the old form',
    }
  }

  let stored: string | null
  try {
    stored = await value.read()
  } catch (cause: unknown) {
    return {
      outcome: 'failed',
      marked: false,
      reason: `the stored value could not be read: ${getErrorMessage(cause)}`,
    }
  }

  if (stored !== null && stored !== '') {
    try {
      await value.write(stored)
    } catch (cause: unknown) {
      // Nothing was cleared: the write is what would have replaced the entry,
      // and it did not happen. The old value stands, in the old form.
      return {
        outcome: 'failed',
        marked: false,
        reason: `the value could not be written back: ${getErrorMessage(cause)}`,
      }
    }
  }

  return {
    outcome: stored === null || stored === '' ? 'nothing-stored' : 'rewritten',
    marked: await mark(marker),
  }
}

/**
 * `false` rather than a throw. The value has already moved by the time this
 * runs, and a marker that did not land costs a repeat of work that is
 * idempotent — which is not a reason to report a migration that happened as
 * one that did not.
 */
async function mark(marker: SecretStore): Promise<boolean> {
  try {
    await marker.write(CURRENT_FORM)
    return true
  } catch {
    return false
  }
}
