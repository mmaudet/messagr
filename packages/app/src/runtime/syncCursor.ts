import type { SecretStore } from './sessionStore'

/**
 * Where the loop resumes from, between launches.
 *
 * ADR-0007 names getting this wrong as quiet in both directions: a cursor
 * that is lost replays everything, and a cursor that advances past
 * unprocessed events loses them. Neither crashes, so the asymmetry has to be
 * built in rather than noticed. Everything here is written so that the
 * recoverable failure is the one that happens:
 *
 * - a cursor that cannot be read is `null`, which is a full sync — slow, and
 *   correct;
 * - a cursor that cannot be written is reported and the loop carries on from
 *   the token it holds in memory, so this launch stays live and only the
 *   next one replays;
 * - a cursor is never written before the events it covers have been handled.
 *   That last one is the caller's ordering, not this module's, and it is
 *   `syncLoop.ts` that keeps it.
 *
 * WHY THE KEYSTORE. A sync cursor is not a secret — it is an opaque
 * server-side position, useless without the access token that sits beside
 * it. It lives here because `SecretStore` is the only durable per-device
 * store this application has: there is no AsyncStorage, no filesystem
 * module, and adding one for a single string would be a dependency bought
 * with the wrong currency. Its own keystore entry rather than a field beside
 * the session, so that a cursor written every thirty seconds cannot corrupt
 * the credential whose loss is the loss of the account.
 *
 * When the application gains a store of its own -- the first thing to need
 * one will be the name a person chooses for themselves, which is neither a
 * secret nor something a keystore should be holding either -- the cursor
 * belongs there, and moving it is one line in `deviceSecrets.ts`.
 */

/**
 * `null` for every reason a cursor might not come back: nothing stored yet,
 * a store that refused, or a device whose keystore is locked. The answer is
 * the same in all three — sync from the beginning — and it is always safe,
 * which is the whole reason this reads rather than throws.
 */
export async function readSyncCursor(
  store: SecretStore,
): Promise<string | null> {
  try {
    const held = await store.read()
    return held !== null && held.length > 0 ? held : null
  } catch {
    return null
  }
}

/**
 * `false` when the cursor could not be persisted, so the caller can say so
 * rather than a launch silently replaying its whole history next time.
 *
 * Not a throw: a keystore that refused one write is not a reason to stop
 * receiving messages, and a loop that died on it would trade a slow next
 * launch for no messages at all on this one.
 */
export async function writeSyncCursor(
  store: SecretStore,
  cursor: string,
): Promise<boolean> {
  try {
    await store.write(cursor)
    return true
  } catch {
    return false
  }
}
