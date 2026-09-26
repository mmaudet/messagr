// The native half of deleting an account, kept thin for the reason
// `leavingThisDevice.ts` gives: every step here is a native module or a
// request, so nothing worth unit-testing lives in it. What it answers to is
// `deleteAccount.ts`'s `Ending`, which the tests drive with ordinary functions.

import { createClient } from 'matrix-js-sdk'

import { deleteBackupOnAccount, findBackupOnAccount } from './cryptoPump'
import type { Ending } from './deleteAccount'
import { deletionMarkSecrets, recoverySecrets } from './deviceSecrets'
import { readRecoverySecret } from './recoverySecret'
import { announceDeletion } from './servicePoster'
import { thisDevicesPusher } from './thisDevicesPusher'

/**
 * What deleting an account does on the wire and on this device. #382, #383.
 *
 * # NOTHING NEW ON THE WIRE
 *
 * First the invitation service, told with the account's own token (#385),
 * the way `servicePoster.ts` reaches it for everything else. Then what only
 * the token can take away (#383): the pusher, as leaving an
 * account and the notifications switch already take it (`thisDevicesPusher.ts`);
 * then the key backup, read by `findBackupOnAccount` and deleted by
 * `retireVersion`, as a replaced restore key already deletes one.
 *
 * Then `POST /account/deactivate` with `m.login.password`, as the service
 * deactivates an account it revokes. Measured on messagr.eu on 5 August 2026,
 * where the token alone does not deactivate, and again on 26 September 2026:
 * the server then refuses the account's token (`M_UNKNOWN_TOKEN`) and its
 * password (`M_USER_DEACTIVATED`), and takes it out of its conversations.
 * That it also withdraws its devices was measured later, on the bench, by
 * the end-to-end suite's `witness-deletion` (#389): the account measured in
 * production had published none.
 *
 * Every request goes to the account's own server and to no other: through a
 * client restored from its credentials, or, for the invitation service, with
 * its token on the same host.
 *
 * # NOT `erase`
 *
 * Nothing measured what the homeserver would do with it, and the privacy
 * policy says what stays: the events an account produced remain events of
 * the rooms they were written in.
 */
export function endingOnThisDevice(): Ending {
  return {
    ...thisDevicesPusher,
    password: () => readRecoverySecret(recoverySecrets),
    announce: account => announceDeletion(account.baseUrl, account.accessToken),
    backupVersion: async account =>
      (await findBackupOnAccount(createClient(account)))?.version ?? null,
    deleteBackup: (account, version) =>
      deleteBackupOnAccount(createClient(account), version),
    deactivate: async (account, password) => {
      await createClient(account).deactivateAccount({
        type: 'm.login.password',
        identifier: { type: 'm.id.user', user: account.userId },
        password,
      })
    },
    // WHETHER THE SERVER STILL KNOWS THIS SESSION, asked after a deactivation
    // that looked failed. Measured on 26 September 2026: once an account is
    // deactivated, `whoami` answers `401 M_UNKNOWN_TOKEN`.
    stillKnown: async account => {
      try {
        await createClient(account).whoami()
        return true
      } catch (error) {
        return errcodeOf(error) === 'M_UNKNOWN_TOKEN' ? false : null
      }
    },
    markDeleted: account => deletionMarkSecrets.write(account.userId),
  }
}

/** The Matrix error code a failed request carried, if it carried one. */
function errcodeOf(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null
  const code = (error as { readonly errcode?: unknown }).errcode
  return typeof code === 'string' ? code : null
}
