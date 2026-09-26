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
 */

/** What deleting needs, so the whole of it is testable without a device. */
export interface Ending {
  /**
   * The password the account came with (#190), or `null` when this device
   * kept none. The server asks for it: the token alone does not deactivate.
   */
  readonly password: () => Promise<string | null>
  /**
   * Deactivates the account on its own server, with its password. A throw is
   * an account that is still there.
   */
  readonly deactivate: (
    account: RestoreCredentials,
    password: string,
  ) => Promise<void>
  /** Writes down, on this device, that `account` is deleted. */
  readonly markDeleted: (account: RestoreCredentials) => Promise<void>
}

/**
 * Without the password the server refuses, so nothing is sent. #384 says what
 * the screen offers instead.
 */
export const NO_PASSWORD = 'this device kept no password for this account'

/**
 * A refusal and an unreachable server say the same thing to the person: the
 * account is still there, and trying again is safe.
 */
export const NOT_DEACTIVATED = 'the server did not deactivate this account'

export type Deletion =
  | {
      readonly deleted: true
      /** Whether this device could write the deletion down. */
      readonly marked: boolean
    }
  | { readonly deleted: false; readonly reason: string }

export async function deleteAccount(
  ending: Ending,
  account: RestoreCredentials,
): Promise<Deletion> {
  const password = await ending.password()
  if (password === null) {
    return { deleted: false, reason: NO_PASSWORD }
  }
  try {
    await ending.deactivate(account, password)
  } catch {
    return { deleted: false, reason: NOT_DEACTIVATED }
  }
  // THE SERVER HAS SPOKEN, and that is the fact the screen reports. A mark
  // that cannot be written costs the next launch its reason to forget, not
  // the account its deletion.
  try {
    await ending.markDeleted(account)
    return { deleted: true, marked: true }
  } catch {
    return { deleted: true, marked: false }
  }
}
