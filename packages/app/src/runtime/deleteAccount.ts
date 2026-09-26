import type { Road } from './pusher'
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
 * # BEFORE THE DEACTIVATION, WHAT ONLY THE TOKEN CAN UNDO
 *
 * #383. Once the account is deactivated its token opens nothing, so it is
 * before or never. This device's pusher goes, so that nothing wakes this
 * telephone for an account that is gone; then the key backup, so that its
 * server keeps nothing of its keys. What the deactivation itself does with
 * either was never measured. Neither decides anything: a failure is noted,
 * and the deletion goes on.
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

/** What deleting needs, so the whole of it is testable without a device. */
export interface Ending {
  /**
   * The password the account came with (#190), or `null` when this device
   * kept none. The server asks for it: the token alone does not deactivate.
   */
  readonly password: () => Promise<string | null>
  /**
   * The pusher this device last registered, and the road it went by, or
   * `null` when it never wrote one down: the reading `Departure.pusher` makes.
   */
  readonly pusher: () => Promise<{
    readonly token: string
    readonly road: Road
  } | null>
  /**
   * Takes that pusher away on the account's own server. A throw is a pusher
   * that did not go.
   */
  readonly stopWaking: (
    account: RestoreCredentials,
    pusher: { readonly token: string; readonly road: Road },
  ) => Promise<void>
  /**
   * The version of the key backup the account has on its own server, or
   * `null` when it has none. A throw is a server that did not say.
   */
  readonly backup: (account: RestoreCredentials) => Promise<string | null>
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
 * Without the password the server refuses, so nothing is sent. #384 says what
 * the screen offers instead.
 */
const NO_PASSWORD = 'this device kept no password for this account'

/**
 * A refusal and an unreachable server say the same thing to the person: the
 * account is still there, and trying again is safe.
 */
const NOT_DEACTIVATED = 'the server did not deactivate this account'

/** What was taken away before the deactivation. For the log, never a screen. */
export interface Undone {
  readonly pusher: 'removed' | 'failed' | 'none'
  readonly backup: 'deleted' | 'failed' | 'none'
}

export type Deletion =
  | {
      readonly deleted: true
      /** Whether this device could write the deletion down. */
      readonly marked: boolean
      readonly undone: Undone
    }
  | {
      readonly deleted: false
      readonly reason: string
      /** Absent when nothing was attempted. */
      readonly undone?: Undone
    }

export async function deleteAccount(
  ending: Ending,
  account: RestoreCredentials,
): Promise<Deletion> {
  const password = await ending.password()
  if (password === null) {
    return { deleted: false, reason: NO_PASSWORD }
  }
  const undone = await undoWhatOnlyTheTokenCan(ending, account)
  try {
    await ending.deactivate(account, password)
  } catch {
    // AN ANSWER CAN BE LOST AFTER THE SERVER HAS ACTED. The account is then
    // gone, the attempt looks failed, and every later one would meet a token
    // the server has forgotten: a device left half undone, which the person
    // could never get out of. A server that no longer knows this session is
    // the answer that was lost. Anything else is an account still there.
    if ((await ending.stillKnown(account)) !== false) {
      return { deleted: false, reason: NOT_DEACTIVATED, undone }
    }
  }
  // THE SERVER HAS SPOKEN, and that is the fact the screen reports. A mark
  // that cannot be written costs the next launch its reason to forget, not
  // the account its deletion.
  try {
    await ending.markDeleted(account)
    return { deleted: true, marked: true, undone }
  } catch {
    return { deleted: true, marked: false, undone }
  }
}

/** The pusher, then the key backup. Neither stops the deletion. */
async function undoWhatOnlyTheTokenCan(
  ending: Ending,
  account: RestoreCredentials,
): Promise<Undone> {
  const pusher = await takeThePusherAway(ending, account)
  const backup = await deleteTheBackup(ending, account)
  return { pusher, backup }
}

async function takeThePusherAway(
  ending: Ending,
  account: RestoreCredentials,
): Promise<Undone['pusher']> {
  try {
    const pusher = await ending.pusher()
    if (pusher === null) return 'none'
    await ending.stopWaking(account, pusher)
    return 'removed'
  } catch {
    return 'failed'
  }
}

async function deleteTheBackup(
  ending: Ending,
  account: RestoreCredentials,
): Promise<Undone['backup']> {
  try {
    const version = await ending.backup(account)
    if (version === null) return 'none'
    await ending.deleteBackup(account, version)
    return 'deleted'
  } catch {
    return 'failed'
  }
}
