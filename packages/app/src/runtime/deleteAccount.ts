import type { PusherTakenAway, ThisDevicesPusher } from './pusher'
import type { RestoreCredentials } from './sessionCredentials'

/**
 * Deleting the account this device holds, from the device itself. #382.
 *
 * # WHERE THIS COMES FROM
 *
 * #380. Deletion was asked for by e-mail, and the legal screen said the
 * gesture from inside the application did not exist yet. Apple's rule
 * 5.1.1(v) asks for exactly that gesture, and for no e-mail outside regulated
 * industries. `CONTEXT.md` names it: account deletion ends the account for
 * everyone, which leaving an account (#304) does not.
 *
 * # THE SERVER FIRST, THEN THIS DEVICE
 *
 * Decided on 26 September 2026. The device writes down that the account is
 * gone only once its server has said so: a mark written first would have the
 * next launch forget an account that still exists, and its password with it.
 *
 * # WHY THE MARK, AND NOT THE FORGETTING ITSELF
 *
 * The crypto library cannot release its machine (`oneMachine.ts`), so what
 * this device keeps of the account is forgotten at the next cold launch, the
 * way leaving an account already is. The mark is what that launch reads.
 *
 * # BEFORE THE DEACTIVATION, WHAT ONLY THE TOKEN CAN DO
 *
 * #383, #385. Once the account is deactivated its token opens nothing, so it
 * is before or never. The invitation service is told first: it records the
 * deletion for the purge and ends the invitations still open. Then this
 * device's pusher goes, so that nothing wakes this
 * telephone for an account that is gone; then the key backup, so that its
 * server keeps nothing of its keys. What the deactivation itself does with
 * either was never measured. Neither decides anything: what became of each
 * goes back with the answer, for the log, and the deletion goes on.
 *
 * THE CONVERSATIONS ARE NOT LEFT HERE, and #381 had said they would be.
 * Decided on 26 September 2026: the server makes a deactivated account leave
 * them itself -- measured on messagr.eu the same day, a join and then a leave
 * sent in the account's name at the second it was deactivated, with nothing
 * leaving before. Leaving first would add nothing when the deactivation
 * works, and when it fails it would leave an account that still exists
 * outside every conversation it had, with no way back in -- while the screen
 * says it still exists.
 */

/**
 * What deleting needs, so the whole of it is testable without a device. The
 * pusher first, read and taken away as `ThisDevicesPusher` says.
 */
export interface Ending extends ThisDevicesPusher {
  /**
   * The password the account came with (#190), or `null` when this device
   * kept none. The server asks for it: the token alone does not deactivate.
   */
  readonly password: () => Promise<string | null>
  /**
   * Tells the invitation service the account is about to be deleted (#385),
   * with its own token. A throw -- an unknown route before the service is
   * deployed, a service nobody reaches -- stops nothing.
   */
  readonly announce: (account: RestoreCredentials) => Promise<void>
  /**
   * The latest key backup version the account's own server holds, or `null`
   * when it holds none. A throw is a server that did not say.
   */
  readonly backupVersion: (
    account: RestoreCredentials,
  ) => Promise<string | null>
  /**
   * Deletes that version on the account's own server. A throw is a backup
   * still there.
   */
  readonly deleteBackup: (
    account: RestoreCredentials,
    version: string,
  ) => Promise<void>
  /**
   * Deactivates the account on its own server, with its password. A throw is
   * an account that is still there.
   */
  readonly deactivate: (
    account: RestoreCredentials,
    password: string,
  ) => Promise<void>
  /**
   * Whether the account's server still knows this session, asked after a
   * deactivation that looked failed: `false` only when it says the token is
   * unknown, `null` when it does not answer.
   */
  readonly stillKnown: (account: RestoreCredentials) => Promise<boolean | null>
  /** Writes down, on this device, that `account` is deleted. */
  readonly markDeleted: (account: RestoreCredentials) => Promise<void>
}

/**
 * A refusal and an unreachable server say the same thing to the person: the
 * account is still there, and trying again takes up what this attempt began.
 * The one case where the account may already be gone is a lost answer
 * followed by a question nobody answered, and trying again settles it.
 */
const NOT_DEACTIVATED = 'the server did not deactivate this account'

/** What was taken away before the deactivation. For the log, never a screen. */
export interface TakenAway {
  readonly pusher: PusherTakenAway
  readonly backup: 'deleted' | 'failed' | 'none'
}

