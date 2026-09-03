/**
 * Which account, and which of that account's devices.
 *
 * The two travel together everywhere this pump names a device, so they
 * travel as one value rather than as two adjacent `string` parameters: a
 * caller that swaps them passes a well-typed pair of strings no compiler
 * would question, and a device key published under the wrong identity is
 * not a failure anything here would report.
 *
 * `sessionCredentials.ts`'s `RestoreCredentials` satisfies this structurally
 * and can be passed wherever it is asked for; it carries a base URL and an
 * access token besides, which nothing taking this needs to see.
 */
export interface DeviceIdentity {
  readonly userId: string
  readonly deviceId: string
}
