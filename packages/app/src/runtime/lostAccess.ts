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
   * Keeps the new session for the next cold launch, written down as a new
   * device so that its empty crypto store is not taken for a reinstall.
   */
  readonly keepNewDevice: (session: RestoreCredentials) => Promise<void>
  /**
   * Retires the device this telephone was, with the new session and the
   * password. Answers whether it went: a device the server already dropped is
   * untidy at worst, as `retireDevice` says.
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

/** What the screen offers besides forgetting the account. */
export async function waysOut(
  regaining: Pick<Regaining, 'password'>,
): Promise<{ readonly comeBack: boolean }> {
  return { comeBack: (await regaining.password()) !== null }
}

/**
 * How « Revenir sur ce compte » ended.
 *
 * - `back`: a new device, kept for the next cold launch.
 * - `deleted`: the account is deactivated, and marked to be forgotten.
 * - `refused`: the password does not open it, or none was kept. Only
 *   forgetting is left.
 * - `unreachable`: nothing answered; trying again is safe.
 */
export type ComingBack = 'back' | 'deleted' | 'refused' | 'unreachable'

export async function comeBack(
  regaining: Regaining,
  account: RestoreCredentials,
): Promise<ComingBack> {
  const password = await regaining.password()
  if (password === null) return 'refused'
  let answer: Reentered
  try {
    answer = await regaining.logIn(account, password)
  } catch {
    return 'unreachable'
  }
  if (!answer.reentered) {
    if (answer.errcode !== 'M_USER_DEACTIVATED') return 'refused'
    await regaining.markForgotten(account)
    return 'deleted'
  }
  // KEPT BEFORE ANYTHING ELSE, as after a reinstall: an interruption past
  // this point must not leave a device made that nobody can find again.
  await regaining.keepNewDevice(answer.session)
  await regaining.retire(account, answer.session, password)
  return 'back'
}

/** « Oublier ce compte »: nothing is sent, and the next cold launch forgets. */
export async function forgetIt(
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
