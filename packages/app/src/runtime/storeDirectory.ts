import { getErrorMessage } from './errors'
import type { SecretStore } from './sessionStore'

/**
 * Where this installation keeps its stores, remembered so a wake can find it.
 *
 * # Why this exists at all
 *
 * The directory arrives as an **initial property from `MainActivity`** —
 * `filesDir.absolutePath`, handed to the root component at launch. A headless
 * JavaScript context has no activity and no root component, so it is handed
 * nothing, and #90's wake had no way to open anything.
 *
 * The honest fix is a native module exposing the path to any JavaScript
 * context. This is not that: it is the launch writing down what only a launch
 * is told, in the one durable per-device store that exists before anything
 * else does. It is recorded as a workaround rather than dressed up as a
 * design — `promiseSeen.ts` and `syncCursor.ts` lean on the same store for
 * the same reason, and say so too.
 *
 * # It is a path, not a secret, and it is still kept here
 *
 * There is nowhere else. The notebook needs this path to open, so the
 * notebook cannot hold it.
 *
 * # Which way it fails
 *
 * Absent. A wake that cannot learn the directory takes the blind path, which
 * is the same thing it does when the store will not open — and for a device
 * that has never been launched, absent is simply true.
 */

export async function rememberStoreDirectory(
  store: SecretStore,
  storeDir: string,
): Promise<boolean> {
  // Nothing to remember, and writing an empty value would make a later read
  // answer "" rather than "nothing was ever recorded". They are different:
  // the first is a directory this application would try to open.
  if (storeDir === '') return false
  try {
    await store.write(storeDir)
    return true
  } catch {
    return false
  }
}

export async function readStoreDirectory(
  store: SecretStore,
): Promise<
  { readonly dir: string } | { readonly dir: null; readonly reason: string }
> {
  try {
    const held = await store.read()
    return held === null || held === ''
      ? {
          dir: null,
          reason: 'this device has not recorded where its stores are',
        }
      : { dir: held }
  } catch (cause: unknown) {
    return { dir: null, reason: getErrorMessage(cause) }
  }
}
