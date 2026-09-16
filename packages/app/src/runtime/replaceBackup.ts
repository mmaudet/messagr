import {
  acceptBackup,
  type AcceptBackupDeps,
  type BackupAccepted,
} from './acceptBackup'
import { getErrorMessage } from './errors'
import { logEvent } from './log'

/**
 * Replacing the recovery key: accepting again, and then retiring what the
 * old key opened.
 *
 * # WHY THIS EXISTS AT ALL
 *
 * *« Elle est montrée une fois et jamais plus. »* Somebody who wrote their
 * key down badly finds out at the worst possible moment, and no screen in
 * this product can show it to them again. The only honest remedy is a
 * different key — and, with it, the end of the old one.
 *
 * # IT IS `acceptBackup` PLUS ONE STEP, DELIBERATELY
 *
 * Not a second sequence that resembles the first. The four steps and their
 * ordering argument live in `acceptBackup.ts` and are exercised there; this
 * reuses them rather than restating them, so there is one place where the
 * order of publish, remember and enable can be got wrong and one place where
 * it is proved right.
 *
 * The bridge is already ready for it: `enableKeyBackup` retires a *different*
 * version it finds itself holding before enabling the new one. Without that
 * the pump kept a pending batch addressed to the old version and never drew
 * another — a device that replaced its key and quietly stopped backing
 * anything up.
 *
 * # THE OLD VERSION IS READ BEFORE ANYTHING IS PUBLISHED
 *
 * From `GET /room_keys/version` and not from the commitment in the keystore.
 * They usually agree, and the case where they do not is exactly the one that
 * matters: a device whose keystore lost its commitment still has a backup on
 * the homeserver, and the old key still opens it. Asking the homeserver is
 * asking the thing that holds the answer.
 *
 * After publishing, that same request answers with the NEW version, so there
 * is no second chance to learn the old one. Hence first, before step two.
 *
 * # RETIRING IS LAST, AND A FAILURE THERE IS NOT A FAILURE TO REPLACE
 *
 * Between enabling the new version and retiring the old one, both stand.
 * That costs nothing: two keys open two backups and both belong to the same
 * person. The other order has a window with the old backup gone and the new
 * one not yet running, where a device that stops has no backup and a key
 * that opens nothing.
 *
 * So the retirement can fail after the replacement has already succeeded,
 * and this reports that rather than hiding it. `oldRetired: false` means the
 * new key works AND the old one still opens the old backup — which is the
 * one fact somebody replacing a key because they lost control of the old one
 * needs to be told.
 *
 * # A FAILURE PAST THE PUBLISH TAKES THE PUBLICATION BACK (#327)
 *
 * The publish is the step that changes the account: from it on, vN is the
 * homeserver's current version, and the version the old key opens is not.
 * What that left, before this:
 *
 * - **Stopped at `remembering`.** The keystore still holds the OLD
 *   commitment and the bridge still writes to the old version, which the
 *   homeserver now refuses — `M_WRONG_ROOM_KEYS_VERSION`, at every launch,
 *   for ever. Réglages said « sauvegardés » throughout.
 * - **Stopped at `enabling`.** vN is current and its restore key was never
 *   shown to anybody, because a failure hands none back. A restore on a new
 *   telephone reads vN and refuses the old key as `wrong-key`: the person's
 *   whole past, behind a key that exists nowhere.
 *
 * Both are the same defect — a version left current that nothing on earth
 * can write to or open — so both are answered the same way: the published
 * version is retired, and the account is left holding what it held.
 *
 * `undone` says whether the gesture left NOTHING behind, and it is what the
 * screen's sentence reads. It is true when the version went and the keystore
 * was never written to, which is the `remembering` case; false at `enabling`,
 * where the old commitment was overwritten and then forgotten (#284) and this
 * device stops feeding the backup it goes back to; false when the retirement
 * itself failed, because « rien n'a changé » would then be a lie.
 *
 * **What it does not restore is the old commitment**, which would need the
 * old sealing key, and the only copy of that is the keystore entry the
 * acceptance overwrote. Putting it back means reading it before step one,
 * which is a dependency this module's caller has to bind — and the caller is
 * `cryptoPump.ts`. Until it does, the state that leaves is the third one
 * Réglages now names: a backup on the account that this device does not feed,
 * with the key entry beside it.
 */
export interface ReplaceBackupDeps extends AcceptBackupDeps {
  /**
   * The version the homeserver currently holds, or `null` for none.
   *
   * Called first. `null` is an ordinary answer: a device whose backup was
   * never made, or was retired elsewhere, has nothing to retire and is
   * simply accepting.
   */
  readonly currentVersion: () => Promise<string | null>
  /** `DELETE /room_keys/version/{version}`. See `backupCalls.ts`. */
  readonly retire: (version: string) => Promise<void>
}

