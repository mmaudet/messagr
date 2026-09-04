// Type-only: no react-native-matrix-crypto import reaches this module's
// runtime behaviour, only the shapes `runOutgoingPump` (cryptoPump.ts) binds
// to its real functions. Importing the package as a *value* installs its
// native JSI bootstrap as a side effect and crashes Vitest's parser —
// confirmed empirically, the same constraint `pump.ts` and `syncDelta.ts`
// are already written around. Keeping that value import out of this file
// entirely, rather than just out of its exported functions, is what lets
// this module's own spec file import it at all.
import type {
  IdentityKeys,
  IdentityStatus,
  SyncDelta,
} from 'react-native-matrix-crypto'

import type { DeviceIdentity } from './deviceIdentity'
import {
  drainOutgoingRequests,
  type CryptoMachine,
  type DrainResult,
  type HttpRequester,
} from './pump'
import { fetchEncryptionSyncDelta, type EncryptionSliceFn } from './syncDelta'
import { computeSharingStrategy, type SharingStrategy } from './sharingStrategy'
import { verifyDeviceKeysPublished } from './verifyPublishedKeys'

/** What this cycle needs from the crypto machine, beyond `pump.ts`'s own `CryptoMachine`. */
export interface CryptoMachineOps extends CryptoMachine {
  readonly receiveSyncChanges: (delta: SyncDelta) => Promise<void>
  readonly getDeviceIdentityKeys: (
    userId: string,
    deviceId: string,
  ) => Promise<IdentityKeys>
  /** Read to establish which key-sharing strategy is in force. */
  readonly getIdentityStatus: () => Promise<IdentityStatus>
}

export interface OutgoingPumpDeps {
  readonly http: HttpRequester
  readonly machine: CryptoMachineOps
  readonly encryptionSlice: EncryptionSliceFn
}

export interface CryptoPumpReport {
  readonly identityKeys: IdentityKeys
  readonly firstDrain: DrainResult
  readonly secondDrain: DrainResult
  readonly deviceKeysVerified: boolean
  readonly oneTimeKeysPublished: boolean
  /**
   * Which strategy the machine uses to choose who receives a room key,
   * observed rather than assumed. 0.4.0 changes this on its own for a
   * machine holding a cross-signing identity, and this application holds
   * none — but a changelog is not evidence, so the machine is asked.
   */
  readonly sharingStrategy: SharingStrategy
}

/**
 * Publishes this device's keys, recovers the sync-response fields
 * matrix-js-sdk drops with no crypto configured, and verifies what
 * publishing actually did. Runs after the session has synced once and its
 * client has already stopped polling (`sessionSync.ts`'s
 * `fetchSessionSyncStatus`, called by `cryptoPump.ts`'s `startCryptoMachine`
 * before this): everything here is a raw, one-off authenticated request,
 * which needs no live sync loop to work.
 *
 * The first drain publishes this device's identity and one-time keys — a
 * fresh crypto machine queues a `keys_upload` unconditionally. The raw sync
 * fetch recovers `device_lists` and one-time-key counts, ADR-0001's second
 * named exposure, and feeding it to the machine can itself queue more
 * outgoing work, which the second drain sends before anything reads the
 * result. `oneTimeKeysPublished` reads whether a `keys_upload` reached
 * either drain's `sentKinds`: `markRequestSent`'s own validation already
 * rejects a response that does not carry `one_time_key_counts`, so a
 * `keys_upload` appearing there already proves the server accepted them,
 * with no response body to re-parse here.
 */
export async function runOutgoingPumpCycle(
  deps: OutgoingPumpDeps,
  identity: DeviceIdentity,
): Promise<CryptoPumpReport> {
  const { http, machine, encryptionSlice } = deps

  const firstDrain = await drainOutgoingRequests(http, machine)

  const delta = await fetchEncryptionSyncDelta(http, encryptionSlice)
  await machine.receiveSyncChanges(delta)

  const secondDrain = await drainOutgoingRequests(http, machine)

  const identityKeys = await machine.getDeviceIdentityKeys(
    identity.userId,
    identity.deviceId,
  )
  const sharingStrategy = computeSharingStrategy(
    await machine.getIdentityStatus(),
  )
  const deviceKeysVerified = await verifyDeviceKeysPublished(http, identity)

  return {
    identityKeys,
    firstDrain,
    secondDrain,
    deviceKeysVerified,
    sharingStrategy,
    oneTimeKeysPublished:
      firstDrain.sentKinds.includes('keys_upload') ||
      secondDrain.sentKinds.includes('keys_upload'),
  }
}
