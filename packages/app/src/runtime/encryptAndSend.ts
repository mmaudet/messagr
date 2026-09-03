// Type-only, as everywhere the crypto package is named outside cryptoPump.ts:
// importing it as a value installs its native JSI bootstrap and this module's
// own spec file could not load it.
import type { EventEnvelope } from 'react-native-matrix-crypto'

import type { DeviceIdentity } from './deviceIdentity'
import {
  fetchJoinedMembers,
  fetchJoinedRooms,
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

export type SendReport =
  | { readonly sent: false; readonly reason: string }
  | {
      readonly sent: true
      readonly roomId: string
      readonly eventId: string
      /**
       * A ciphertext with one character changed was refused rather than
       * decrypted. `false` here is the interesting case and the reason this
       * is reported rather than asserted in place: a product that accepts a
       * tampered ciphertext has not built end-to-end encryption.
       */
      readonly tamperRefused: boolean
    }

const MESSAGE_BODY = 'encrypted by the bridge, sent by the application'

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

  const rooms = await fetchJoinedRooms(http)
  const roomId = rooms[0]
  if (roomId === undefined) {
    return { sent: false, reason: 'this account has joined no room to send to' }
  }

  const members = await fetchJoinedMembers(http, roomId)
  if (members.length === 0) {
    return { sent: false, reason: `nobody is joined to ${roomId}` }
  }

  try {
    await machine.shareScopeKey(roomId, members)
  } catch (cause: unknown) {
    return { sent: false, reason: getErrorMessage(cause) }
  }

  // The share above only queued the room key. Nothing has left the device
  // yet, and until it does the far side cannot read anything that follows.
  const shared = await drainOutgoingRequests(http, machine)
  if (shared.failed > 0) {
    return {
      sent: false,
      reason: `${shared.failed} of the room key's own requests could not be sent`,
    }
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

  const tamperRefused = await refusesTamperedCiphertext(
    machine,
    identity,
    roomId,
    eventId,
    contentJson,
  )

  return { sent: true, roomId, eventId, tamperRefused }
}

/**
 * Asks the machine to decrypt the event it just sent, with one character of
 * the ciphertext changed, and reports whether it refused.
 *
 * The tampered event is never sent anywhere: it is built locally, from the
 * real one, and offered only to this device's own machine. Proving the
 * refusal needs no second party and no polluted room.
 */
async function refusesTamperedCiphertext(
  machine: EncryptingMachine,
  identity: DeviceIdentity,
  roomId: string,
  eventId: string,
  contentJson: string,
): Promise<boolean> {
  let tampered: string
  try {
    tampered = tamperCiphertext(contentJson)
  } catch {
    return false
  }

  const rawEvent = {
    type: 'm.room.encrypted',
    room_id: roomId,
    event_id: eventId,
    sender: identity.userId,
    origin_server_ts: Date.now(),
    content: JSON.parse(tampered) as unknown,
  }

  try {
    await machine.decryptEvent(roomId, rawEvent)
  } catch {
    // The refusal this whole function exists to observe.
    return true
  }
  return false
}
