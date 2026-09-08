import type { SecretStore } from './sessionStore'

/**
 * The pushkey this device last registered a pusher under.
 *
 * # WHY A DEVICE HAS TO WRITE THIS DOWN
 *
 * A Matrix pusher is keyed by its token, and nothing in it says which device
 * it belongs to. So when a device's token changes -- a reinstall, a restore,
 * a build whose entitlement moved from `development` to `production` -- the
 * old pusher stays on the account, and the homeserver keeps pushing to a
 * token nobody holds. Every message costs a failed push, for ever, and the
 * gateway's log fills with rejections from devices that no longer exist.
 *
 * There is no safe way to prune by anything else. Two of somebody's devices
 * share an `app_id` and differ only by pushkey, so removing "the other
 * pushkeys for this application" would take away the other telephone's
 * notifications. `profile_tag` looks like the field for it and is not: the
 * specification makes a pusher with a profile tag receive only the pushes
 * whose rules carry that tag, so borrowing it would quietly stop the pushes
 * it was meant to label.
 *
 * The one thing that can honestly say "that pusher was mine" is the device
 * that registered it, having written the key down.
 *
 * # IT IS NOT A SECRET, AND IT LIVES WITH THE SECRETS ANYWAY
 *
 * The pushkey is on the homeserver already and the gateway logs it. It is
 * here because `SecretStore` is the only durable per-device store this
 * application has -- the same reason `syncCursor.ts` gives for the cursor.
 */

/** `null` when this device has never registered one, or could not read it. */
export async function readLastPushkey(
  store: SecretStore,
): Promise<string | null> {
  try {
    const held = await store.read()
    return held === null || held === '' ? null : held
  } catch {
    // A store that will not open is a device that cannot say what it
    // registered before. Answering `null` skips the removal, which leaves a
    // ghost -- noise -- rather than removing a pusher that might be another
    // device's, which would be silence.
    return null
  }
}

/**
 * `false` when it could not be kept, which is survivable: the pusher is
 * registered either way, and the next launch that manages to write it down
 * takes over the pruning.
 */
export async function keepLastPushkey(
  store: SecretStore,
  token: string,
): Promise<boolean> {
  try {
    await store.write(token)
    return true
  } catch {
    return false
  }
}
