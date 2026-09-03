// Type-only, as everywhere the crypto package is named outside cryptoPump.ts.
import type { EventEnvelope } from 'react-native-matrix-crypto'

import { getErrorMessage } from './errors'
import type { HttpRequester } from './pump'

/**
 * Reading an encrypted event back and putting its plaintext on the screen.
 *
 * ADR-0001 named plaintext re-injection as the largest exposure in the whole
 * design: `MatrixEvent.attemptDecryption` accepts a duck-typed decryptor and
 * works, but is marked `@internal` and is not exported. **Nothing here uses
 * it.** The exposure exists only for a product that wants matrix-js-sdk's own
 * timeline model to hold decrypted events; this application renders its own
 * screen from its own state, so it reads the raw event out of a raw sync and
 * decrypts it through the bridge, and the internal API is never touched.
 *
 * That is not a permanent escape. The day a real timeline is built on the
 * SDK's room model, the exposure returns exactly as ADR-0001 describes it.
 */

interface RawSyncResponse {
  rooms?: { join?: Record<string, { timeline?: { events?: unknown[] } }> }
  to_device?: { events?: unknown[] }
}

/** One raw sync, split into the two halves this module needs from it. */
export interface SyncSlice {
  /** To-device messages, which is where the room key arrives. */
  readonly toDevice: readonly unknown[]
  /** Encrypted events somebody else put in the room. */
  readonly encrypted: readonly unknown[]
}

/**
 * One raw non-blocking sync, keeping both halves that matter.
 *
 * **The to-device half is not incidental, and dropping it was a real bug.**
 * A Megolm event is unreadable without its room key, and that key arrives as
 * a to-device message in the very same sync response as the event it
 * unlocks. Reading only the timeline gives a ciphertext and no way to open
 * it -- which looks exactly like a protocol disagreement and is not one.
 *
 * The SDK's own sync loop cannot supply either half here: it is stopped
 * after one poll (`sessionSync.ts`), and with no crypto configured it hands
 * these events back raw anyway. So the same raw escape hatch the pump's
 * workaround uses reads them directly.
 *
 * This account's own events are filtered out. They decrypt perfectly well --
 * this device holds the outbound session -- and proving that proves nothing
 * about interoperating with anyone.
 */
export async function fetchSyncSlice(
  http: HttpRequester,
  roomId: string,
  selfUserId: string,
): Promise<SyncSlice> {
  const responseJson = await http.authedRequest(
    'GET',
    '/_matrix/client/v3/sync',
    { timeout: '0' },
    undefined,
  )
  const response = JSON.parse(responseJson) as RawSyncResponse

  const toDevice = response.to_device?.events
  const events = response.rooms?.join?.[roomId]?.timeline?.events

  return {
    toDevice: Array.isArray(toDevice) ? toDevice : [],
    encrypted: Array.isArray(events)
      ? events.filter(event => {
          const candidate = event as { type?: unknown; sender?: unknown }
          return (
            candidate.type === 'm.room.encrypted' &&
            typeof candidate.sender === 'string' &&
            candidate.sender !== selfUserId
          )
        })
      : [],
  }
}

/**
 * Does not extend `pump.ts`'s `CryptoMachine`, unlike the neighbouring
 * `EncryptingMachine`, and that is deliberate: receiving drives no outgoing
 * queue, so the three request-marking methods would be surface this module
 * never touches.
 */
export interface DecryptingMachine {
  /** Where the room key goes in. Without this, nothing below can decrypt. */
  readonly receiveSyncChanges: (delta: {
    to_device_events?: unknown[]
  }) => Promise<void>
  readonly decryptEvent: (
    scope: string,
    rawEvent: unknown,
  ) => Promise<EventEnvelope>
}

export interface ReceiveDeps {
  readonly http: HttpRequester
  readonly machine: DecryptingMachine
  readonly decodeUtf8: (bytes: Uint8Array) => string
  /**
   * How many times to sync and try again. More than one because the key and
   * the event it unlocks are not promised to be in the same response, and
   * because the far side may not have finished sending when this first
   * looks.
   */
  readonly rounds?: number
  /** Awaited between rounds. Absent in tests, which should not sleep. */
  readonly waitBetweenRounds?: () => Promise<void>
}

const DEFAULT_ROUNDS = 6

export type ReceiveReport =
  | { readonly received: false; readonly reason: string }
  | {
      readonly received: true
      readonly body: string
      /**
       * Who the event says sent it, and nothing more.
       *
       * **Unauthenticated.** Decrypting an event does not establish who wrote
       * it: this is transport metadata read off the event, the library says
       * so about its own field, and verifying a device would not change it.
       * Named `claimedSender` so that no call site can read it as a fact
       * without having read this.
       */
      readonly claimedSender: string
    }

interface DecryptedContent {
  body?: unknown
}

/**
 * Finds an encrypted event from somebody else and decrypts it.
 *
 * Every candidate is tried, not just the first: an event whose room key has
 * not arrived refuses, and the next one may still succeed. Only when all of
 * them refuse is the last reason reported, because that is the one worth
 * reading.
 */
export async function receiveAndDecrypt(
  deps: ReceiveDeps,
  roomId: string,
  selfUserId: string,
): Promise<ReceiveReport> {
  const {
    http,
    machine,
    decodeUtf8,
    rounds = DEFAULT_ROUNDS,
    waitBetweenRounds,
  } = deps

  let lastReason = 'no encrypted event from anyone else is in the room'

  for (let round = 0; round < rounds; round += 1) {
    const slice = await fetchSyncSlice(http, roomId, selfUserId)

    // Fed before anything is attempted: this is the room key, and a decrypt
    // tried before it lands fails for a reason that has nothing to do with
    // the ciphertext.
    if (slice.toDevice.length > 0) {
      try {
        await machine.receiveSyncChanges({
          to_device_events: [...slice.toDevice],
        })
      } catch (cause: unknown) {
        lastReason = getErrorMessage(cause)
      }
    }

    for (const event of slice.encrypted) {
      const attempt = await decryptOne(machine, decodeUtf8, roomId, event)
      if (attempt.received) {
        return attempt
      }
      lastReason = attempt.reason
    }

    if (round + 1 < rounds && waitBetweenRounds !== undefined) {
      await waitBetweenRounds()
    }
  }

  return { received: false, reason: lastReason }
}

async function decryptOne(
  machine: DecryptingMachine,
  decodeUtf8: (bytes: Uint8Array) => string,
  roomId: string,
  event: unknown,
): Promise<ReceiveReport> {
  let envelope: EventEnvelope
  try {
    envelope = await machine.decryptEvent(roomId, event)
  } catch (cause: unknown) {
    return { received: false, reason: getErrorMessage(cause) }
  }

  let content: DecryptedContent
  try {
    content = JSON.parse(decodeUtf8(envelope.ciphertext)) as DecryptedContent
  } catch (cause: unknown) {
    return { received: false, reason: getErrorMessage(cause) }
  }

  if (typeof content.body !== 'string') {
    return {
      received: false,
      reason: 'the decrypted event names no message body',
    }
  }

  return {
    received: true,
    body: content.body,
    claimedSender: envelope.sender,
  }
}
