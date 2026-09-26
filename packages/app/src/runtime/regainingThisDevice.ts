// The native half of a device that lost access to its account, kept thin for
// the reason `leavingThisDevice.ts` gives: every step here is a keystore
// entry or a request, and what decides is `lostAccess.ts`, which the tests
// drive with ordinary functions.
import { aCryptoMachineIsRunning } from './cryptoPump'
import {
  deletionMarkSecrets,
  forgetSecrets,
  newDeviceSecrets,
  recoverySecrets,
  sessionSecrets,
} from './deviceSecrets'
import { homeserverCalls } from './homeserverCalls'
import { forgetCryptoStore } from './leavingThisDevice'
import { logEvent } from './log'
import { newDeviceMark, type CameBack, type Regaining } from './lostAccess'
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
 * a device that is not the one the launch holds, and the launch clears it.
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
    keepNewDevice: async (session, old) => {
      await newDeviceSecrets.write(newDeviceMark(session, old))
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

/**
 * What the launch after « Revenir sur ce compte » reads and erases on this
 * device. #391. Neither failure stops a launch, and each is said in the log:
 * a mark that will not clear, and an old store that will not go.
 */
export function cameBackOnThisDevice(storeDir: string): CameBack {
  return {
    mark: () => newDeviceSecrets.read(),
    clearMark: async () => {
      const { refused } = await forgetSecrets([newDeviceSecrets])
      if (refused > 0) logEvent('warn', 'MESSAGR_CAME_BACK_MARK_KEPT', {})
    },
    eraseStore: async deviceId => {
      if (!(await forgetCryptoStore(storeDir, deviceId))) {
        logEvent('warn', 'MESSAGR_OLD_STORE_KEPT', {})
      }
    },
    aMachineIsRunning: aCryptoMachineIsRunning,
  }
}
