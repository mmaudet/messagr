import type { DeviceIdentity } from './deviceIdentity'
import type { Reentered } from './reenter'
import type { RestoreCredentials } from './sessionCredentials'

/**
 * A device whose homeserver no longer knows its token. #391.
 *
 * # WHAT IT MEANS, AND WHY THE SCREEN CANNOT SAY WHICH
 *
 * The sync loop says it (`refused`, `syncLoop.ts`) and stops. Three things
 * lead here, and a refused token looks the same for all of them: the account
 * was deleted by e-mail (#384) or its deletion mark was never written (#382);
 * it was revoked, which deactivates the accounts an invitation let in (§8.2);
 * or this telephone was taken off an account that lives on. So the screen
 * says the one thing true of all three -- « Ce téléphone n'a plus accès à ce
 * compte. » -- and offers what can be done.
 *
 * # NEVER BACK ON ITS OWN
 *
 * Decided on 26 September 2026. A telephone taken off its account must stay
 * off until the person asks to come back: coming back by itself, with the
 * password this device keeps, would undo what somebody did on purpose. So
 * « Revenir sur ce compte » is offered, never performed unasked, and only on
 * a device that kept the password (#190).
 *
 * # COMING BACK IS A REINSTALL, AT A DIFFERENT MOMENT
 *
 * `reenter.ts` already brings a device back as a new one after a reinstall:
 * log in with the kept password, keep the new session, retire the old device.
 * Here it happens while a crypto machine runs on the old one, and the library
 * cannot release it (`oneMachine.ts`): the new session is kept for the next
 * cold launch, marked as a new device rather than a reinstall, and the person
 * is asked to close the application. A login refused as `M_USER_DEACTIVATED`
 * is the answer to the question the screen could not ask: the account is
 * gone, and it is forgotten the way a deleted one is.
 *
 * # FORGETTING WITH THE MARK OF A DELETION
 *
 * « Oublier ce compte » writes the mark a deletion writes (#382), for an
 * account this device cannot tell deleted from alive. What the next launch
 * does with it is the same either way: it forgets everything the account
 * left here, and sends nothing. Leaving an account (#304) would also take
 * its pusher and its session off the server, which a refused token no
 * longer can.
 */

/** What this needs, so the whole of it is testable without a device. */
export interface Regaining {
  /** The password the account came with (#190), or `null` when none was kept. */
  readonly password: () => Promise<string | null>
  /**
   * Logs in with that password. The session of a brand new device, or the
   * homeserver's refusal with its code. A throw is a server nobody reached.
   */
  readonly logIn: (
    account: RestoreCredentials,
    password: string,
  ) => Promise<Reentered>
  /**
   * Keeps the new session for the next cold launch, in place of `old`, with
   * the mark `newDeviceMark` makes of the two: that launch reads it with
   * `cameBackAs`. A throw is a session this device did not keep.
   */
  readonly keepNewDevice: (
    session: RestoreCredentials,
    old: DeviceIdentity,
  ) => Promise<void>
  /**
   * Retires the device this telephone was, with the new session and the
   * password. Answers whether it went: a device the server already dropped is
   * untidy at worst, as `retireDevice` says, and a throw is no worse.
   */
  readonly retire: (
    old: RestoreCredentials,
    session: RestoreCredentials,
    password: string,
  ) => Promise<boolean>
  /**
   * Writes down that the account is to be forgotten at the next cold launch:
   * the mark a deletion writes (#382), read by `entry.ts`.
   */
  readonly markForgotten: (account: RestoreCredentials) => Promise<void>
}

/**
 * What the screen offers besides forgetting the account. A password that
 * cannot be read is none: the screen then offers only what needs none.
 */
export async function waysOut(
  regaining: Pick<Regaining, 'password'>,
): Promise<{ readonly comeBack: boolean }> {
  return { comeBack: (await keptPassword(regaining)) !== null }
}

/**
 * How « Revenir sur ce compte » ended.
 *
 * - `back`: a new device, kept for the next cold launch.
 * - `deleted`: the account is deactivated, and marked to be forgotten.
 * - `refused`: the password itself was refused (`M_FORBIDDEN`), or none was
 *   kept. Only forgetting is left.
 * - `unreachable`: nothing answered, the server refused for a reason that
 *   passes, or this device could not keep what came back. Trying again costs
 *   at worst a device nobody holds, untidy as `retireDevice` says of one that
 *   will not go.
 */
export type ComingBack = 'back' | 'deleted' | 'refused' | 'unreachable'

