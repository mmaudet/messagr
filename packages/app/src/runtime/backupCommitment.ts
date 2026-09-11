import type { SecretStore } from './sessionStore'

/**
 * What this device needs in order to keep writing to its key backup, and
 * nothing more.
 *
 * # WHY ANYTHING HAS TO BE KEPT AT ALL
 *
 * The bridge persists neither of these. `enableKeyBackup(sealingKey,
 * version)` is a call this device makes on **every** launch, and a process
 * that does not make it backs nothing up and says nothing about it — the
 * silent failure ADR-0013 spends its "the backup runs at the end of each
 * sync cycle" paragraph avoiding. So the two values live here, and this
 * module is what makes the next launch able to make that call.
 *
 * # WHY ONLY THE PUBLIC HALF
 *
 * ADR-0013: *« Le device garde ce qu'il faut pour continuer à écrire, et
 * seulement ça. La partie publique vit dans le trousseau, `ThisDeviceOnly`
 * comme l'exige ADR-0008, donc sauvegarder ne demande jamais rien. Le secret
 * n'est nécessaire que pour restaurer. »*
 *
 * The sealing key encrypts and cannot decrypt. Whoever defeats this keystore
 * gets the ability to add keys to a backup they still cannot read, which is
 * worth almost nothing — where the restore key would have been the entire
 * history. That is the whole reason the two halves are kept apart, and the
 * restore key is kept nowhere: it is shown once and it leaves.
 *
 * # ONE ENTRY, NOT TWO
 *
 * The key and the version are one fact — *this device backs up to that
 * version under that key* — written together and read together. Two entries
 * could be half-written, and half of this fact is worse than none: a version
 * with no key backs nothing up, and a key with no version is refused by the
 * bridge, which treats an empty version as the absence of one rather than as
 * an opaque identifier.
 *
 * `sessionStore.ts` makes the same choice for the same reason and says so:
 * *« Written as one value rather than four, so that a half-written session
 * cannot exist. »*
 *
 * # THE VERSION IS AN OPAQUE STRING
 *
 * Never parsed, never compared for order, never generated. Synapse answers
 * with a counter from `"1"` and Continuwuity 26.7.2 with a six-digit
 * integer, and the specification makes the field opaque: a client that
 * assumed the first shape works against one homeserver and breaks against
 * the other.
 *
 * # WHICH WAY IT FAILS
 *
 * A store that cannot be read answers `null`, so the device behaves as one
 * that never set a backup up: it uploads nothing and asks for nothing. The
 * opposite default would have a device believing it was backing up while it
 * was not, which is the one state this feature must never be in — somebody
 * relying on a backup that does not exist finds out at the worst moment.
 */
export interface BackupCommitment {
  /**
   * The public half, base64, from the bridge's `createKeyBackup`.
   *
   * Not a secret: it encrypts and cannot decrypt.
   */
  readonly sealingKey: string
  /**
   * The version the homeserver answered with. Opaque; see above.
   */
  readonly version: string
}

/**
 * What this device is committed to, or `null` for one that never accepted a
 * backup, refused it, or lost the entry.
 *
 * A stored value that does not parse, or that is missing either half, is
 * `null` too. It is the same answer for the same reason: what a caller can
 * do about a damaged commitment and about no commitment is identical — offer
 * to set one up — and a shape this module cannot use is not a commitment
 * however it came to be there.
 */
export async function readBackupCommitment(
  store: SecretStore,
): Promise<BackupCommitment | null> {
  let held: string | null
  try {
    held = await store.read()
  } catch {
    return null
  }
  if (held === null || held === '') return null

  let parsed: unknown
  try {
    parsed = JSON.parse(held)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null

  const { sealingKey, version } = parsed as Partial<BackupCommitment>
  if (typeof sealingKey !== 'string' || sealingKey === '') return null
  if (typeof version !== 'string' || version === '') return null

  return { sealingKey, version }
}

/**
 * Writes what this device will need on every launch from now on.
 *
 * `false` when it could not be kept, and the caller has to act on that
 * rather than ignore it: the backup version exists on the homeserver by the
 * time this is called, and a device that cannot remember it will never write
 * to it. Unlike `rememberPromiseSeen`'s flag, forgetting this is not the
 * cost of a repeated screen — it is a backup that silently stops.
 *
 * Not a throw, because the remedy is a sentence on a screen rather than an
 * unwinding: the person can be told the backup could not be set up on this
 * device, which is true and actionable, where a crash is neither.
 */
export async function rememberBackupCommitment(
  store: SecretStore,
  commitment: BackupCommitment,
): Promise<boolean> {
  try {
    await store.write(JSON.stringify(commitment))
    return true
  } catch {
    return false
  }
}

/**
 * Forgets the commitment, so this device stops writing to that version.
 *
 * Two callers, and they are the reason this exists rather than a caller
 * simply overwriting: replacing the recovery key, which makes a new version
 * and must not leave the old one being written to in between, and somebody
 * turning the backup off.
 *
 * **It removes nothing from the homeserver.** The backup and everything in
 * it stay exactly where they are and still open with the same restore key;
 * deleting them is a request, and #220 is where that decision is made. This
 * only stops this device from adding to it.
 *
 * Written as an empty string rather than deleted: `SecretStore` has no
 * delete, and every reader here treats empty as absent. That is a real
 * limitation of the store this application has and not a choice — worth
 * saying so rather than letting a reader assume the entry is gone.
 */
export async function forgetBackupCommitment(
  store: SecretStore,
): Promise<boolean> {
  try {
    await store.write('')
    return true
  } catch {
    return false
  }
}
