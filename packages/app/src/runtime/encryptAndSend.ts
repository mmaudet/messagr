// Type-only, as everywhere the crypto package is named outside cryptoPump.ts:
// importing it as a value installs its native JSI bootstrap and this module's
// own spec file could not load it.
import type { EventEnvelope } from 'react-native-matrix-crypto'

import type { DeviceIdentity } from './deviceIdentity'
import {
  fetchInvitedRooms,
  fetchJoinedMembers,
  fetchJoinedRooms,
  joinRoom,
  sendEncryptedEvent,
  tamperCiphertext,
} from './encryptedSend'
import { getErrorMessage } from './errors'
import {
  drainOutgoingRequests,
  type CryptoMachine,
  type HttpRequester,
} from './pump'

/** What this cycle needs from the crypto machine, beyond the pump's own. */
export interface EncryptingMachine extends CryptoMachine {
  readonly shareScopeKey: (
    scope: string,
    userIds: readonly string[],
  ) => Promise<void>
  readonly encryptEvent: (
    scope: string,
    eventType: string,
    payload: unknown,
  ) => Promise<EventEnvelope>
  readonly decryptEvent: (scope: string, rawEvent: unknown) => Promise<unknown>
}

export interface EncryptAndSendDeps {
  readonly http: HttpRequester
  readonly machine: EncryptingMachine
  /** Decodes what `encryptEvent` returns; `TextDecoder` in the app, trivial in a test. */
  readonly decodeUtf8: (bytes: Uint8Array) => string
  readonly newTransactionId: () => string
}

/**
 * What came of offering the machine a ciphertext with one character changed.
 *
 * `not-attempted` exists because the alternative is worse: folded into
 * `accepted`, a failure to *build* the tampered copy would raise an alarm
 * about the cryptography when no tampering ever happened.
 */
export type TamperOutcome = 'refused' | 'accepted' | 'not-attempted'

export type SendReport =
  | { readonly sent: false; readonly reason: string }
  | {
      readonly sent: true
      readonly roomId: string
      readonly eventId: string
      /**
       * The intact ciphertext decrypted. This is the positive control, and
       * without it the line below means nothing: a machine with no inbound
       * session at all refuses everything, tampered or not, and would report
       * a refusal that proves only that it cannot decrypt.
       */
      readonly intactDecrypted: boolean
      readonly tamper: TamperOutcome
    }

const MESSAGE_BODY = 'encrypted by the bridge, sent by the application'

/**
 * How many times to share and drain before giving up.
 *
 * Three rounds are needed in the cold case and each does something
 * different, which is why this is a loop and not one call. Six leaves room
 * for a round that learns about a device appearing mid-flight without
 * letting a machine that never settles spin forever.
 */
const MAX_SHARE_ROUNDS = 6

/**
 * Encrypts one message with the crypto machine and puts it in a room.
 *
 * The ordering carries the interoperability claim. `shareScopeKey` is what
 * gives every device in the room the key, and it does so by *queueing*
 * to-device requests rather than sending them, so the drain that follows is
 * not housekeeping: skip it and the message goes out perfectly encrypted to
 * a room where nobody has the key, which looks exactly like success from
 * here.
 *
 * Sharing before encrypting is also not optional in a second, sharper way.
 * `encryptEvent` with no group session yet does not return an error: it
 * panics inside upstream's session manager, and on a worker thread that
 * panic aborts the process. Recorded in docs/spikes/tauri-crypto-link.md,
 * where it was found.
 */
export async function encryptAndSendOneMessage(
  deps: EncryptAndSendDeps,
  identity: DeviceIdentity,
): Promise<SendReport> {
  const { http, machine, decodeUtf8, newTransactionId } = deps

  let roomId = (await fetchJoinedRooms(http))[0]

  if (roomId === undefined) {
    // Provisioning invites this account; it does not join it for us. An
    // invitation is not membership, and a message cannot be sent to a room
    // this account has only been asked to enter.
    const invited = (await fetchInvitedRooms(http))[0]
    if (invited === undefined) {
      return {
        sent: false,
        reason: 'this account is in no room, joined or invited',
      }
    }
    try {
      roomId = await joinRoom(http, invited)
    } catch (cause: unknown) {
      return { sent: false, reason: getErrorMessage(cause) }
    }
  }

  const members = await fetchJoinedMembers(http, roomId)
  if (members.length === 0) {
    return { sent: false, reason: `nobody is joined to ${roomId}` }
  }

  const settled = await shareUntilSettled(http, machine, roomId, members)
  if (settled !== null) {
    return settled
  }

  let envelope: EventEnvelope
  try {
    envelope = await machine.encryptEvent(roomId, 'm.room.message', {
      msgtype: 'm.text',
      body: MESSAGE_BODY,
    })
  } catch (cause: unknown) {
    return { sent: false, reason: getErrorMessage(cause) }
  }

  // The library's own naming warning applies: on this direction the field
  // called `ciphertext` is the whole wire content of the encrypted event,
  // ready to send, not the ciphertext string inside it.
  const contentJson = decodeUtf8(envelope.ciphertext)

  let eventId: string
  try {
    eventId = await sendEncryptedEvent(
      http,
      roomId,
      contentJson,
      newTransactionId(),
    )
  } catch (cause: unknown) {
    return { sent: false, reason: getErrorMessage(cause) }
  }

  const intactDecrypted = await decrypts(
    machine,
    rawEventAround(identity, roomId, eventId, contentJson),
  )
  const tamper = await tamperOutcome(
    machine,
    identity,
    roomId,
    eventId,
    contentJson,
  )

  return { sent: true, roomId, eventId, intactDecrypted, tamper }
}

