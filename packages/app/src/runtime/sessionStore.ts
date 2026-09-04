import type { RestoreCredentials } from './sessionCredentials'

/**
 * Keeping a session between launches.
 *
 * This holds an access token, which is a bearer credential for the whole
 * account: whoever reads it is the account. So it belongs in the operating
 * system's own keystore rather than in ordinary application storage, and
 * `SecretStore` exists to say that at the type level — nothing here knows
 * whether the value is encrypted, only that the thing holding it is where
 * secrets go.
 *
 * Why it must persist at all: an invitation is single-use. An application
 * that lost its session and claimed again would find nothing, because the
 * token was spent the first time. Losing a session is losing the account, not
 * an inconvenience — which is why a failed write is reported rather than
 * swallowed.
 */
export interface SecretStore {
  read: () => Promise<string | null>
  write: (value: string) => Promise<void>
}

/**
 * Written as one value rather than four, so that a half-written session
 * cannot exist. A store interrupted between two of four writes would leave
 * something that reads as a session and is not one.
 */
export async function saveSession(
  store: SecretStore,
  session: RestoreCredentials,
): Promise<boolean> {
  try {
    await store.write(JSON.stringify(session))
    return true
  } catch {
    return false
  }
}

/**
 * `null` for every reason a session might not come back: nothing stored yet,
 * a store that refused, a value that does not parse, or one missing a field.
 *
 * The caller's answer is the same in all four cases — ask for an invitation —
 * and distinguishing them would only invite handling that cannot differ. A
 * keystore refusing is ordinary rather than exceptional: the device may be
 * locked, or the entry invalidated by a credential change.
 */
export async function loadSession(
  store: SecretStore,
): Promise<RestoreCredentials | null> {
  let raw: string | null
  try {
    raw = await store.read()
  } catch {
    return null
  }
  if (raw === null) {
    return null
  }

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return null
  }

  const { baseUrl, userId, deviceId, accessToken } = parsed
  if (
    typeof baseUrl !== 'string' ||
    typeof userId !== 'string' ||
    typeof deviceId !== 'string' ||
    typeof accessToken !== 'string'
  ) {
    return null
  }

  return { baseUrl, userId, deviceId, accessToken }
}
