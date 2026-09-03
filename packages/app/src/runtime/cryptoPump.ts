// The one module in this ticket that imports react-native-matrix-crypto for
// real, rather than through an injected interface. Kept to pure glue for
// exactly that reason: importing this file at all pulls in the package's
// native JSI bootstrap as a side effect, which crashes under Vitest — so
// nothing worth unit-testing lives here. The sequencing this glue drives is
// `outgoingPumpCycle.ts`'s `runOutgoingPumpCycle`, tested there against
// injected fakes; everything below either delegates to something already
// tested elsewhere or is a single native call and its catch, the same shape
// `pump.ts`'s `makePumpHttp` and `toDeviceBridge.ts`'s `makeToDeviceSource`
// already leave untested.
import type { createClient } from 'matrix-js-sdk'
import {
  createCryptoMachine,
  encryptionSlice,
  getDeviceIdentityKeys,
  markRequestFailed,
  markRequestSent,
  receiveSyncChanges,
  takeOutgoingRequests,
} from 'react-native-matrix-crypto'

import { computeCryptoMachineConfig } from './cryptoMachineConfig'
import { getErrorMessage } from './errors'
import { makePumpHttp } from './pump'
import {
  runOutgoingPumpCycle,
  type CryptoPumpReport,
} from './outgoingPumpCycle'
import { makeToDeviceSource, subscribeToDeviceMessages } from './toDeviceBridge'

export type { CryptoPumpReport } from './outgoingPumpCycle'

export type MachineStartResult =
  | { readonly started: true; readonly unsubscribeToDevice: () => void }
  | { readonly started: false; readonly reason: string }

/**
 * Phase one: create the crypto machine and start feeding it to-device
 * messages, before anything triggers the session's one sync.
 *
 * Ordering matters and is not obvious from either half alone.
 * `sessionSync.ts`'s `fetchSessionSyncStatus` stops the client's sync loop
 * the moment the first sync lands, and to-device messages only ever arrive
 * through that loop — so a to-device bridge subscribed *after* that sync has
 * already run has nothing left to subscribe to. Called here, before
 * `fetchSessionSyncStatus`, the subscription is live for the one sync that
 * is about to happen, not after it.
 */
export async function startCryptoMachine(
  sessionClient: ReturnType<typeof createClient>,
  credentials: { readonly userId: string; readonly deviceId: string },
  storeDir: string,
  onToDeviceError: (cause: unknown) => void,
): Promise<MachineStartResult> {
  const config = computeCryptoMachineConfig(credentials, storeDir)
  if (config === null) {
    return {
      started: false,
      reason: 'no writable directory was supplied at launch',
    }
  }

  try {
    await createCryptoMachine(config)
  } catch (cause: unknown) {
    return { started: false, reason: getErrorMessage(cause) }
  }

  const unsubscribeToDevice = subscribeToDeviceMessages(
    makeToDeviceSource(sessionClient),
    { receiveSyncChanges },
    onToDeviceError,
  )

  return { started: true, unsubscribeToDevice }
}

/**
 * Phase two: binds `runOutgoingPumpCycle` (`outgoingPumpCycle.ts`) to the
 * real transport and the real crypto machine. Called after
 * `fetchSessionSyncStatus` has synced once and stopped the client's loop.
 */
export async function runOutgoingPump(
  sessionClient: ReturnType<typeof createClient>,
  userId: string,
  deviceId: string,
): Promise<CryptoPumpReport> {
  return runOutgoingPumpCycle(
    {
      http: makePumpHttp(sessionClient),
      machine: {
        takeOutgoingRequests,
        markRequestSent,
        markRequestFailed,
        receiveSyncChanges,
        getDeviceIdentityKeys,
      },
      encryptionSlice,
    },
    userId,
    deviceId,
  )
}