/**
 * Shares the room key until there is nothing left to send, and answers
 * `null` when that worked.
 *
 * **One share does not deliver a key, and that is not a quirk to work
 * around: it is the protocol.** Each round does something different, and
 * each depends on the answer to the round before it.
 *
 * The first share delivers nothing at all. What it does is make the machine
 * *track* these users, because upstream skips every user it has never seen,
 * and tracking is what gets a `/keys/query` issued. The second share now
 * knows the devices exist but has no Olm session to any of them, so what it
 * queues is a `m.room_key.withheld` -- a notice that the key was *not*
 * sent -- alongside the `/keys/claim` that fixes that. Only the third,
 * once a one-time key has been claimed, queues the to-device message that
 * actually carries the session key.
 *
 * Draining between rounds is what makes each answer available to the next:
 * the responses come back through `markRequestSent`.
 *
 * Getting this wrong is silent. The message still encrypts, still sends,
 * and still looks sent from here -- the far side simply receives something
 * it can never read, which is exactly what continuous integration observed
 * before this loop existed.
 */
async function shareUntilSettled(
  http: HttpRequester,
  machine: EncryptingMachine,
  roomId: string,
  members: readonly string[],
): Promise<SendReport | null> {
  for (let round = 0; round < MAX_SHARE_ROUNDS; round += 1) {
    try {
      await machine.shareScopeKey(roomId, members)
    } catch (cause: unknown) {
      return { sent: false, reason: getErrorMessage(cause) }
    }

    const drained = await drainOutgoingRequests(http, machine)
    if (drained.failed > 0) {
      return {
        sent: false,
        reason: `${drained.failed} of the room key's own requests could not be sent`,
      }
    }
    if (drained.sent === 0) {
      // A share that queues nothing is a share with nothing left to do.
      return null
    }
  }

  // Not encrypted anyway, deliberately. Encrypting into a scope with no
  // group session does not fail politely: it panics inside upstream and
  // takes the process with it (docs/spikes/tauri-crypto-link.md).
  return {
    sent: false,
    reason: `the room key never settled after ${MAX_SHARE_ROUNDS} rounds`,
  }
}

/** The wire shape `decryptEvent` reads: an event whose content is the encrypted one. */
function rawEventAround(
  identity: DeviceIdentity,
  roomId: string,
  eventId: string,
  contentJson: string,
): unknown {
  return {
    type: 'm.room.encrypted',
    room_id: roomId,
    event_id: eventId,
    sender: identity.userId,
    origin_server_ts: Date.now(),
    content: JSON.parse(contentJson) as unknown,
  }
}

async function decrypts(
  machine: EncryptingMachine,
  rawEvent: unknown,
): Promise<boolean> {
  try {
    await machine.decryptEvent(
      (rawEvent as { room_id: string }).room_id,
      rawEvent,
    )
    return true
  } catch {
    return false
  }
}

/**
 * Asks the machine to decrypt the event it just sent, with one character of
 * the ciphertext changed, and reports what came of it.
 *
 * The tampered event is never sent anywhere: it is built locally, from the
 * real one, and offered only to this device's own machine. Proving the
 * refusal needs no second party and no polluted room.
 */
async function tamperOutcome(
  machine: EncryptingMachine,
  identity: DeviceIdentity,
  roomId: string,
  eventId: string,
  contentJson: string,
): Promise<TamperOutcome> {
  let tampered: string
  try {
    tampered = tamperCiphertext(contentJson)
  } catch {
    // Distinguished from acceptance on purpose: nothing was tampered with,
    // so there is nothing to conclude about the cryptography.
    return 'not-attempted'
  }

  const refused = !(await decrypts(
    machine,
    rawEventAround(identity, roomId, eventId, tampered),
  ))
  return refused ? 'refused' : 'accepted'
}