/** The three ways a deletion ends. */
export type Deletion =
  /** Its server deactivated the account. */
  | {
      readonly outcome: 'deleted'
      /** Whether this device could write the deletion down. */
      readonly marked: boolean
      /** Whether the invitation service heard about it (#385). */
      readonly serviceTold: boolean
      readonly takenAway: TakenAway
    }
  /** Its server did not: see `NOT_DEACTIVATED`. */
  | {
      readonly outcome: 'failed'
      readonly reason: string
      readonly serviceTold: boolean
      readonly takenAway: TakenAway
    }
  /**
   * This device kept no password, which the server asks for, so nothing was
   * sent: the way is e-mail (#384).
   */
  | { readonly outcome: 'by-email' }

/** Whether this device can delete its account itself, or the way is e-mail. */
export type DeletionWay = 'here' | 'by-email'

/**
 * Asked before the screen offers anything, so that nobody decides to delete
 * and only then learns that the server would refuse. Nothing is sent to find
 * out. #384.
 */
export async function wayToDelete(
  ending: Pick<Ending, 'password'>,
): Promise<DeletionWay> {
  return (await ending.password()) === null ? 'by-email' : 'here'
}

export async function deleteAccount(
  ending: Ending,
  account: RestoreCredentials,
): Promise<Deletion> {
  const password = await ending.password()
  if (password === null) return { outcome: 'by-email' }
  const serviceTold = await tellTheService(ending, account)
  const takenAway = await takeAwayWhatOnlyTheTokenCan(ending, account)
  try {
    await ending.deactivate(account, password)
  } catch {
    // AN ANSWER CAN BE LOST AFTER THE SERVER HAS ACTED. The account is then
    // gone, the attempt looks failed, and every later one would meet a token
    // the server has forgotten: a device left half undone, which the person
    // could never get out of. A server that no longer knows this session is
    // the answer that was lost. Anything else is an account still there.
    if ((await ending.stillKnown(account)) !== false) {
      return {
        outcome: 'failed',
        reason: NOT_DEACTIVATED,
        serviceTold,
        takenAway,
      }
    }
  }
  // THE SERVER HAS SPOKEN, and that is the fact the screen reports. A mark
  // that cannot be written costs the next launch its reason to forget, not
  // the account its deletion.
  try {
    await ending.markDeleted(account)
    return { outcome: 'deleted', marked: true, serviceTold, takenAway }
  } catch {
    return { outcome: 'deleted', marked: false, serviceTold, takenAway }
  }
}

/** Whether the invitation service heard. Either way, the deletion goes on. */
async function tellTheService(
  ending: Ending,
  account: RestoreCredentials,
): Promise<boolean> {
  try {
    await ending.announce(account)
    return true
  } catch {
    return false
  }
}

/** The pusher, then the key backup. Neither stops the deletion. */
async function takeAwayWhatOnlyTheTokenCan(
  ending: Ending,
  account: RestoreCredentials,
): Promise<TakenAway> {
  const pusher = await takeThePusherAway(ending, account)
  const backup = await deleteTheBackup(ending, account)
  return { pusher, backup }
}

async function takeThePusherAway(
  ending: Ending,
  account: RestoreCredentials,
): Promise<PusherTakenAway> {
  try {
    const pusher = await ending.pusher()
    if (pusher === null) return 'none'
    await ending.stopWaking(account, pusher)
    return 'removed'
  } catch {
    return 'failed'
  }
}

/**
 * How many backup versions one deletion takes away at most. An account has
 * one, and two when a replaced restore key's old version would not go
 * (`replaceBackup.ts`); the bound is for a server that keeps answering.
 */
const MOST_BACKUP_VERSIONS = 5

/**
 * Every version the server still holds, newest first. It answers with the
 * latest version, so once that one is gone it answers with the one before. A
 * version it names again after being told to delete it is one it keeps, and
 * asking more would not change that.
 */
async function deleteTheBackup(
  ending: Ending,
  account: RestoreCredentials,
): Promise<TakenAway['backup']> {
  let deleted: string | null = null
  try {
    for (let round = 0; round < MOST_BACKUP_VERSIONS; round++) {
      const version = await ending.backupVersion(account)
      if (version === null) return deleted === null ? 'none' : 'deleted'
      if (version === deleted) return 'failed'
      await ending.deleteBackup(account, version)
      deleted = version
    }
    return 'failed'
  } catch {
    return 'failed'
  }
}
