// The native half of a device that lost access to its account, kept thin for
// the reason `leavingThisDevice.ts` gives: every step here is a keystore
// entry or a request, and what decides is `lostAccess.ts`, which the tests
// drive with ordinary functions.
import {
  deletionMarkSecrets,
  newDeviceSecrets,
  recoverySecrets,
  sessionSecrets,
} from './deviceSecrets'
import { homeserverCalls } from './homeserverCalls'
import type { Regaining } from './lostAccess'
import { readRecoverySecret } from './recoverySecret'
import { reenterWithPassword, retireDevice } from './reenter'
import { saveSession } from './sessionStore'

/**
 * What coming back or forgetting does on this device. #391.
 *
 * NOTHING NEW ON THE WIRE. Coming back is the reinstall's own login and
 * retirement (`reenter.ts`), through `homeserverCalls`, to the account's own
 * server and no other. Forgetting writes the mark a deletion writes (#382),
 * which the next cold launch reads.
 *
 * THE MARK BEFORE THE SESSION. Written the other way round, a session kept
 * and a mark lost would have the next launch take the new device for a
 * reinstall and log in again. This way, a mark kept and a session lost names
 * a device that is not the one the launch holds, and is ignored.
 */
export function regainingOnThisDevice(): Regaining {
  return {
    password: () => readRecoverySecret(recoverySecrets),
    logIn: (account, password) =>
      reenterWithPassword(homeserverCalls(account.baseUrl), {
        baseUrl: account.baseUrl,
        userId: account.userId,
        password,
      }),
    keepNewDevice: async session => {
      await newDeviceSecrets.write(session.deviceId)
      await saveSession(sessionSecrets, session)
    },
    retire: (old, session, password) =>
      retireDevice(homeserverCalls(old.baseUrl), {
        deviceId: old.deviceId,
        userId: old.userId,
        password,
        accessToken: session.accessToken,
      }),
    markForgotten: account => deletionMarkSecrets.write(account.userId),
  }
}