export type BackupReplaced =
  | {
      readonly replaced: true
      /** Shown once. Nothing else holds it, and no call brings it back. */
      readonly restoreKey: string
      /**
       * Whether nothing the old key opened is left standing.
       *
       * `true` also when there was no previous version — nothing stands
       * because nothing was there, which is the same fact for the person
       * holding a key.
       *
       * `false` is the one outcome a screen must not round up to success.
       */
      readonly oldRetired: boolean
    }
  | {
      readonly replaced: false
      /**
       * As `acceptBackup`, plus the step that threw.
       *
       * `thrownAfterPublishing` is a step that threw instead of answering,
       * once the new version was published. A throw before that still
       * rejects, and nothing had changed.
       */
      readonly failedAt:
        'publishing' | 'remembering' | 'enabling' | 'thrownAfterPublishing'
      /**
       * Whether this gesture left nothing behind it (#327).
       *
       * `true` when the account holds what it held AND this device's
       * commitment was never touched. That is every failure before the
       * publish, and a publication retired at `remembering`.
       *
       * `false` is the answer a screen must not round up: the published
       * version stands, or the commitment this device backs up under is gone.
       */
      readonly undone: boolean
      /** As `acceptBackup`: present, and `false`, only when it could not forget. */
      readonly forgotten?: false
    }

export async function replaceBackup(
  deps: ReplaceBackupDeps,
): Promise<BackupReplaced> {
  // FIRST, AND THE FAILURE IS TREATED AS "NONE" ON PURPOSE.
  //
  // A homeserver that will not say what it holds is one this replacement is
  // about to ask for a new version anyway, and the alternative — refusing to
  // replace because the old version could not be read — leaves somebody who
  // has lost control of their key with no way forward at all. The cost of
  // carrying on is a version left standing, which `oldRetired: false`
  // already exists to say.
  let previous: string | null
  try {
    previous = await deps.currentVersion()
  } catch {
    previous = null
  }

  // WRAPPED TO LEARN THE NEW VERSION, which `acceptBackup` does not return
  // -- and does not need to, since the one caller that wants it is this one.
  // Widening its result for a single consumer would put the version in reach
  // of every screen that accepts a backup, and none of them has any business
  // with it.
  let published: string | null = null
  let accepted: BackupAccepted
  try {
    accepted = await acceptBackup({
      ...deps,
      publishVersion: async body => {
        const version = await deps.publishVersion(body)
        published = version
        return version
      },
    })
  } catch (cause: unknown) {
    // A THROW PAST THE PUBLISH IS ANSWERED, NOT THROWN (#284). The homeserver
    // now holds the new version as its current one, which a rejection cannot
    // say: the screen took every one for « rien n'a changé ». Before the
    // publish nothing had changed, and the rejection goes on to the caller.
    if (published === null) throw cause
    // TAKEN BACK ALL THE SAME (#327), and claiming nothing about the
    // keystore: a `remember` that rejected left the old commitment, a
    // `forget` that rejected left the new one, and nothing here can tell
    // which threw.
    await takeBackThePublication(deps, previous, published)
    return { replaced: false, failedAt: 'thrownAfterPublishing', undone: false }
  }
  if (!accepted.accepted) {
    const takenBack = await takeBackThePublication(deps, previous, published)
    return {
      replaced: false,
      failedAt: accepted.failedAt,
      // NOTHING LEFT BEHIND, WHICH IS MORE THAN THE VERSION HAVING GONE.
      // `enabling` overwrote the commitment and then forgot it, so this
      // device no longer writes to the backup the account is back to --
      // true of the account and not of the telephone, and the sentence has
      // to hold for both.
      undone: takenBack && accepted.failedAt !== 'enabling',
      ...(accepted.forgotten === false ? { forgotten: false } : {}),
    }
  }

  // Nothing to retire, and nothing standing.
  if (previous === null) {
    return { replaced: true, restoreKey: accepted.restoreKey, oldRetired: true }
  }

  // THE GUARD THAT STOPS THIS DELETING WHAT IT JUST MADE.
  //
  // `previous` was read before the publish, so the two identifiers normally
  // differ. They would not on a homeserver that answered the same version
  // twice -- one that reuses identifiers, or one whose publish was a no-op
  // because a version already existed. Without this, such a homeserver would
  // have the retirement destroy the backup enabled moments earlier, the
  // person would be holding a key that opens nothing, and the screen would
  // have told them it was done.
  //
  // Compared against the version and not against the restore key: a restore
  // key is a secret and a version is an identifier, and they are never the
  // same string.
  if (published !== null && previous === published) {
    return { replaced: true, restoreKey: accepted.restoreKey, oldRetired: true }
  }

  try {
    await deps.retire(previous)
    return { replaced: true, restoreKey: accepted.restoreKey, oldRetired: true }
  } catch {
    return {
      replaced: true,
      restoreKey: accepted.restoreKey,
      oldRetired: false,
    }
  }
}

