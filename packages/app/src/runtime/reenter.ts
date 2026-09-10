import type { RestoreCredentials } from './sessionCredentials'

/**
 * Coming back after a reinstall, as a new device on the same account.
 *
 * # WHAT WENT WRONG WITHOUT THIS
 *
 * #190, reported from an iPhone: uninstalling removes the data directory —
 * the crypto store, the encrypted notebook — and **does not remove the
 * keychain**. iOS never clears keychain entries when an application goes,
 * and `ThisDeviceOnly` does not change that: it stops iCloud syncing, not
 * survival.
 *
 * So the next launch found a session, an account and a *device identifier*
 * that were all intact, and a crypto store that was empty. It published
 * fresh identity keys under the old device id — and to everybody on the
 * other side, that is not a reinstall, it is an existing device whose keys
 * changed underneath them. That is the shape of an attack, and it is exactly
 * what device verification exists to raise. A product that teaches people to
 * be suspicious of it must not manufacture it.
 *
 * # WHY THE PASSWORD, AND WHAT IT COSTS
 *
 * Measured against the bench before any of this was written:
 *
 * - `POST /login/get_token` (MSC3882) exists on the homeserver and answers
 *   `401` with `m.login.password` — a client holding only a token cannot
 *   mint a login token. So a token alone cannot make a new device.
 * - `POST /login` with `m.login.password` answers `200` and a **new
 *   `device_id` on the same account**.
 * - `DELETE /devices/{id}` answers `401`, then `200` once the same password
 *   is presented through user-interactive authentication. So the dead device
 *   can be retired rather than left standing.
 *
 * The invitation service has always handed the password back at claim time;
 * `claimInvitation.ts` deliberately dropped it, on the reasoning that a
 * session needs only the triple. That reasoning was about restoring a
 * session and had nothing to say about replacing one.
 *
 * The cost is a password at rest in the platform keystore, and it is not a
 * small one: a password is strictly more powerful than an access token,
 * because it makes devices at will and cannot be revoked device by device.
 * Whoever defeats the keystore gets the account rather than a session. That
 * was weighed and accepted by the account holder on 10 September 2026,
 * against the alternative of somebody being locked out by a reinstall they
 * did nothing wrong to cause.
 *
 * # WHOSE DEVICES THIS WORKS FOR
 *
 * Accounts claimed from this version on. A device already installed has no
 * password kept and cannot get one: changing a Matrix password needs the old
 * one. Those accounts keep the previous behaviour until they enter again,
 * which is worth knowing rather than discovering.
 */

/** The calls this needs, so the whole dance is testable without a network. */
export interface Reentering {
  /**
   * Posts to the homeserver and answers what came back.
   *
   * A status and a body rather than a throw: a `401` is the middle of
   * user-interactive authentication and not a failure, and a caller that
   * could not tell the two apart would give up halfway through a working
   * exchange.
   */
  readonly post: (
    path: string,
    body: unknown,
    bearer?: string,
  ) => Promise<{ readonly status: number; readonly body: unknown }>
  /** Same, for the one call that is a DELETE. */
  readonly remove: (
    path: string,
    body: unknown,
    bearer: string,
  ) => Promise<{ readonly status: number; readonly body: unknown }>
}

export type Reentered =
  | { readonly reentered: true; readonly session: RestoreCredentials }
  | { readonly reentered: false; readonly reason: string }

/** The local part of `@somebody:server`, which is what `/login` wants. */
function localpartOf(userId: string): string {
  return userId.replace(/^@/, '').split(':')[0] ?? ''
}

/**
 * Logs in again and answers a session for a brand new device.
 *
 * `initial_device_display_name` is left to the caller's absence rather than
 * invented here: what a device calls itself is a product decision and this
 * module is a protocol one.
 */
export async function reenterWithPassword(
  deps: Reentering,
  account: {
    readonly baseUrl: string
    readonly userId: string
    readonly password: string
  },
): Promise<Reentered> {
  const answer = await deps.post('/_matrix/client/v3/login', {
    type: 'm.login.password',
    identifier: { type: 'm.id.user', user: localpartOf(account.userId) },
    password: account.password,
  })
  if (answer.status !== 200) {
    return { reentered: false, reason: `the homeserver refused to log in` }
  }
  const read = answer.body as Record<string, unknown>
  const { user_id: userId, device_id: deviceId, access_token: token } = read
  if (
    typeof userId !== 'string' ||
    typeof deviceId !== 'string' ||
    typeof token !== 'string'
  ) {
    // A partial session is worse than none, for the reason
    // `claimInvitation.ts` gives: stored and restored, it fails later with
    // nothing connecting the failure to this moment.
    return { reentered: false, reason: 'the homeserver answered no session' }
  }
  return {
    reentered: true,
    session: {
      baseUrl: account.baseUrl,
      userId,
      deviceId,
      accessToken: token,
    },
  }
}

/**
 * Retires the device this account left behind.
 *
 * # THE 401 IS THE PROTOCOL, NOT A REFUSAL
 *
 * `DELETE /devices/{id}` answers `401` with a `session` and the flows it
 * accepts; the same call carrying `auth` then succeeds. Measured in that
 * order on the bench. A caller that read the first answer as "no" would
 * leave a dead device standing on every reinstall.
 *
 * Answers whether it went. A device that will not retire is untidy and not
 * dangerous — it holds keys nobody has and its owner has already come back
 * as somebody else — so nothing above this stops for it.
 */
export async function retireDevice(
  deps: Reentering,
  device: {
    readonly deviceId: string
    readonly userId: string
    readonly password: string
    readonly accessToken: string
  },
): Promise<boolean> {
  const path = `/_matrix/client/v3/devices/${encodeURIComponent(device.deviceId)}`
  const first = await deps.remove(path, {}, device.accessToken)
  if (first.status === 200) return true
  if (first.status !== 401) return false

  const session = (first.body as { session?: unknown } | null)?.session
  if (typeof session !== 'string') return false

  const second = await deps.remove(
    path,
    {
      auth: {
        type: 'm.login.password',
        session,
        identifier: { type: 'm.id.user', user: localpartOf(device.userId) },
        password: device.password,
      },
    },
    device.accessToken,
  )
  return second.status === 200
}
