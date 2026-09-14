import { forgetPusher, type Road } from './pusher'
import type { RestoreCredentials } from './sessionCredentials'

/**
 * Leaving the account this device holds, so that an invitation into another
 * server can be followed.
 *
 * # WHERE THIS COMES FROM
 *
 * #304. A telephone carrying an account from a server it had outlived could
 * follow no invitation at all: #279 keeps an account's token on its own
 * server, so a link into messagr.eu was refused, and the next one too. iOS
 * keeps the keychain through an uninstall (#190), so uninstalling brought the
 * same account back. Nothing in the application could leave it.
 *
 * `entry.ts` asks the person. This is what happens when the answer is to go.
 *
 * # IN THIS ORDER
 *
 * **The account is closed on its own server, and nothing waits for that.**
 * The pusher first, so that server stops waking this telephone for an account
 * it no longer holds; then the session, which retires this device there. Both
 * carry the account's own token to the account's own server, which is the one
 * place that token has ever been allowed to go.
 *
 * **Then what this device keeps of the account is forgotten.** The pushkey is
 * read before, because it is one of the things forgotten.
 *
 * **Claiming the link is not here.** It is the ordinary claim of a device with
 * no account, and `entry.ts` already makes that one.
 */

/** What leaving needs, so the whole of it is testable without a network. */
export interface Leaving {
  /**
   * A homeserver, named by its base URL. Leaving names the account's own and
   * no other, which is the property the tests watch.
   *
   * A status for an answer the server gave. A throw is a server that could not
   * be reached, which is a different fact and is reported as one.
   */
  readonly homeserver: (baseUrl: string) => {
    readonly post: (
      path: string,
      body: unknown,
      bearer?: string,
    ) => Promise<{ readonly status: number; readonly body: unknown }>
  }
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
   * Erases what this device keeps of the account. Answers rather than throws:
   * a step that failed is the caller's to report, and leaving goes on.
   */
  readonly forget: (account: RestoreCredentials) => Promise<void>
}

/** What became of the account on its own server. For the log, never a screen. */
export interface Closed {
  readonly pusher: 'removed' | 'refused' | 'unreachable' | 'none'
  readonly loggedOut: boolean
}

export async function leaveAccount(
  deps: Leaving,
  account: RestoreCredentials,
): Promise<{ readonly closing: Promise<Closed> }> {
  // Read before anything is forgotten, since the pushkey is one of the things
  // forgetting takes.
  const pusher = await deps.pusher()
  // STARTED, NOT AWAITED. The first request is on its way before forgetting
  // begins, and nothing after it waits for an answer: a server switched off,
  // or a telephone with no network, would otherwise keep somebody on a
  // question they have already answered.
  const closing = closeOnItsOwnServer(deps, account, pusher)
  await deps.forget(account)
  return { closing }
}

async function closeOnItsOwnServer(
  deps: Leaving,
  account: RestoreCredentials,
  pusher: { readonly token: string; readonly road: Road } | null,
): Promise<Closed> {
  const own = deps.homeserver(account.baseUrl)
  let removed: Closed['pusher'] = 'none'
  if (pusher !== null) {
    try {
      const answer = await own.post(
        '/_matrix/client/v3/pushers/set',
        forgetPusher(pusher.token, pusher.road),
        account.accessToken,
      )
      removed = answer.status === 200 ? 'removed' : 'refused'
    } catch {
      removed = 'unreachable'
    }
  }
  // Tried whatever became of the pusher. One request lost on a bad network
  // says little about the next, and ending the session is what retires this
  // device on that server.
  try {
    const answer = await own.post(
      '/_matrix/client/v3/logout',
      {},
      account.accessToken,
    )
    return { pusher: removed, loggedOut: answer.status === 200 }
  } catch {
    return { pusher: removed, loggedOut: false }
  }
}
