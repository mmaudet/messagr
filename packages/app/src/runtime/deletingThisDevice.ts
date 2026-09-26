// The native half of deleting an account, kept thin for the reason
// `leavingThisDevice.ts` gives: every step here is a native module or a
// request, so nothing worth unit-testing lives in it. What it answers to is
// `deleteAccount.ts`'s `Ending`, which the tests drive with ordinary functions.

import { createClient } from 'matrix-js-sdk'

import type { Ending } from './deleteAccount'
import { deletedSecrets, recoverySecrets } from './deviceSecrets'
import { readRecoverySecret } from './recoverySecret'

/**
 * What deleting an account does on the wire and on this device. #382.
 *
 * # ONE REQUEST, THE ONE THE INVITATION SERVICE ALREADY MAKES
 *
 * `POST /account/deactivate` with `m.login.password`, as the service
 * deactivates an account it revokes. Measured on messagr.eu on 5 August 2026,
 * where the token alone does not deactivate, and again on 26 September 2026:
 * the server then refuses the account's token (`M_UNKNOWN_TOKEN`) and its
 * password (`M_USER_DEACTIVATED`), removes its devices, and takes it out of
 * its conversations. The request goes through a client restored from the
 * account's credentials, which carries them to its own server and to no other.
 *
 * # NOT `erase`
 *
 * Nothing measured what the homeserver would do with it, and the privacy
 * policy says what stays: the events an account produced remain events of
 * the rooms they were written in.
 */
export function endingFrom(): Ending {
  return {
    password: () => readRecoverySecret(recoverySecrets),
    deactivate: async (account, password) => {
      await createClient(account).deactivateAccount({
        type: 'm.login.password',
        identifier: { type: 'm.id.user', user: account.userId },
        password,
      })
    },
    markDeleted: account => deletedSecrets.write(account.userId),
  }
}
