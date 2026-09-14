import type { Road } from './pusher'
import type { RestoreCredentials } from './sessionCredentials'
import type { SecretStore } from './sessionStore'

/**
 * Leaving the account this device holds, once another account has been
 * claimed to replace it.
 *
 * # WHERE THIS COMES FROM
 *
 * #304. A telephone carrying an account from a server it had outlived could
 * follow no invitation at all: #279 keeps an account's token on its own
 * server, so a link into messagr.eu was refused, and the next one too. iOS
 * keeps the keychain through an uninstall (#190), so uninstalling brought the
 * same account back. Nothing in the application could leave it.
 *
 * # AFTER THE CLAIM, NEVER BEFORE
 *
 * Decided on 14 September 2026. Only a claim whose account this device has
 * kept leads here, so a link that turns out to be spent or unreachable, or a
 * keystore that refuses the new session, costs nobody the account they had.
 * `entry.ts` holds that order, and the window a stop leaves open; this is what
 * follows it.
 *
 * # IN THIS ORDER
 *
 * **The pushkey is read first**, since forgetting the account takes it.
 *
 * **The old server is told, and nobody waits for it.** The pusher first, so
 * that server stops waking this telephone for an account it no longer holds;
 * then the session, which retires this device there. Both carry the old
 * account's credentials, held in memory, to its own server and to no other.
 *
 * **Then what this device keeps of the account is forgotten**, sparing the
 * entries the next account has already written.
 */

/** What leaving needs, so the whole of it is testable without a device. */
export interface Departure {
  /**
   * The pusher this device last registered, and the road it went by. `null`
   * when it never wrote one down; it answers rather than throws, the way
   * `lastPushkey.ts` does.
   */
  readonly pusher: () => Promise<{
    readonly token: string
    readonly road: Road
  } | null>
  /**
   * Takes that pusher away on the account's own server: the removal
   * `cryptoPump.ts` already makes for the notifications switch, bound to this
   * account. A throw is a pusher that did not go.
   */
  readonly stopWaking: (
    account: RestoreCredentials,
    pusher: { readonly token: string; readonly road: Road },
  ) => Promise<void>
  /** Ends the account's session on its own server, which retires this device there. */
  readonly logOut: (account: RestoreCredentials) => Promise<void>
  /**
   * Erases the password the account came with. `entry.ts` says why it goes
   * before the next account's session is kept.
   */
  readonly forgetPassword: () => Promise<void>
  /**
   * Erases what this device keeps of the account, except the entries in
   * `keeping`. Answers rather than throws: a step that failed is the adapter's
   * to report, and leaving goes on.
   */
  readonly forget: (
    account: RestoreCredentials,
    keeping: readonly SecretStore[],
  ) => Promise<void>
}

/** What became of the account on its own server. For the log, never a screen. */
export interface Closed {
  readonly pusher: 'removed' | 'failed' | 'none'
  readonly loggedOut: boolean
}

export async function leaveAccount(
  departure: Departure,
  account: RestoreCredentials,
  keeping: readonly SecretStore[],
): Promise<{ readonly closing: Promise<Closed> }> {
  const pusher = await departure.pusher()
  // STARTED, NOT AWAITED. The first request is on its way before forgetting
  // begins, and nothing after it waits for an answer: a server switched off,
  // or a telephone with no network, would otherwise hold a launch open on an
  // account it has already left.
  const closing = closeOnItsOwnServer(departure, account, pusher)
  await departure.forget(account, keeping)
  return { closing }
}

async function closeOnItsOwnServer(
  departure: Departure,
  account: RestoreCredentials,
  pusher: { readonly token: string; readonly road: Road } | null,
): Promise<Closed> {
  let removed: Closed['pusher'] = 'none'
  if (pusher !== null) {
    try {
      await departure.stopWaking(account, pusher)
      removed = 'removed'
    } catch {
      removed = 'failed'
    }
  }
  // Tried whatever became of the pusher. One request lost on a bad network
  // says little about the next, and ending the session is what retires this
  // device on that server.
  try {
    await departure.logOut(account)
    return { pusher: removed, loggedOut: true }
  } catch {
    return { pusher: removed, loggedOut: false }
  }
}
