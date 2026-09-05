import type { SecretStore } from './sessionStore'

/**
 * Whether this device has already been shown the promise.
 *
 * One flag, and the only state the first-launch screen has. It is kept in the
 * keystore for the reason `syncCursor.ts` gives at more length: `SecretStore`
 * is the only durable per-device store this application has today. It is not
 * a secret, and it moves to the application's own store the day ADR-0010's
 * lands.
 *
 * WHICH WAY IT FAILS. A store that cannot be read answers `false`, so the
 * promise is shown again. The opposite default would skip it for somebody
 * seeing the application for the first time, and a first launch that silently
 * behaves like a second is the one failure this screen cannot recover from —
 * it exists precisely to be the first thing anybody sees. Being shown twice
 * costs a tap.
 */

/** The value stored. Any non-empty value means seen; this one says when. */
const SEEN = 'seen'

export async function hasSeenPromise(store: SecretStore): Promise<boolean> {
  try {
    const held = await store.read()
    return held !== null && held !== ''
  } catch {
    return false
  }
}

/**
 * `false` when the flag could not be kept, so a caller can say that the
 * promise will be shown again rather than a device quietly repeating it with
 * nobody able to explain why.
 *
 * Not a throw: failing to remember that somebody read a screen is not a
 * reason to stop them getting past it.
 */
export async function rememberPromiseSeen(
  store: SecretStore,
): Promise<boolean> {
  try {
    await store.write(SEEN)
    return true
  } catch {
    return false
  }
}
