// The native half of leaving an account, kept thin for the reason
// `deviceSecrets.ts` and `notebook.ts` are: every step here is a native module
// or a request, so nothing worth unit-testing lives in it. What it answers to
// is `leaveAccount.ts`'s `Departure`, which the tests drive with ordinary
// functions.
import { exists, unlink } from '@dr.pogodin/react-native-fs'
import { createClient } from 'matrix-js-sdk'
import { Platform } from 'react-native'

import { cryptoStorePath } from './cryptoMachineConfig'
import { stopWakingThisDevice } from './cryptoPump'
import {
  forgetAccountSecrets,
  forgetSecrets,
  pushkeySecrets,
  recoverySecrets,
} from './deviceSecrets'
import { readLastPushkey } from './lastPushkey'
import type { Departure } from './leaveAccount'
import { logEvent } from './log'
import { forgetNotebook } from './notebook'
import { isOurs } from './pickedLitter'
import type { SecretStore } from './sessionStore'

/**
 * What leaving an account does on this device, bound to the directory it
 * keeps its stores in. #304.
 *
 * # NOTHING HERE IS NEW ON THE WIRE
 *
 * The pusher is taken away by `stopWakingThisDevice`, the removal the
 * notifications switch already makes, and the session is ended by the SDK's
 * own `logout`. Both go through a client restored from the old account's
 * credentials, which carries them to that account's server and to no other.
 * No request is spelled in this file.
 *
 * # WHAT GOES, AND WHAT STAYS
 *
 * What goes is what belongs to the account being left and to no other: the
 * keystore entries `deviceSecrets.ts` declares as the account's, each with its
 * reason, except the ones the next account has already written; the notebook,
 * which holds its names, its reading and its conversation list; and its crypto
 * store. What stays is what belongs to the device: its language, its
 * switches, the promise it has shown and where it writes.
 *
 * Every step is attempted whatever the one before answered, and what failed
 * goes to the log. The person asked to leave, and leaving goes on.
 */
export function departureFrom(storeDir: string): Departure {
  return {
    pusher: async () => {
      const token = await readLastPushkey(pushkeySecrets)
      return token === null
        ? null
        : { token, road: Platform.OS === 'ios' ? 'ios' : 'android' }
    },
    stopWaking: (account, pusher) =>
      stopWakingThisDevice(createClient(account), pusher.token, pusher.road),
    logOut: async account => {
      await createClient(account).logout()
    },
    forgetPassword: async () => {
      const password = await forgetSecrets([recoverySecrets])
      if (password.refused > 0) {
        logEvent('warn', 'MESSAGR_PASSWORD_NOT_FORGOTTEN', {})
      }
    },
    forget: async (account, keeping) => {
      const forgotten = await forgetWhatTheAccountLeft(
        storeDir,
        account.deviceId,
        keeping,
      )
      logEvent(
        forgotten.secrets.refused === 0 &&
          forgotten.notebook &&
          forgotten.cryptoStore
          ? 'info'
          : 'warn',
        'MESSAGR_ACCOUNT_FORGOTTEN',
        { ...forgotten },
      )
    },
  }
}

/** What forgetting reached, for the log: counts and booleans, never a value. */
interface Forgotten {
  readonly secrets: { readonly forgotten: number; readonly refused: number }
  readonly notebook: boolean
  readonly cryptoStore: boolean
}

/**
 * The keystore first, then the notebook, whose connections close before its
 * file goes, then the crypto store.
 */
async function forgetWhatTheAccountLeft(
  storeDir: string,
  deviceId: string,
  keeping: readonly SecretStore[],
): Promise<Forgotten> {
  const secrets = await forgetAccountSecrets(keeping)
  const notebook = await forgetNotebook(storeDir)
  const cryptoStore = await forgetCryptoStore(storeDir, deviceId)
  return { secrets, notebook, cryptoStore }
}

/**
 * `true` when the store is gone, including when it was already: a reinstalled
 * iPhone has no store left to erase, and that is the state being asked for.
 *
 * NO UNLINK OUTSIDE THIS APPLICATION'S DIRECTORY. ADR-0006, with
 * `pickedLitter.ts`'s guard as the precedent: `cryptoStorePath` refuses a
 * device id that would climb out of `crypto/`, and the path is checked again
 * against the directory here, because this is the line that deletes.
 */
async function forgetCryptoStore(
  storeDir: string,
  deviceId: string,
): Promise<boolean> {
  const path = cryptoStorePath(storeDir, deviceId)
  if (path === null || !isOurs(path, [storeDir])) return false
  try {
    if (await exists(path)) await unlink(path)
    return true
  } catch {
    return false
  }
}
