/**
 * The restored-session credentials matrix-js-sdk needs to skip `/login`
 * entirely: `createClient({ baseUrl, userId, deviceId, accessToken })` treats
 * the client as already authenticated, which is what "restore a session, not
 * an interactive login" means in code.
 *
 * Where they come from is `entry.ts`: a session kept in the device's keystore
 * from a previous launch, or one obtained by spending an invitation. Nothing
 * arrives from the build any more.
 *
 * Until an invitation could be claimed on the device, these four values were
 * read from the bundler's environment and baked into the bundle. That was the
 * largest scaffold in the product and the reason nobody but its author could
 * run it: there was no screen to type a session into and no way for a real
 * person to obtain one.
 */
export interface RestoreCredentials {
  readonly baseUrl: string
  readonly userId: string
  readonly deviceId: string
  readonly accessToken: string
}
