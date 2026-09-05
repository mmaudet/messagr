import type { SecretStore } from './sessionStore'

/**
 * Whether this account is still in sign-up.
 *
 * # Why this exists at all
 *
 * `createCrossSigningIdentity` is the one destructive call on the crypto
 * library's surface, and the library refuses to decide when it is safe. #46
 * supplied the entitlement for the ordinary case: a launch that claimed an
 * invitation created the account seconds ago, so nothing can be overwritten.
 *
 * That left one state stranded. A launch that creates an identity and then
 * loses the publication -- killed, offline, timed out -- leaves an identity on
 * disk that no homeserver has acknowledged. The library's remedy is the same
 * create call again, and its next sentence is why #46 would not make it
 * automatic: *"which is why finishing is a decision"*. The incident it reports
 * measuring is a device in exactly that state, told honestly that the account
 * has no identity, publishing over one a second device had legitimately
 * created in the gap. The launch-time call did it.
 *
 * So finishing needs a fact that outlives the launch which started it. This
 * is that fact, and nothing else in this application may grant the same
 * entitlement.
 *
 * # Every uncertainty resolves towards "no"
 *
 * A keystore that cannot be read, a value written by something else, an
 * absent entry: all of them mean not entitled. Reading any of them as
 * permission would hand the destructive call to every launch on a device
 * whose keystore is merely locked, which is the failure this whole mechanism
 * exists to prevent.
 */
const STARTED = 'signing-up'
const FINISHED = 'done'

/**
 * Recorded when an invitation is claimed, which is the moment a sign-up
 * begins. Returns whether it was actually kept: a sign-up that started and
 * was not recorded is one no later launch can finish.
 */
export async function markSignUpStarted(
  secrets: SecretStore,
): Promise<boolean> {
  try {
    await secrets.write(STARTED)
    return true
  } catch {
    return false
  }
}

/**
 * Cleared once a homeserver has acknowledged the identity, and never before.
 *
 * Reports a failure because this one is worse than it looks: a marker that
 * will not clear leaves every later launch entitled to the destructive call,
 * indefinitely.
 */
export async function clearSignUp(secrets: SecretStore): Promise<boolean> {
  try {
    await secrets.write(FINISHED)
    return true
  } catch {
    return false
  }
}

export async function isSignUpUnfinished(
  secrets: SecretStore,
): Promise<boolean> {
  try {
    return (await secrets.read()) === STARTED
  } catch {
    // Not entitled. A keystore can refuse for reasons that have nothing to do
    // with this account -- a locked device, an entry invalidated by a
    // credential change -- and none of them is a reason to overwrite an
    // identity.
    return false
  }
}
