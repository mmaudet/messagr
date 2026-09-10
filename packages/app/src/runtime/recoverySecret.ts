import type { SecretStore } from './sessionStore'

/**
 * The password this account came with, kept for one purpose.
 *
 * # ITS OWN ENTRY, BESIDE THE SESSION AND NOT INSIDE IT
 *
 * `sessionStore.ts` holds what restores a session: a triple that lets
 * matrix-js-sdk skip `/login` entirely. This holds what *replaces* one. The
 * two have different lifetimes and different weight, and folding the second
 * into the first would make `RestoreCredentials` -- a type whose whole
 * meaning is "what the SDK needs" -- carry a credential the SDK must never
 * see.
 *
 * It also keeps the blast radius readable. A reader of `saveSession` can see
 * exactly what a session is; a reader of this file can see that a password
 * is on the device and why.
 *
 * # WHAT IT IS FOR, AND ONLY THAT
 *
 * Coming back after a reinstall as a new device on the same account. See
 * `reenter.ts` for the measurements that make it necessary and for what it
 * costs -- a password is strictly more powerful than an access token,
 * because it makes devices at will and cannot be revoked device by device.
 *
 * Nothing else reads it. It is never sent anywhere but the account's own
 * homeserver, never shown, and never used to authenticate an ordinary call:
 * every other request in this application carries the access token.
 *
 * # WHICH WAY IT FAILS
 *
 * Absent. A device that cannot keep it, or was claimed before this existed,
 * simply has no way back from a reinstall -- which is the behaviour that was
 * there before, so losing this loses nothing that was ever promised.
 * `keepRecoverySecret` reports its failure for that reason and no stronger
 * one: entry does not stop over it.
 */

export async function keepRecoverySecret(
  store: SecretStore,
  password: string,
): Promise<boolean> {
  try {
    await store.write(password)
    return true
  } catch {
    return false
  }
}

/** `null` for every reason it might not come back. See `loadSession`. */
export async function readRecoverySecret(
  store: SecretStore,
): Promise<string | null> {
  try {
    const held = await store.read()
    return held === null || held === '' ? null : held
  } catch {
    return null
  }
}