/** Never throws: each step's failure is one of the four endings. */
export async function comeBack(
  regaining: Regaining,
  account: RestoreCredentials,
): Promise<ComingBack> {
  const password = await keptPassword(regaining)
  if (password === null) return 'refused'
  let answer: Reentered
  try {
    answer = await regaining.logIn(account, password)
  } catch {
    return 'unreachable'
  }
  if (!answer.reentered) {
    switch (answer.errcode) {
      case 'M_USER_DEACTIVATED':
        // THE SERVER HAS SPOKEN, as `deleteAccount.ts` says of its own: a
        // mark that will not write costs the next launch its reason to
        // forget, and that launch meets the same refused token again.
        await regaining.markForgotten(account).catch(() => {})
        return 'deleted'
      case 'M_FORBIDDEN':
        return 'refused'
      default:
        return 'unreachable'
    }
  }
  // KEPT BEFORE ANYTHING ELSE, as after a reinstall: an interruption past
  // this point must not leave a device made that nobody can find again.
  try {
    await regaining.keepNewDevice(answer.session, account)
  } catch {
    return 'unreachable'
  }
  // BACK, WHATEVER THE RETIREMENT SAYS. The new device is kept; an ending
  // that offered « Revenir » again would make yet another.
  await regaining.retire(account, answer.session, password).catch(() => false)
  return 'back'
}

/**
 * « Oublier ce compte »: nothing is sent, and the next cold launch forgets.
 * Answers whether the mark was written.
 */
export async function forgetTheAccount(
  regaining: Pick<Regaining, 'markForgotten'>,
  account: RestoreCredentials,
): Promise<boolean> {
  try {
    await regaining.markForgotten(account)
    return true
  } catch {
    return false
  }
}

async function keptPassword(
  regaining: Pick<Regaining, 'password'>,
): Promise<string | null> {
  try {
    return await regaining.password()
  } catch {
    return null
  }
}

/**
 * The mark `keepNewDevice` writes: the device this telephone came back as,
 * and the one it was.
 */
export function newDeviceMark(
  session: DeviceIdentity,
  old: DeviceIdentity,
): string {
  return JSON.stringify({ now: session.deviceId, was: old.deviceId })
}

/** What the launch after « Revenir sur ce compte » needs, without a device. */
export interface CameBack {
  /** The mark, as `newDeviceMark` wrote it, or `null`. */
  readonly mark: () => Promise<string | null>
  readonly clearMark: () => Promise<void>
  /** Erases the crypto store this telephone kept as `deviceId`. */
  readonly eraseStore: (deviceId: string) => Promise<void>
  /** Whether a crypto machine runs in this process, on whatever store. */
  readonly aMachineIsRunning: () => boolean
}

/**
 * Whether `session` is the device « Revenir sur ce compte » came back as,
 * still without its store. #391.
 *
 * THE MARK STAYS UNTIL THE STORE EXISTS. A launch killed before its machine
 * made the store, or one whose machine could not start, would otherwise
 * leave the next one a session without a store and without a mark: a
 * reinstall, which logs in again and makes a third device. Cleared as soon
 * as the store is there, because a mark outliving it would one day tell a
 * real reinstall that it was a device beginning -- the very confusion #190
 * is about.
 *
 * THE STORE THE TELEPHONE HAD IS ERASED. It holds the keys of a device that
 * no longer exists, nothing here reads it again, and forgetting the account
 * later would not find it: forgetting takes the store of the device it
 * holds. Only once the mark names this launch's session -- a mark naming
 * another device is one whose session was never kept, and the store it
 * calls old is the one in use -- and never while a machine runs in this
 * process: a link opened over « Fermez complètement Messagr » runs the launch
 * again beside the old device's machine, still on that store. The mark stays,
 * and the next cold launch erases it.
 *
 * Never throws. A mark that cannot be read is no mark.
 */
export async function cameBackAs(
  cameBack: CameBack,
  session: DeviceIdentity,
  storeExists: boolean,
): Promise<boolean> {
  let raw: string | null
  try {
    raw = await cameBack.mark()
  } catch {
    return false
  }
  if (raw === null) return false
  const mark = readNewDeviceMark(raw)
  if (mark !== null && mark.now === session.deviceId) {
    if (mark.was !== session.deviceId && !cameBack.aMachineIsRunning()) {
      await cameBack.eraseStore(mark.was).catch(() => {})
    }
    if (!storeExists) return true
  }
  await cameBack.clearMark().catch(() => {})
  return false
}

function readNewDeviceMark(
  raw: string,
): { readonly now: string; readonly was: string } | null {
  try {
    const read = JSON.parse(raw) as { now?: unknown; was?: unknown } | null
    return typeof read?.now === 'string' && typeof read.was === 'string'
      ? { now: read.now, was: read.was }
      : null
  } catch {
    return null
  }
}
