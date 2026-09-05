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
  asCryptoScopeId,
  bootstrapCrossSigning,
  createCryptoMachine,
  createCrossSigningIdentity,
  decryptEvent,
  encryptEvent,
  encryptionSlice,
  buildHistoryBundle,
  getDeviceIdentityKeys,
  getIdentityStatus,
  markRequestFailed,
  markRequestSent,
  offeredHistoryBundle,
  receiveHistoryBundle,
  receiveSyncChanges,
  shareHistoryBundle,
  shareScopeKey,
  takeOutgoingRequests,
} from 'react-native-matrix-crypto'

import type { IdentityEntitlement } from './crossSigningIdentity'
import { computeCryptoMachineConfig } from './cryptoMachineConfig'
import { cryptoStoreSecrets } from './deviceSecrets'
import { openStorePassphrase } from './storePassphrase'
import type { DeviceIdentity } from './deviceIdentity'
import { encryptAndSendOneMessage, type SendReport } from './encryptAndSend'
import { getErrorMessage } from './errors'
import { logEvent } from './log'
import { fetchJoinedRooms } from './encryptedSend'
import { probeUnsettledEncrypt, type ProbeReport } from './panicProbe'
import { claimHistory, type HistoryClaim } from './claimHistory'
import { mediaRepository } from './mediaRepository'
import { makePumpHttp } from './pump'
import { vouchFor, type VouchOutcome } from './vouch'
import { receiveAndDecrypt, type ReceiveReport } from './receiveDecrypt'
import {
  runOutgoingPumpCycle,
  type CryptoPumpReport,
} from './outgoingPumpCycle'
import { fetchRoomMessages, toTimelineEntries } from '../timeline/buildTimeline'
import type { TimelineEntry } from '../timeline/mergeTimeline'
import { makeToDeviceSource, subscribeToDeviceMessages } from './toDeviceBridge'

export type { CryptoPumpReport } from './outgoingPumpCycle'
export type { SendReport } from './encryptAndSend'
export type { ReceiveReport } from './receiveDecrypt'
export type { ProbeReport } from './panicProbe'

export type MachineStartResult =
  | {
      readonly started: true
      readonly unsubscribeToDevice: () => void
      /**
       * Whether this launch minted the store's passphrase or reopened with
       * the one it already held. Never the passphrase itself.
       *
       * Reported because it is the difference between a store this device
       * can still read and a new, empty one: a relaunch that mints is a
       * relaunch that lost every room key it had.
       */
      readonly passphraseMinted: boolean
    }
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
  credentials: DeviceIdentity,
  storeDir: string,
  onToDeviceError: (cause: unknown) => void,
): Promise<MachineStartResult> {
  // Before the config, because there is no useful config without it. A
  // store opened with the wrong passphrase is not a degraded store, it is a
  // different one -- and the first launch to open a second store loses every
  // room key the first one held.
  const passphrase = await openStorePassphrase(cryptoStoreSecrets, byteLength =>
    crypto.getRandomValues(new Uint8Array(byteLength)),
  )
  if (!passphrase.held) {
    return { started: false, reason: passphrase.reason }
  }

  const config = computeCryptoMachineConfig(
    credentials,
    storeDir,
    passphrase.passphrase,
  )
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

  return {
    started: true,
    unsubscribeToDevice,
    passphraseMinted: passphrase.minted,
  }
}

/**
 * Phase two: binds `runOutgoingPumpCycle` (`outgoingPumpCycle.ts`) to the
 * real transport and the real crypto machine. Called after
 * `fetchSessionSyncStatus` has synced once and stopped the client's loop.
 */
export async function runOutgoingPump(
  sessionClient: ReturnType<typeof createClient>,
  identity: DeviceIdentity,
  entitlement: IdentityEntitlement,
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
        getIdentityStatus,
        bootstrapCrossSigning,
        createCrossSigningIdentity,
      },
      encryptionSlice,
    },
    identity,
    entitlement,
  )
}

/**
 * Phase three: encrypts one message and puts it in a room, binding
 * `encryptAndSendOneMessage` (`encryptAndSend.ts`) to the real transport and
 * the real crypto machine.
 *
 * The scope arguments are wrapped rather than passed through: the library
 * brands its scope ids so a room id cannot be handed to it by accident, and
 * this boundary is where a plain string becomes one.
 */
