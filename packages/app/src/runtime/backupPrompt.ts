import { readBackupCommitment } from './backupCommitment'
import type { BackupOffer } from './offerBackup'
import { offerBackup } from './offerBackup'
import type { SecretStore } from './sessionStore'

/**
 * The three facts `offerBackup` decides on, gathered from where each of them
 * actually lives.
 *
 * # WHY THIS IS A MODULE AND NOT THREE READS AT A CALL SITE
 *
 * `offerBackup.ts` is deliberately pure — a table and a function — and says
 * so: *« Three facts decide it and each arrives from somewhere different.
 * Spread across a screen they would be three conditions nobody could
 * test. »* This is the other half of that sentence: the gathering, in one
 * place, so the screen asks one question and the answer is testable.
 *
 * # WHY THE TWO FLAGS ARE NOT ONE ENTRY
 *
 * `asked` and `received` are written at unrelated moments by unrelated code
 * — one when a person answers a prompt, one when a message is decrypted —
 * and either can be true without the other. Sharing an entry would mean a
 * message arriving rewrites the record of what somebody answered, which is
 * the kind of coupling that is invisible until the day it loses an answer.
 *
 * `backupCommitment.ts` makes the opposite choice for the opposite reason,
 * and both are stated where they are made.
 *
 * # WHICH WAY EACH FLAG FAILS, AND THEY FAIL IN OPPOSITE DIRECTIONS
 *
 * A store that cannot be read answers **`false` for `received`** and
 * **`true` for `asked`**. Neither is arbitrary:
 *
 * - `received: false` means no offer. A device that cannot read its own
 *   flags is a device having a bad day, and interrupting somebody to hand
 *   them a secret to keep for ever is not what to do in the middle of one.
 * - `asked: true` means no offer either — the same direction, reached the
 *   other way. ADR-0013 records a refusal for good, so the failure that
 *   costs least is the one that stays quiet: an offer not made can be made
 *   from Réglages, and an offer made twice teaches somebody the product
 *   nags.
 *
 * Both defaults therefore fall the same way, towards silence, and that is
 * the point rather than a coincidence: the only state this prompt must
 * never reach is asking again somebody who already said no.
 */
export interface BackupPromptStores {
  /** Where `backupCommitment.ts` keeps the sealing key and the version. */
  readonly commitment: SecretStore
  /** Whether this device has ever put the question. */
  readonly asked: SecretStore
  /** Whether a message from somebody else has ever arrived here. */
  readonly received: SecretStore
}

/** Any non-empty value means yes; this one says what it is. */
const YES = 'yes'

async function flag(
  store: SecretStore,
  whenUnreadable: boolean,
  note: () => void,
) {
  try {
    const held = await store.read()
    return held !== null && held !== ''
  } catch {
    note()
    return whenUnreadable
  }
}

/**
 * Whether to offer the backup now, having read every fact it turns on --
 * **and the three facts themselves**.
 *
 * The screen calls this and nothing else. `offerBackup` stays the pure table
 * underneath, so the decision can be exercised without a store and the
 * gathering can be exercised without a screen.
 *
 * # WHY THE FACTS COME BACK AND NOT ONLY THE ANSWER
 *
 * Because a `false` here has four causes and they are indistinguishable from
 * outside: already backed up, already asked, nothing received yet, or a
 * keystore that answered none of those and fell back to its defaults. Three
 * of those are the feature working and one is the feature absent.
 *
 * That is not a theoretical concern. The first device run of this prompt
 * showed no offer, and there was no way to tell which of the four it was
 * without rebuilding the application to add a log. Returning the facts is
 * what lets the caller say so once, in a line a device proof can read.
 */
export interface BackupOfferReading {
  readonly decision: BackupOffer
  /** Whether a commitment was found. */
  readonly backedUp: boolean
  readonly asked: boolean
  readonly received: boolean
  /**
   * Which stores could not be read at all, if any.
   *
   * **This is the field that tells a working refusal from a broken one.**
   * The defaults above are deliberately quiet, and quiet is exactly what a
   * missing feature looks like.
   */
  readonly unreadable: readonly ('commitment' | 'asked' | 'received')[]
}

export async function shouldOfferBackup(
  stores: BackupPromptStores,
): Promise<BackupOfferReading> {
  const unreadable: ('commitment' | 'asked' | 'received')[] = []

  const commitment = await readBackupCommitment(stores.commitment).catch(() => {
    unreadable.push('commitment')
    return null
  })
  const asked = await flag(stores.asked, true, () => unreadable.push('asked'))
  const received = await flag(stores.received, false, () =>
    unreadable.push('received'),
  )

  return {
    decision: offerBackup({
      backedUp: commitment !== null,
      asked,
      received,
    }),
    backedUp: commitment !== null,
    asked,
    received,
    unreadable,
  }
}

/**
 * Records that the question was put.
 *
 * **Called before the person answers, not after.** An offer interrupted —
 * the application killed, the screen turned, a call arriving — is an offer
 * that was made, and asking again would be the nagging ADR-0013 refuses. The
 * cost of that ordering is that somebody who never saw the screen properly
 * has to go to Réglages, which is a control they can find; the cost of the
 * other ordering is a product that keeps asking, which is one they cannot
 * escape.
 *
 * `false` when it could not be kept, so a caller can decide what to do about
 * a device that will ask again. Not a throw: failing to remember a question
 * is not a reason to stop somebody answering it.
 */
export async function rememberBackupAsked(
  store: SecretStore,
): Promise<boolean> {
  try {
    await store.write(YES)
    return true
  } catch {
    return false
  }
}

/**
 * Records that a message from somebody else has arrived on this device.
 *
 * **Received, not sent**, and `offerBackup.ts` carries the reason in full:
 * sending proves the account works, receiving is the first time this device
 * holds a key nobody else has.
 *
 * Written on the first one and harmlessly again on every one after — the
 * store holds one value and this writes the same one. A caller that wanted
 * to avoid the write could read first, and should not: a read to save a
 * write on a value that never changes is two operations where there was one,
 * and the keystore is not where this application's time goes.
 */
export async function rememberReceived(store: SecretStore): Promise<boolean> {
  try {
    await store.write(YES)
    return true
  } catch {
    return false
  }
}
