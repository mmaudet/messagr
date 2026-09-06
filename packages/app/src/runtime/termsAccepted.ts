import type { SecretStore } from './sessionStore'

/**
 * That somebody accepted the conditions, and which ones.
 *
 * # Why the version is stored and not just a flag
 *
 * A flag answers "did they tick the box", which is the question today. The
 * question that arrives later is "did they accept *these* conditions", and a
 * flag cannot answer it: the terms are a published document that will be
 * revised, and a revision that nobody was asked about is a revision nobody
 * agreed to. Storing what was accepted makes re-asking a comparison rather
 * than a migration.
 *
 * The value is the date the published conditions carry, which is what
 * identifies them — not a number this application invents and would have to
 * keep in step with a page it does not own.
 *
 * # Which way it fails
 *
 * A store that cannot be read answers **not accepted**, so the screen is
 * shown again. That is the same direction `promiseSeen.ts` takes and for a
 * stronger reason: the cost of asking twice is a tap, and the cost of
 * recording an acceptance that never happened is a claim about a person that
 * is not true.
 */

/**
 * The conditions currently in force, by the date they carry.
 *
 * Changing this re-asks everybody, which is the point. It is a constant here
 * rather than fetched, because a screen that had to reach the network before
 * it could ask would be a first launch that needs a connection.
 */
export const TERMS_IN_FORCE = '2026-08-08'

export async function termsWereAccepted(store: SecretStore): Promise<boolean> {
  try {
    return (await store.read()) === TERMS_IN_FORCE
  } catch {
    return false
  }
}

/**
 * `false` when it could not be kept. The caller lets somebody through
 * regardless — refusing to start an application because a keystore would not
 * record a tick punishes the person for the device's fault — and the screen
 * comes back next launch, which is the honest consequence.
 */
export async function rememberTermsAccepted(
  store: SecretStore,
): Promise<boolean> {
  try {
    await store.write(TERMS_IN_FORCE)
    return true
  } catch {
    return false
  }
}
