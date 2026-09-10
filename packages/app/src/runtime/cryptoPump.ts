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
import { AppState } from 'react-native'

import type { createClient } from 'matrix-js-sdk'
import {
  asCryptoScopeId,
  bootstrapCrossSigning,
  createCryptoMachine,
  createCrossSigningIdentity,
  decryptAttachment,
  decryptEvent,
  discardScopeKey,
  encryptAttachment,
  encryptEvent,
  encryptionSlice,
  buildHistoryBundle,
  getDeviceIdentityKeys,
  getDeviceStatuses,
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
import {
  cryptoStoreFormMarker,
  cryptoStoreSecrets,
  syncCursorSecrets,
} from './deviceSecrets'
import { migrateKeystoreForm, type FormMigration } from './keystoreForm'
import { openStorePassphrase } from './storePassphrase'
import type { DeviceIdentity } from './deviceIdentity'
import {
  encryptAndSendOneMessage,
  sendIntoScope,
  type SendReport,
} from './encryptAndSend'
import { getErrorMessage } from './errors'
import { logEvent } from './log'
import {
  fetchInvitations,
  declineRoom,
  fetchJoinedMembers,
  fetchJoinedRooms,
  joinRoom,
} from './encryptedSend'
import { theOtherMember } from './vouch'
import { reactTo, redactEvent, unreact, type ReactingDeps } from './react'
import { tallyReactions, type ReactionTally } from '../timeline/reactions'
import { probeUnsettledEncrypt, type ProbeReport } from './panicProbe'
import { claimHistory, type HistoryClaim } from './claimHistory'
import { evictFrom, type EvictOutcome } from './evict'
import { mediaRepository } from './mediaRepository'
import {
  forgetPusher,
  registerPusher,
  type PusherRegistration,
  type Road,
} from './pusher'
import type { PickedImage } from './pickImage'
import { openForForward } from './forwardImage'
import { fetchImage, type ShownImage } from './receiveImage'
import { sendImage, sendingThrough, type ImageSent } from './sendImage'
import type { ReadFile } from '../timeline/imageEvent'
import { enterInvitations, type Entered } from './enterInvitations'
import { drainOutgoingRequests, makePumpHttp } from './pump'
import {
  admitDrawnEntrant,
  issueInvitation,
  type Admission,
  type Issued,
} from './issueInvitation'
import { invitationService } from './servicePoster'
import {
  startSyncLoop,
  type RunningSyncLoop,
  type SyncLoopState,
  type SyncTick,
} from './syncLoop'
import { PROMOTED_LEVEL, vouchFor, type VouchOutcome } from './vouch'
import { fetchPowerContent, readPower } from './powerLevels'
import { readWhatIsKnown, type TrustReading } from './trustReading'
import { receiveAndDecrypt, type ReceiveReport } from './receiveDecrypt'
import {
  runOutgoingPumpCycle,
  type CryptoPumpReport,
} from './outgoingPumpCycle'
import { fetchRoomMessages, toTimelineEntries } from '../timeline/buildTimeline'
import {
  fetchConversationSummaries,
  type ConversationSummary,
} from './conversationList'
import type { TimelineEntry } from '../timeline/mergeTimeline'
import { makeToDeviceSource, subscribeToDeviceMessages } from './toDeviceBridge'

export type { CryptoPumpReport } from './outgoingPumpCycle'
export type { SendReport } from './encryptAndSend'
export type { ReceiveReport } from './receiveDecrypt'
export type { ProbeReport } from './panicProbe'
export type { FormMigration, FormOutcome } from './keystoreForm'
export type { RunningSyncLoop, SyncLoopState, SyncTick } from './syncLoop'

export type MachineStartResult = {
  /**
   * What became of the passphrase's keystore accessibility on this launch.
   * ADR-0008, and reported whether or not the machine then started: a
   * migration that could not run is the difference between a device that can
   * decrypt on a background wake and one that cannot, and it is invisible
   * everywhere else.
   */
  readonly passphraseForm: FormMigration
} & (
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
)

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
/**
 * Whether a crypto machine has already been created in this JavaScript
 * context, and for which device.
 *
 * # Why this is not paranoia
 *
 * `computeCryptoMachineConfig` says it outright: *"the first launch to open a
 * second store loses every room key the first one held."* Until #107 there
 * was one caller and no way to reach two. There are two now -- the launch,
 * and the headless wake -- and React Native runs a background handler in the
 * **same** JavaScript context when the application is warm. Starting again
 * there would be the second open, against the same file, with the
 * conversation on screen holding the first.
 *
 * So the machine is created once and the second caller is told so. The device
 * id is kept rather than a boolean, because "already started" is only an
 * answer if it is the same device -- and a device id changing under a running
 * process is a thing to refuse loudly rather than to reuse.
 */
let machineStartedFor: string | null = null

/** Whether this context already holds a machine for `deviceId`. */
export function cryptoMachineIsRunning(deviceId: string): boolean {
  return machineStartedFor === deviceId
}

export async function startCryptoMachine(
  sessionClient: ReturnType<typeof createClient>,
  credentials: DeviceIdentity,
  storeDir: string,
  onToDeviceError: (cause: unknown) => void,
): Promise<MachineStartResult> {
  // BEFORE THE PASSPHRASE IS READ, not after, and that ordering is the whole
  // migration. Reading an entry in the old form works here, in the
  // foreground; moving it afterwards would leave the window ADR-0008 exists
  // to close open for one more launch.
  //
  // `AppState.currentState` is asked rather than assumed. It is `active` on
  // every launch this application has today, which is exactly why writing
  // `true` would be wrong: the day ADR-0009's silent wake lands, this is the
  // line that already knows not to try.
  const passphraseForm = await migrateKeystoreForm(
    cryptoStoreSecrets,
    cryptoStoreFormMarker,
    AppState.currentState === 'active',
  )
  logEvent(
    passphraseForm.outcome === 'failed' ? 'warn' : 'info',
    'MESSAGR_KEYSTORE_FORM',
    { ...passphraseForm },
  )

  // Before the config, because there is no useful config without it. A
  // store opened with the wrong passphrase is not a degraded store, it is a
  // different one -- and the first launch to open a second store loses every
  // room key the first one held.
  const passphrase = await openStorePassphrase(cryptoStoreSecrets, byteLength =>
    crypto.getRandomValues(new Uint8Array(byteLength)),
  )
  // Logged next to the migration above, and for the same reason: the pair is
  // the only evidence that a launch could actually reach its own passphrase.
  // ADR-0008's whole claim is that this read works while the screen is off,
  // and the readout cannot show it -- a launch that never got here draws no
  // screen at all.
  logEvent(passphrase.held ? 'info' : 'warn', 'MESSAGR_STORE_PASSPHRASE', {
    held: passphrase.held,
    ...(passphrase.held
      ? { minted: passphrase.minted }
      : { reason: passphrase.reason }),
  })
  if (!passphrase.held) {
    return { started: false, reason: passphrase.reason, passphraseForm }
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
      passphraseForm,
    }
  }

  // ONE MACHINE PER CONTEXT. See `machineStartedFor`: the wake and the launch
  // share a JavaScript context when the application is warm, and a second
  // `createCryptoMachine` against the same file is how room keys are lost.
  if (
    machineStartedFor !== null &&
    machineStartedFor !== credentials.deviceId
  ) {
    return {
      started: false,
      reason: `this context already holds a machine for ${machineStartedFor}`,
      passphraseForm,
    }
  }
  if (machineStartedFor === null) {
    try {
      await createCryptoMachine(config)
    } catch (cause: unknown) {
      return { started: false, reason: getErrorMessage(cause), passphraseForm }
    }
    machineStartedFor = credentials.deviceId
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
    passphraseForm,
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
/**
 * Sends what a person typed, into the conversation they are looking at.
 *
 * The probe below is not this: it finds a room rather than being given one,
 * which is right for a launch report and was catastrophic for a composer.
 * See `sendIntoScope`.
 */
export async function sendTypedMessage(
  sessionClient: ReturnType<typeof createClient>,
  scope: string,
  body: string,
): Promise<{ readonly sent: boolean; readonly reason?: string }> {
  const result = await sendIntoScope(
    encryptingDeps(sessionClient),
    scope,
    'm.room.message',
    { msgtype: 'm.text', body },
  )
  return result.sent ? { sent: true } : { sent: false, reason: result.reason }
}

export async function sendOneEncryptedMessage(
  sessionClient: ReturnType<typeof createClient>,
  identity: DeviceIdentity,
  /** What a person typed, when a person typed it. */
  body?: string,
): Promise<SendReport> {
  return encryptAndSendOneMessage(encryptingDeps(sessionClient), identity, body)
}

/** What both send paths need from the machine and the wire. */
export function encryptingDeps(sessionClient: ReturnType<typeof createClient>) {
  return {
    http: makePumpHttp(sessionClient),
    machine: {
      takeOutgoingRequests,
      markRequestSent,
      markRequestFailed,
      shareScopeKey: (scope: string, userIds: readonly string[]) =>
        shareScopeKey(asCryptoScopeId(scope), [...userIds]),
      encryptEvent: (scope: string, eventType: string, payload: unknown) =>
        encryptEvent(asCryptoScopeId(scope), eventType, payload),
      decryptEvent: (scope: string, rawEvent: unknown) =>
        decryptEvent(asCryptoScopeId(scope), rawEvent),
    },
    decodeUtf8: (bytes: Uint8Array) => new TextDecoder().decode(bytes),
    // Unique per send, which is all a transaction id has to be: the
    // homeserver uses it to recognise a retry of the same send, and
    // nothing here retries.
    newTransactionId: () =>
      `messagr-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
  }
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
export interface LoadedConversation {
  readonly entries: TimelineEntry[]
  /** Reactions, already grouped by the message they point at. */
  readonly reactions: ReadonlyMap<string, readonly ReactionTally[]>
}

export async function loadConversation(
  sessionClient: ReturnType<typeof createClient>,
  roomId: string,
  selfUserId: string,
  limit = 40,
): Promise<LoadedConversation> {
  const http = makePumpHttp(sessionClient)
  const events = await fetchRoomMessages(http, roomId, limit)
  const { entries, reactions } = await toTimelineEntries(
    {
      decryptEvent: (scope, rawEvent) =>
        decryptEvent(asCryptoScopeId(scope), rawEvent),
    },
    bytes => new TextDecoder().decode(bytes),
    roomId,
    events,
  )
  // Both, from one pass. ADR-0011: reactions come out of the same door the
  // messages do, and the aggregation the server would have done happens here.
  return { entries, reactions: tallyReactions(reactions, selfUserId) }
}

/**
 * Phase twelve: walking through the door somebody held open.
 *
 * Pure glue. What it does and why entering is the product's business rather
 * than a probe's side effect is `enterInvitations.ts`, tested there against
 * injected fakes.
 */
export async function enterAnyInvitations(
  sessionClient: ReturnType<typeof createClient>,
  selfUserId: string,
): Promise<Entered> {
  const http = makePumpHttp(sessionClient)
  const entered = await enterInvitations({
    http,
    invitedRooms: fetchInvitations,
    join: joinRoom,
    decline: declineRoom,
    // ONE CALL PER CONVERSATION, and `enterInvitations` is careful about
    // when it asks: never on a tick with no invitation on it, which is
    // almost every tick. Direct conversations only -- a room of three has
    // no single person to be already talking to.
    alreadyWith: async asking => {
      const already = new Set<string>()
      for (const scope of await fetchJoinedRooms(asking)) {
        const other = theOtherMember(
          await fetchJoinedMembers(asking, scope),
          selfUserId,
        )
        if (other !== null) already.add(other)
      }
      return already
    },
  })
  // Only when something happened: this runs on every sync tick, and a line
  // per tick saying "nobody invited anybody" would bury the one that matters.
  if (
    entered.joined.length > 0 ||
    entered.refused.length > 0 ||
    entered.collapsed.length > 0
  ) {
    logEvent(entered.refused.length > 0 ? 'warn' : 'info', 'MESSAGR_ENTERED', {
      ...entered,
    })
  }
  return entered
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
 * Phase six: removing somebody, and the rotation that decides whether it
 * meant anything.
 *
 * Pure glue. The sequence -- remove first, rotate second -- is `evict.ts`'s
 * `evictFrom`, tested there against injected fakes.
 */
export async function evictMember(
  sessionClient: ReturnType<typeof createClient>,
  scope: string,
  memberId: string,
): Promise<EvictOutcome> {
  const outcome = await evictFrom(
    makePumpHttp(sessionClient),
    {
      takeOutgoingRequests,
      markRequestSent,
      markRequestFailed,
      discardScopeKey: evictScope =>
        discardScopeKey(asCryptoScopeId(evictScope)),
    },
    scope,
    memberId,
  )
  // Logged as well as returned, for the reason #35 gives: the test must
  // assert the rotation and not the membership change, and the membership
  // change is the half a screen shows. `rotated` is the fact that decides
  // whether this was an eviction or the appearance of one.
  logEvent(outcome.evicted ? 'info' : 'warn', 'MESSAGR_EVICT', { ...outcome })
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

/**
 * Phase seven: the live sync loop, bound to the real transport and the real
 * crypto machine. ADR-0007.
 *
 * Pure glue, like every other phase here. What the loop does, and the
 * ordering that makes it safe -- feed the machine, send what that queued,
 * only then advance the cursor -- is `syncLoop.ts`'s `startSyncLoop`, tested
 * there against injected fakes.
 *
 * Started after `runOutgoingPump`, which is after `fetchSessionSyncStatus`
 * has stopped matrix-js-sdk's own loop. Two loops polling one account would
 * race for the to-device messages that carry room keys, since a homeserver
 * hands each of those to a device once and the cursor that acknowledged it
 * decides which loop saw it.
 */
export function startLiveSync(
  sessionClient: ReturnType<typeof createClient>,
  onTick: (tick: SyncTick) => void,
  onState: (state: SyncLoopState) => void,
): RunningSyncLoop {
  return startSyncLoop({
    http: makePumpHttp(sessionClient),
    machine: {
      takeOutgoingRequests,
      markRequestSent,
      markRequestFailed,
      receiveSyncChanges,
    },
    encryptionSlice,
    cursorStore: syncCursorSecrets,
    onTick,
    onState,
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
  })
}

/**
 * The list of conversations, bound to the real transport and the real crypto
 * machine.
 *
 * Pure glue, like every other phase here. What it derives, and why it is not
 * built out of the sync loop's own response, is `conversationList.ts`'s
 * `fetchConversationSummaries`, tested there against injected fakes.
 */
export async function listConversations(
  sessionClient: ReturnType<typeof createClient>,
  selfUserId: string,
  /** How far each conversation has been read on this device. */
  lastRead: ReadonlyMap<string, number>,
  /** What this device was told not to draw. See `hiddenStore.ts`. */
  hidden: ReadonlySet<string> = new Set(),
): Promise<ConversationSummary[]> {
  return fetchConversationSummaries(
    {
      http: makePumpHttp(sessionClient),
      machine: {
        decryptEvent: (scope, rawEvent) =>
          decryptEvent(asCryptoScopeId(scope), rawEvent),
      },
      decodeUtf8: bytes => new TextDecoder().decode(bytes),
    },
    selfUserId,
    lastRead,
    hidden,
  )
}

/**
 * Phase eight: inviting somebody, which is the same gesture as starting a
 * conversation with them.
 *
 * Pure glue. What it does, why the conversation and the invitation are one
 * call, and why a minted invitation is not yet claimable is
 * `issueInvitation.ts`, tested there against injected fakes.
 *
 * The link's host comes from the account's own homeserver rather than from
 * anything configured here: an invitation into this instance is the only kind
 * this application can issue, and a link naming another one would be a link
 * nobody can claim.
 */
export async function inviteSomebody(
  sessionClient: ReturnType<typeof createClient>,
  credentials: { readonly baseUrl: string; readonly accessToken: string },
): Promise<Issued> {
  return issueInvitation(
    {
      http: makePumpHttp(sessionClient),
      service: invitationService(credentials.baseUrl, credentials.accessToken),
      newIdempotencyKey: () =>
        `messagr-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      wait: ms => new Promise(resolve => setTimeout(resolve, ms)),
    },
    credentials.baseUrl.replace(/^https?:\/\//, ''),
  )
}

/**
 * The issuer's half of the claim, which nobody taps for.
 *
 * See `issueInvitation.ts`: the entrant's first claim draws an account and is
 * answered 409, and the link keeps failing until that account is invited.
 */
export async function admitEntrant(
  sessionClient: ReturnType<typeof createClient>,
  credentials: { readonly baseUrl: string; readonly accessToken: string },
  invitationId: string,
  scope: string,
): Promise<Admission> {
  const admission = await admitDrawnEntrant(
    {
      http: makePumpHttp(sessionClient),
      service: invitationService(credentials.baseUrl, credentials.accessToken),
      newIdempotencyKey: () => '',
      wait: ms => new Promise(resolve => setTimeout(resolve, ms)),
    },
    invitationId,
    scope,
  )
  // Logged as well as returned: this runs with nobody watching, and whether
  // somebody could enter is not otherwise visible until they say they could
  // not.
  logEvent(admission.admitted ? 'info' : 'warn', 'MESSAGR_ADMIT', {
    ...admission,
  })
  return admission
}

export type { Issued, Admission } from './issueInvitation'

/**
 * Phase nine: what is known about the person on the other side.
 *
 * Pure glue. What the three counts mean, and why they are three rather than
 * one scale, is `trustReading.ts`, tested there against injected values.
 *
 * The vouch is read from the conversation's power levels rather than
 * remembered anywhere: `vouchFor` grants the level, so the room state is the
 * record, and a second copy could only disagree with it.
 */
export async function readTrust(
  sessionClient: ReturnType<typeof createClient>,
  scope: string,
  participant: string,
): Promise<TrustReading> {
  const http = makePumpHttp(sessionClient)
  const [statuses, levels] = await Promise.all([
    getDeviceStatuses(participant),
    fetchPowerContent(http, scope),
  ])
  return readWhatIsKnown(
    statuses,
    readPower(levels, participant).held >= PROMOTED_LEVEL,
  )
}

export type { TrustReading } from './trustReading'

/** What this application needs to make and unmake a reaction. */
function reacting(
  sessionClient: ReturnType<typeof createClient>,
): ReactingDeps {
  return {
    http: makePumpHttp(sessionClient),
    machine: {
      encryptEvent: (scope, eventType, payload) =>
        encryptEvent(asCryptoScopeId(scope), eventType, payload),
    },
    decodeUtf8: bytes => new TextDecoder().decode(bytes),
    newTransactionId: () =>
      `messagr-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
  }
}

/**
 * Phase ten: reacting to a message, and taking it back.
 *
 * Pure glue. ADR-0011 and `react.ts` carry the reasoning: a reaction is an
 * encrypted event like any other here, and removing one is a redaction, which
 * is why the two are not symmetrical.
 */
export async function reactToMessage(
  sessionClient: ReturnType<typeof createClient>,
  scope: string,
  target: string,
  key: string,
) {
  return reactTo(reacting(sessionClient), scope, target, key)
}

export async function removeReaction(
  sessionClient: ReturnType<typeof createClient>,
  scope: string,
  reactionEventId: string,
) {
  return unreact(reacting(sessionClient), scope, reactionEventId)
}

/**
 * Removes a message for everyone. The same call, saying it was a message --
 * see `redactionKind.ts` for why that has to be said out loud.
 */
export async function removeMessage(
  sessionClient: ReturnType<typeof createClient>,
  scope: string,
  eventId: string,
) {
  return redactEvent(reacting(sessionClient), scope, eventId, 'message')
}

/**
 * Phase eleven: sending a photograph, and getting one back.
 *
 * Pure glue, and it names two library functions nothing else does:
 * `encryptAttachment` and `decryptAttachment`. The bytes never touch a
 * filesystem on either side -- see `sendImage.ts` and `receiveImage.ts` for
 * why that is ADR-0006 rather than a preference.
 *
 * `fetch` is passed rather than reached for inside `mediaRepository`, the way
 * `vouchForEntrant` does it and for the same reason: this file stays the only
 * place a global is touched.
 */
export async function sendPhotograph(
  sessionClient: ReturnType<typeof createClient>,
  credentials: { readonly baseUrl: string; readonly accessToken: string },
  scope: string,
  image: PickedImage,
): Promise<ImageSent> {
  const http = makePumpHttp(sessionClient)
  const media = mediaRepository(
    credentials.baseUrl,
    credentials.accessToken,
    fetch,
  )
  return sendImage(
    {
      seal: plaintext => encryptAttachment(plaintext),
      // OCTET-STREAM, AND THE PHOTOGRAPH'S OWN TYPE IS NOT SENT.
      // What goes to the repository is ciphertext, not a JPEG. Declaring
      // `image/jpeg` would be a claim about bytes nobody there can read, and
      // it would tell the server what kind of thing somebody sent -- which is
      // exactly the metadata the encryption is for. The real type travels
      // inside the event, where only a participant sees it.
      upload: ciphertext =>
        media.upload(ciphertext, 'application/octet-stream'),
      // The same sequence the text path takes, and for the same reason.
      shareTheKey: async shareScope => {
        const members = await fetchJoinedMembers(http, shareScope)
        if (members.length === 0) {
          throw new Error(`nobody is joined to ${shareScope}`)
        }
        await shareScopeKey(asCryptoScopeId(shareScope), [...members])
        const drained = await drainOutgoingRequests(http, {
          takeOutgoingRequests,
          markRequestSent,
          markRequestFailed,
        })
        if (drained.failed > 0) {
          throw new Error(
            `${drained.failed} of the room key's own requests could not be sent`,
          )
        }
      },
      machine: {
        encryptEvent: (encryptScope, eventType, payload) =>
          encryptEvent(asCryptoScopeId(encryptScope), eventType, payload),
      },
      send: sendingThrough(
        http,
        () => `messagr-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      ),
    },
    scope,
    image,
  )
}

/**
 * Taking the pusher away, which is what turning notifications off must do.
 *
 * The same route with `kind: null`. A setting that only stopped the *next*
 * launch registering would leave the pusher already there firing, which is a
 * switch that reads as off and is on.
 */
export async function stopWakingThisDevice(
  sessionClient: ReturnType<typeof createClient>,
  token: string,
  road: Road,
): Promise<void> {
  await makePumpHttp(sessionClient).authedRequest(
    'POST',
    '/_matrix/client/v3/pushers/set',
    {},
    JSON.stringify(forgetPusher(token, road)),
  )
}

/**
 * The other half: what a screen calls to draw a photograph it received.
 *
 * A `ReadFile` and not a `ReadImage`, because a thumbnail is a file with an
 * address and a key of its own -- the caller decides which of the two it
 * wants, and nothing down here needs to know which it was given.
 */
/**
 * A photograph taken out of one conversation and made ready for another.
 *
 * The same media repository and the same decryption `openPhotograph` uses,
 * answering bytes rather than a `data:` URI -- `forwardImage.ts` says why a
 * forward pays for its own round trip rather than the cache holding two
 * shapes of every picture.
 */
export async function photographForForward(
  credentials: { readonly baseUrl: string; readonly accessToken: string },
  image: ReadFile,
) {
  const media = mediaRepository(
    credentials.baseUrl,
    credentials.accessToken,
    fetch,
  )
  return openForForward(
    {
      download: url => media.download(url),
      open: (ciphertext, secret) => decryptAttachment(ciphertext, secret),
    },
    image,
  )
}

export async function openPhotograph(
  credentials: { readonly baseUrl: string; readonly accessToken: string },
  image: ReadFile,
): Promise<ShownImage> {
  const media = mediaRepository(
    credentials.baseUrl,
    credentials.accessToken,
    fetch,
  )
  return fetchImage(
    {
      download: url => media.download(url),
      open: (ciphertext, secret) => decryptAttachment(ciphertext, secret),
    },
    image,
  )
}

/**
 * Phase twelve: telling the homeserver where to wake this device.
 *
 * Pure glue. What the pusher says, and why it points at this deployment's own
 * gateway rather than at sygnal, is `pusher.ts`.
 *
 * The gateway base is derived from the account's own homeserver, the way
 * `issueInvitation`'s link host is: a device pushes through the deployment it
 * belongs to, and a configured URL would be one more thing that can point
 * somewhere else.
 */
export async function registerThisDeviceForWaking(
  sessionClient: ReturnType<typeof createClient>,
  credentials: { readonly baseUrl: string },
  token: string,
  road: Road,
): Promise<PusherRegistration> {
  const http = makePumpHttp(sessionClient)
  return registerPusher(
    async body => {
      await http.authedRequest(
        'POST',
        '/_matrix/client/v3/pushers/set',
        {},
        JSON.stringify(body),
      )
    },
    token,
    `${credentials.baseUrl.replace(/\/+$/, '')}/_messagr`,
    road,
  )
}

export type { ReactionTally } from '../timeline/reactions'

/**
 * Tells the homeserver this account has read up to `eventId`.
 *
 * # Two receipts, and only one of them is a courtesy
 *
 * `m.read` is public metadata: it tells the other party, and the server, the
 * hour somebody read them. It is off unless the setting says otherwise, for
 * the reason `receiptSetting.ts` gives -- a product that refuses to let a
 * server read content and then publishes when it was read contradicts
 * itself.
 *
 * `m.read.private` (MSC2285) says the same thing to the homeserver and to
 * nobody else. It is sent **always**, and it is not a courtesy: it is what
 * stops the server counting a message as unread, which is what stops it
 * pushing a notification for something already read. Without it every
 * conversation would keep notifying until the person turned on the setting
 * that watches them, which would make a privacy choice cost a working
 * product.
 *
 * Failure is swallowed on purpose, and this is the one place in this file
 * where that is right: a receipt that did not go is invisible to the person
 * who sent it and changes nothing they can act on. Reporting it would put a
 * warning on a screen about a courtesy.
 */
export async function sendReadReceipt(
  sessionClient: ReturnType<typeof createClient>,
  scope: string,
  eventId: string,
  kind: 'm.read' | 'm.read.private',
): Promise<void> {
  try {
    await makePumpHttp(sessionClient).authedRequest(
      'POST',
      `/_matrix/client/v3/rooms/${encodeURIComponent(scope)}/receipt/` +
        `${kind}/${encodeURIComponent(eventId)}`,
      {},
      JSON.stringify({}),
    )
  } catch {
    // See above.
  }
}
