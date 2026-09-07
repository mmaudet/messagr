import type { SecretStore } from './sessionStore'

/**
 * Whether this device publishes read receipts.
 *
 * # Why the setting exists at all
 *
 * In Matrix a read receipt is public metadata: who read what, and when,
 * legible to the homeserver. #84 states the contradiction plainly — a product
 * that refuses to let a server read content and then publishes the hour
 * somebody read it contradicts itself. Removing them entirely would take away
 * a signal people expect and rely on, so the choice is offered.
 *
 * # THE DEFAULT WAS OFF, AND THE ACCOUNT HOLDER TURNED IT ON
 *
 * It read: "a default is a decision made for everybody who never opens
 * Settings, and the decision that costs them nothing is the quiet one." That
 * argument is unchanged and it is written here rather than deleted, because
 * whoever revisits this should meet it before deciding again.
 *
 * It was overruled on 7 September 2026, deliberately: a double tick that
 * cannot appear until both people find a switch is a signal nobody will ever
 * see, and the pair had just spent an afternoon discovering exactly that. The
 * decision is one constant, so reversing it is one line and the reasoning
 * above is still standing when somebody does.
 *
 * # Which way it fails, which did NOT change
 *
 * A store that cannot be read still answers **off**. An unset store is
 * "nobody has chosen yet" and takes the default; a store that threw is "this
 * device does not know", and the safe answer to not knowing is never to
 * publish. Being silently private is a degraded state somebody can fix; being
 * silently public is one they cannot undo.
 */

const ON = 'on'
const OFF = 'off'

/** What a device that has never been asked does. See the note above. */
export const RECEIPTS_DEFAULT = true

export async function receiptsArePublished(
  store: SecretStore,
): Promise<boolean> {
  try {
    const held = await store.read()
    if (held === ON) return true
    if (held === OFF) return false
    // NEVER WRITTEN TAKES THE DEFAULT. ANYTHING ELSE DOES NOT.
    //
    // `null` and the empty string are "nobody has chosen yet", which is the
    // case a default exists for. A value this build does not recognise is a
    // different thing entirely -- a store written by another version, or a
    // damaged one -- and answering "publish" to something unreadable is the
    // silently-public state the note above says nobody can undo.
    if (held === null || held === '') return RECEIPTS_DEFAULT
    return false
  } catch {
    return false
  }
}

/**
 * `false` when the choice could not be kept, so a screen can say the switch
 * will be back where it was at the next launch rather than showing a setting
 * that silently reverts.
 */
export async function publishReceipts(
  store: SecretStore,
  on: boolean,
): Promise<boolean> {
  try {
    // Written rather than deleted for "off", so that off is a value somebody
    // chose and not the absence of one. They read the same today; the day
    // anything wants to know whether the question was ever asked, they will
    // not.
    await store.write(on ? ON : 'off')
    return true
  } catch {
    return false
  }
}