export async function sendOneEncryptedMessage(
  sessionClient: ReturnType<typeof createClient>,
  identity: DeviceIdentity,
  /** What a person typed, when a person typed it. */
  body?: string,
): Promise<SendReport> {
  return encryptAndSendOneMessage(
    {
      http: makePumpHttp(sessionClient),
      machine: {
        takeOutgoingRequests,
        markRequestSent,
        markRequestFailed,
        shareScopeKey: (scope, userIds) =>
          shareScopeKey(asCryptoScopeId(scope), [...userIds]),
        encryptEvent: (scope, eventType, payload) =>
          encryptEvent(asCryptoScopeId(scope), eventType, payload),
        decryptEvent: (scope, rawEvent) =>
          decryptEvent(asCryptoScopeId(scope), rawEvent),
      },
      decodeUtf8: bytes => new TextDecoder().decode(bytes),
      // Unique per send, which is all a transaction id has to be: the
      // homeserver uses it to recognise a retry of the same send, and
      // nothing here retries.
      newTransactionId: () =>
        `messagr-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    },
    identity,
    body,
  )
}

/**
 * Phase four: reads an encrypted event somebody else put in the room and
 * shows what it says.
 *
 * Nothing here touches matrix-js-sdk's `MatrixEvent.attemptDecryption`, the
 * internal API ADR-0001 named as this design's largest exposure. It is not
 * needed: the event is read raw out of a raw sync and decrypted through the
 * bridge, because this application renders its own screen rather than the
 * SDK's timeline model. See receiveDecrypt.ts for what that does and does
 * not settle.
 */
export async function receiveOneEncryptedMessage(
  sessionClient: ReturnType<typeof createClient>,
  identity: DeviceIdentity,
  roomId: string,
): Promise<ReceiveReport> {
  return receiveAndDecrypt(
    {
      http: makePumpHttp(sessionClient),
      machine: {
        receiveSyncChanges,
        decryptEvent: (scope, rawEvent) =>
          decryptEvent(asCryptoScopeId(scope), rawEvent),
      },
      decodeUtf8: bytes => new TextDecoder().decode(bytes),
      // A real pause on a device, where the far side may still be sending.
      waitBetweenRounds: () =>
        new Promise(resolve => setTimeout(resolve, 2000)),
    },
    roomId,
    identity.userId,
  )
}

/**
 * The conversation, read from the room and decrypted here.
 *
 * ADR-0006: nothing decrypted is written to disk, so a relaunch derives the
 * timeline again rather than reading a second copy of it. That costs a round
 * trip and buys a device that holds no cleartext history.
 *
 * The room key comes from the crypto store, which this device already
 * reopened with the passphrase in the operating system's keystore -- so this
 * decrypts everything that device ever had a session for, and reports the
 * rest as unreadable rather than hiding it.
 */
export async function loadConversation(
  sessionClient: ReturnType<typeof createClient>,
  roomId: string,
  limit = 40,
): Promise<TimelineEntry[]> {
  const http = makePumpHttp(sessionClient)
  const events = await fetchRoomMessages(http, roomId, limit)
  return toTimelineEntries(
    {
      decryptEvent: (scope, rawEvent) =>
        decryptEvent(asCryptoScopeId(scope), rawEvent),
    },
    bytes => new TextDecoder().decode(bytes),
    roomId,
    events,
  )
}

/**
 * The room to read from when this run's own send did not resolve one.
 *
 * `null` rather than a throw: an account in no room has nothing to receive,
 * which is a state to report, not a failure.
 */
export async function firstJoinedRoom(
  sessionClient: ReturnType<typeof createClient>,
): Promise<string | null> {
  const rooms = await fetchJoinedRooms(makePumpHttp(sessionClient))
  return rooms[0] ?? null
}

/**
 * Runs #27's diagnostic against the real bridge. Off unless the build asked
 * for it; see panicProbe.ts for what it asks and why.
 */
export async function runPanicProbe(
  identity: DeviceIdentity,
  storeDir: string,
): Promise<ProbeReport> {
  return probeUnsettledEncrypt(
    {
      createCryptoMachine,
      encryptEvent: (scope, eventType, payload) =>
        encryptEvent(asCryptoScopeId(scope), eventType, payload),
      getDeviceIdentityKeys,
    },
    identity,
    storeDir,
  )
}

/**
 * Phase five: the inviter's gesture, bound to the real bridge and the real
 * media repository.
 *
 * Pure glue, like everything else here. The sequence -- and the ordering that
 * makes it worth anything -- is `vouch.ts`'s `vouchFor`, tested there against
 * injected fakes.
 *
 * `fetch` is passed rather than reached for inside `mediaRepository`, which
 * keeps that module testable without a server and keeps this file the only
 * place a global is touched.
 */
export async function vouchForEntrant(
  sessionClient: ReturnType<typeof createClient>,
  credentials: { readonly baseUrl: string; readonly accessToken: string },
  scope: string,
  entrantId: string,
): Promise<VouchOutcome> {
  const outcome = await vouchFor(
    makePumpHttp(sessionClient),
    {
      takeOutgoingRequests,
      markRequestSent,
      markRequestFailed,
      buildHistoryBundle: bundleScope =>
        buildHistoryBundle(asCryptoScopeId(bundleScope)),
      shareHistoryBundle: (bundleScope, userId, url, secret) =>
        shareHistoryBundle(asCryptoScopeId(bundleScope), userId, url, secret),
    },
    mediaRepository(credentials.baseUrl, credentials.accessToken, fetch),
    scope,
    entrantId,
  )
  // Logged as well as returned. The gesture's whole value is an ordering, and
  // an ordering is not something a screen can show: what a person sees is
  // "c'est fait" either way. The log is where the level actually granted, and
  // the step that stopped, can be read back.
  logEvent(outcome.vouched ? 'info' : 'warn', 'MESSAGR_VOUCH', { ...outcome })
  return outcome
}

/**
 * Phase five, the other side: taking history somebody vouched for you with.
 *
 * Called on launch after the sync, because the announcement is a to-device
 * event and exists for this device only once a sync carrying it has been
 * ingested. `claimHistory` never throws, which is what lets this sit in the
 * launch path.
 */
export async function claimOfferedHistory(
  credentials: { readonly baseUrl: string; readonly accessToken: string },
  scope: string,
  voucherId: string,
): Promise<HistoryClaim> {
  return claimHistory(
    {
      offeredHistoryBundle: (claimScope, senderId) =>
        offeredHistoryBundle(asCryptoScopeId(claimScope), senderId),
      receiveHistoryBundle: (claimScope, senderId, ciphertext) =>
        receiveHistoryBundle(asCryptoScopeId(claimScope), senderId, ciphertext),
    },
    mediaRepository(credentials.baseUrl, credentials.accessToken, fetch),
    scope,
    voucherId,
  )
}
