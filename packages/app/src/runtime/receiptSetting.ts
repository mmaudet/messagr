import type { SecretStore } from './sessionStore'

/**
 * Whether this device publishes read receipts. Off unless somebody turns it
 * on.
 *
 * # Why it is off, and why it exists at all
 *
 * In Matrix a read receipt is public metadata: who read what, and when,
 * legible to the homeserver. #84 states the contradiction plainly — a product
 * that refuses to let a server read content and then publishes the hour
 * somebody read it contradicts itself.
 *
 * Removing them entirely would take away a signal people expect and rely on,
 * so the setting exists. It is off by default because a default is a decision
 * made for everybody who never opens Settings, and the decision that costs
 * them nothing is the quiet one.
 *
 * # Which way it fails
 *
 * A store that cannot be read answers **off**. That is the only safe
 * direction: the failure of a keystore must never be the reason a device
 * starts publishing when its owner has not asked it to. Being silently
 * private is a degraded state somebody can fix; being silently public is one
 * they cannot undo.
 */

const ON = 'on'

export async function receiptsArePublished(
  store: SecretStore,
): Promise<boolean> {
  try {
    return (await store.read()) === ON
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
