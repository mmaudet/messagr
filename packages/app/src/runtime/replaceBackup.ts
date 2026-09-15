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
       * As `acceptBackup`. Nothing here retires the old version, but only a
       * failure at `publishing` leaves the homeserver as it was: from
       * `remembering` on, the new version is already its current one.
       *
       * `thrownAfterPublishing` is a step that threw instead of answering, once
       * the new version was published. A throw before that still rejects, and
       * nothing had changed.
       */
      readonly failedAt:
        'publishing' | 'remembering' | 'enabling' | 'thrownAfterPublishing'
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
    return { replaced: false, failedAt: 'thrownAfterPublishing' }
  }
  if (!accepted.accepted) {
    return {
      replaced: false,
      failedAt: accepted.failedAt,
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
 * What the Sauvegarde screen is answered: the replacement's own answer, or
 * `thrown` for one that rejected instead of answering. `replaceBackup` rejects
 * only before the publish, so nothing on the homeserver moved.
 */
export type BackupReplacedFrom =
  BackupReplaced | { readonly replaced: false; readonly failedAt: 'thrown' }

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
      because: getErrorMessage(cause),
    })
    return { replaced: false, failedAt: 'thrown' }
  }
  if (!outcome.replaced) {
    logEvent('warn', 'MESSAGR_BACKUP_ACCEPT_FAILED', {
      from: 'replace',
      failedAt: outcome.failedAt,
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

/**
 * The sentence the Sauvegarde screen shows, and announces, for a replacement
 * that did not go through (#284).
 *
 * Found in review: every failure said « rien n'a changé : votre ancienne clé
 * ouvre toujours votre sauvegarde ». That holds at `publishing`, and for
 * `thrown`, which `replaceBackup` lets out only before the publish. From
 * `remembering` on, the homeserver holds the new version as its current one,
 * and the true sentence is the acceptance's own: the backup could not be
 * turned on. A step this does not name gets that one too, because it claims
 * less.
 */
export function failedReplacementSentence(
  failedAt: ReplaceFailedAt,
): 'backup_replace_failed' | 'backup_accept_failed' {
  return failedAt === 'publishing' || failedAt === 'thrown'
    ? 'backup_replace_failed'
    : 'backup_accept_failed'
}
