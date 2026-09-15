import type { BackupCommitment } from './backupCommitment'

/**
 * Accepting the backup: four steps, two of which are this application's own
 * requests, in the one order that cannot leave a device half set up.
 *
 * # THE ORDER, AND WHAT EACH WRONG ORDER COSTS
 *
 * 1. **Make the key.** `createKeyBackup` is synchronous, needs no crypto
 *    machine, makes no request and changes nothing. So the restore key can
 *    be shown, and refused, before anything exists anywhere.
 * 2. **Publish the version**, `POST /room_keys/version`, with the body the
 *    bridge handed back untouched. The homeserver answers with a `version`.
 * 3. **Remember the commitment** — the sealing key and that version — so the
 *    next launch can call `enableKeyBackup` again. `backupCommitment.ts` says
 *    why that has to be remembered at all.
 * 4. **Enable it**, which is what makes the pump start carrying keys.
 *
 * **Remembering comes before enabling, and that is the only ordering here
 * that is not arbitrary.** Between the two there is a version published on
 * the homeserver that this device is not yet writing to, which costs
 * nothing: the next launch reads the commitment and enables it. The other
 * way round leaves a device uploading to a version it will forget the moment
 * it is closed, and the person believing they have a backup that stops the
 * first time they shut the application.
 *
 * # WHAT IT REFUSES TO DO
 *
 * **It does not show the key.** `setup.restoreKey` is handed back to the
 * caller and this module keeps no copy; the screen that shows it once is
 * `RecoveryKeyShown.tsx`, and the one moment it exists is between this call
 * returning and that screen being dismissed.
 *
 * # IT RECORDS THAT THE QUESTION WAS ANSWERED, BEFORE ANY STEP
 *
 * This used to refuse, on the ground that recording belongs to the moment
 * the question is put. True of the offer, which records it before the person
 * answers. Not of Réglages, which puts no question: somebody goes there and
 * accepts, and nothing kept that they had. Afterwards the only thing between
 * a message received and the offer was a commitment that exists and reads
 * back, and an acceptance that stopped short, or a keystore that did not
 * answer, left none. On 13 September 2026 the offer came back, at the first
 * message from the person invited, on the telephone that had accepted the
 * backup that morning (#291).
 *
 * So every acceptance records it, whichever screen it comes from, and before
 * any step that can fail: an acceptance interrupted is an answer that was
 * given. The offer still records it earlier, when it is put; the second write
 * is the same value.
 *
 * # WHY EVERY DEPENDENCY IS INJECTED
 *
 * `react-native-matrix-crypto` installs a native JSI bootstrap as a side
 * effect of being imported as a value, which crashes the test runner's
 * parser — `syncLoop.ts` and `outgoingPumpCycle.ts` both say so. Nothing
 * here imports it; the caller binds the three functions. That is also what
 * lets this sequence be exercised against a homeserver that answers
 * whatever a test needs it to.
 */
export interface BackupSetup {
  /** Shown once and never again. Not stored by this module or any other. */
  readonly restoreKey: string
  /** The public half, to keep. */
  readonly sealingKey: string
  /** The body to publish, as an object. */
  readonly versionRequest: unknown
}

export interface AcceptBackupDeps {
  /**
   * Keeps that the question has been answered, in the entry the offer reads:
   * `backupPrompt.ts`'s `rememberBackupAsked`. `false` when the keystore
   * refused it.
   *
   * Required here rather than left to each screen, because a screen left to
   * it is how Réglages came to accept without it (#291).
   */
  readonly rememberAsked: () => Promise<boolean>
  /** The bridge's `createKeyBackup`. Synchronous, and makes no request. */
  readonly createKeyBackup: () => BackupSetup
  /**
   * `POST /_matrix/client/v3/room_keys/version`, answering with the opaque
   * version the homeserver chose.
   *
   * A string, never a number: Synapse answers with a counter from `"1"` and
   * Continuwuity with a six-digit integer, and the specification makes the
   * field opaque. A caller that parses it works against one homeserver and
   * breaks against the other.
   */
  readonly publishVersion: (body: unknown) => Promise<string>
  /** Keeps the commitment. `false` when the keystore refused it. */
  readonly remember: (commitment: BackupCommitment) => Promise<boolean>
  /** The bridge's `enableKeyBackup`. */
  readonly enable: (sealingKey: string, version: string) => Promise<void>
}

export type BackupAccepted =
  | {
      readonly accepted: true
      /**
       * Show it once. Nothing else holds it, and no call brings it back.
       */
      readonly restoreKey: string
    }
  | {
      readonly accepted: false
      /**
       * Which step failed, so a screen can say something true rather than
       * "something went wrong".
       *
       * `publishing` is the homeserver refusing or unreachable — worth
       * offering again, since nothing has happened. `remembering` is this
       * device's own keystore, and the version now exists on the homeserver
       * unused, which costs nothing but is worth wording differently: trying
       * again makes a second one, and a homeserver keeps only the version it
       * was last told about anyway. `enabling` is the bridge refusing what
       * the homeserver just accepted, which should not happen and is the one
       * a report wants to name.
       */
      readonly failedAt: 'publishing' | 'remembering' | 'enabling'
    }

export async function acceptBackup(
  deps: AcceptBackupDeps,
): Promise<BackupAccepted> {
  // FIRST, AND WHATEVER IT ANSWERS. An acceptance interrupted -- the
  // application killed during the request, a homeserver that refuses -- is
  // an answer that was given, and nothing may ask it again. A keystore that
  // would not keep it is no reason to stop somebody accepting: the backup is
  // worth making all the same.
  await deps.rememberAsked()

  // Outside every `try` below: it cannot fail, and wrapping it would put a
  // branch in this function for a case that does not exist.
  const setup = deps.createKeyBackup()

  let version: string
  try {
    version = await deps.publishVersion(setup.versionRequest)
  } catch {
    return { accepted: false, failedAt: 'publishing' }
  }

  // An empty version is refused here rather than carried: the bridge treats
  // it as the absence of a version rather than as an opaque identifier, and
  // a homeserver that answered with one has answered nothing. Reported as a
  // publishing failure because that is where it came from.
  if (version === '') {
    return { accepted: false, failedAt: 'publishing' }
  }

  if (!(await deps.remember({ sealingKey: setup.sealingKey, version }))) {
    return { accepted: false, failedAt: 'remembering' }
  }

  try {
    await deps.enable(setup.sealingKey, version)
  } catch {
    return { accepted: false, failedAt: 'enabling' }
  }

  return { accepted: true, restoreKey: setup.restoreKey }
}