/**
 * Retires the version this replacement published, so the account is left
 * holding the version it held (#327). Answers whether nothing of the
 * publication stands.
 *
 * The guard is the retirement-after-success's own, and for the same reason: a
 * homeserver that answered the same identifier twice would have this delete
 * the backup that was already there, which is the one case where taking the
 * gesture back costs more than leaving it. It answers `false` rather than
 * `true` because it cannot know what such a homeserver did to the description
 * it kept.
 */
async function takeBackThePublication(
  deps: ReplaceBackupDeps,
  previous: string | null,
  published: string | null,
): Promise<boolean> {
  // Nothing reached the homeserver: a publish that failed, or one that named
  // no usable version, which `acceptBackup` refuses rather than carries.
  if (published === null || published === '') return true
  if (published === previous) return false
  try {
    await deps.retire(published)
    return true
  } catch {
    return false
  }
}

/**
 * What the Sauvegarde screen is answered: the replacement's own answer, or
 * `thrown` for one that rejected instead of answering. `replaceBackup` rejects
 * only before the publish, so nothing on the homeserver moved — which is why
 * that answer carries `undone: true`.
 */
export type BackupReplacedFrom =
  | BackupReplaced
  | {
      readonly replaced: false
      readonly failedAt: 'thrown'
      readonly undone: true
    }

/**
 * A replacement as the Sauvegarde screen runs it: it never rejects, and a
 * failure leaves a line saying where it stopped (#284).
 *
 * Found in review. A replacement that failed wrote nothing, so a tester's log
 * could not tell one had even been tried, and `forgotten: false` went no
 * further than the handler that dropped it. The line is the acceptance's own,
 * `MESSAGR_BACKUP_ACCEPT_FAILED`, with `replace` where it names a screen: a
 * replacement is an acceptance with one step more. The cause of a throw only
 * where the whole log is written, as `acceptBackupFrom` says.
 */
export async function replaceBackupFrom(
  replace: () => Promise<BackupReplaced>,
): Promise<BackupReplacedFrom> {
  let outcome: BackupReplaced
  try {
    outcome = await replace()
  } catch (cause: unknown) {
    logEvent('warn', 'MESSAGR_BACKUP_ACCEPT_FAILED', {
      from: 'replace',
      failedAt: 'thrown',
      undone: true,
      because: getErrorMessage(cause),
    })
    return { replaced: false, failedAt: 'thrown', undone: true }
  }
  if (!outcome.replaced) {
    logEvent('warn', 'MESSAGR_BACKUP_ACCEPT_FAILED', {
      from: 'replace',
      failedAt: outcome.failedAt,
      // What the failure left, which is the other half of where it stopped
      // (#327): the same step reads differently depending on whether the
      // publication went back.
      undone: outcome.undone,
      ...(outcome.forgotten === false ? { forgotten: false } : {}),
    })
  }
  return outcome
}

/** Where a replacement that did not go through stopped. */
export type ReplaceFailedAt = Extract<
  BackupReplacedFrom,
  { readonly replaced: false }
>['failedAt']

/** A replacement that did not go through: where it stopped, and what it left. */
export interface ReplaceFailure {
  readonly failedAt: ReplaceFailedAt
  /** See `BackupReplaced`: whether the gesture left nothing behind it. */
  readonly undone: boolean
}

/**
 * The sentence the Sauvegarde screen shows, and announces, for a replacement
 * that did not go through (#284).
 *
 * Found in review: every failure said « rien n'a changé : votre ancienne clé
 * ouvre toujours votre sauvegarde ». That holds at `publishing`, and for
 * `thrown`, which `replaceBackup` lets out only before the publish. From
 * `remembering` on, the homeserver held the new version as its current one,
 * and the true sentence was the acceptance's own: the backup could not be
 * turned on.
 *
 * **The step is no longer what decides it (#327), because the step is no
 * longer what determines the state.** A publication taken back IS nothing
 * having changed, whichever step stopped, and a publication that could not be
 * taken back is not, whichever step stopped. So one thing is read, and it is
 * the thing the sentence claims. `failedAt` travels beside it for the log,
 * which is where knowing the step is what helps.
 */
export function failedReplacementSentence(
  failure: ReplaceFailure,
): 'backup_replace_failed' | 'backup_accept_failed' {
  return failure.undone ? 'backup_replace_failed' : 'backup_accept_failed'
}
