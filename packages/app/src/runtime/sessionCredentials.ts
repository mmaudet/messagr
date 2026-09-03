/**
 * The restored-session credentials matrix-js-sdk needs to skip `/login`
 * entirely: `createClient({ baseUrl, userId, deviceId, accessToken })` treats
 * the client as already authenticated, which is what "restore a session, not
 * an interactive login" means in code.
 *
 * There is no product screen yet to type a session into, so for this
 * milestone the four values come from the environment the bundler runs in,
 * baked into the bundle by `transform-inline-environment-variables`
 * (babel.config.js). Continuous integration provisions an account
 * (scripts/provision-bench-accounts.sh) and exports its credentials before
 * building; nothing here is ever committed.
 */
export interface RestoreCredentials {
  readonly baseUrl: string
  readonly userId: string
  readonly deviceId: string
  readonly accessToken: string
}

export interface SessionEnv {
  readonly homeserver?: string
  readonly userId?: string
  readonly deviceId?: string
  readonly accessToken?: string
}

// Each value is its own static `process.env.MESSAGR_SESSION_*` access rather
// than a loop over a list of names. The inline-environment-variables Babel
// plugin only replaces expressions shaped exactly like this at bundle time;
// looked up dynamically this would still read correctly under Node (as it
// does in this file's own tests, and in Metro's own Node process while
// bundling), but would silently carry nothing once bundled for a device.
function getProcessEnv(): SessionEnv {
  return {
    homeserver: process.env.MESSAGR_SESSION_HOMESERVER,
    userId: process.env.MESSAGR_SESSION_USER_ID,
    deviceId: process.env.MESSAGR_SESSION_DEVICE_ID,
    accessToken: process.env.MESSAGR_SESSION_ACCESS_TOKEN,
  }
}

export function computeSessionCredentials(
  env: SessionEnv = getProcessEnv(),
): RestoreCredentials | null {
  const { homeserver, userId, deviceId, accessToken } = env
  if (!homeserver || !userId || !deviceId || !accessToken) {
    return null
  }
  return { baseUrl: homeserver, userId, deviceId, accessToken }
}
