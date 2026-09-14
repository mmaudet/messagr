// The one module that erases what this device keeps of an account, kept thin
// for the reason `deviceSecrets.ts` and `notebook.ts` are: every step is a
// native module, so nothing worth unit-testing lives here. What it answers to
// is `leaveAccount.ts`'s `forget`, which the tests drive with an ordinary
// function.
import { exists, unlink } from '@dr.pogodin/react-native-fs'

import { releaseMachineFor } from './cryptoPump'
import { forgetAccountSecrets } from './deviceSecrets'
import { forgetNotebook } from './notebook'

/** What forgetting reached, for the log: counts and booleans, never a value. */
export interface Forgotten {
  readonly secrets: { readonly forgotten: number; readonly refused: number }
  readonly notebook: boolean
  readonly cryptoStore: boolean
}

/**
 * Forgets the account this device holds. #304.
 *
 * # WHAT GOES, AND WHAT STAYS
 *
 * What goes is what belongs to that account and to no other: the keystore
 * entries `deviceSecrets.ts` declares as the account's, each with its reason;
 * the notebook, which holds its names, its reading and its conversation list;
 * and the crypto store at `<storeDir>/crypto/<deviceId>`, which is
 * `cryptoMachineConfig.ts`'s path spelled once more, for the reason
 * `homeserverCalls.ts` gives about its own spelling of it. What stays is what
 * belongs to the device: its language, its switches, the promise it has shown
 * and where it writes.
 *
 * # IN THIS ORDER
 *
 * The keystore first, and the session first within it, so a device
 * interrupted halfway holds no account to return to. Then the notebook, whose
 * connections close before its file goes. Then the crypto store, and last the
 * guard that kept a second machine out of this context, since the store it
 * protected no longer exists.
 *
 * Every step is attempted whatever the one before answered. The person asked
 * to leave; a step that failed is reported, and leaving goes on.
 */
export async function forgetWhatThisDeviceKeeps(
  storeDir: string,
  deviceId: string,
): Promise<Forgotten> {
  const secrets = await forgetAccountSecrets()
  const notebook = await forgetNotebook(storeDir)
  const cryptoStore = await forgetCryptoStore(storeDir, deviceId)
  releaseMachineFor(deviceId)
  return { secrets, notebook, cryptoStore }
}

/**
 * `true` when the store is gone, including when it was already: a reinstalled
 * iPhone has no store left to erase, and that is the state being asked for.
 */
async function forgetCryptoStore(
  storeDir: string,
  deviceId: string,
): Promise<boolean> {
  if (storeDir === '' || deviceId === '') return false
  const path = `${storeDir}/crypto/${deviceId}`
  try {
    if (await exists(path)) await unlink(path)
    return true
  } catch {
    return false
  }
}
