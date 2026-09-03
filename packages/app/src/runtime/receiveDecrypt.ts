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

interface SyncTimelineResponse {
  rooms?: { join?: Record<string, { timeline?: { events?: unknown[] } }> }
}

/**
 * The encrypted events somebody else put in the room.
 *
 * Read from a raw non-blocking sync, the same escape hatch the pump's own
 * workaround uses: the SDK's loop is stopped by the time this runs, and with
 * no crypto configured it would hand back these events raw anyway.
 *
 * This account's own events are filtered out. They decrypt perfectly well --
 * this device holds the outbound session -- and proving that proves nothing
 * about interoperating with anyone.
 */
export async function fetchEncryptedEvents(
  http: HttpRequester,
  roomId: string,
  selfUserId: string,
): Promise<readonly unknown[]> {
  const responseJson = await http.authedRequest(
    'GET',
    '/_matrix/client/v3/sync',
    { timeout: '0' },
    undefined,
  )
  const response = JSON.parse(responseJson) as SyncTimelineResponse
  const events = response.rooms?.join?.[roomId]?.timeline?.events

  if (!Array.isArray(events)) {
    return []
  }

  return events.filter(event => {
    const candidate = event as { type?: unknown; sender?: unknown }
    return (
      candidate.type === 'm.room.encrypted' &&
      typeof candidate.sender === 'string' &&
      candidate.sender !== selfUserId
    )
  })
}

export interface DecryptingMachine {
  readonly decryptEvent: (
    scope: string,
    rawEvent: unknown,
  ) => Promise<EventEnvelope>
}

export interface ReceiveDeps {
  readonly http: HttpRequester
  readonly machine: DecryptingMachine
  readonly decodeUtf8: (bytes: Uint8Array) => string
}

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
  const { http, machine, decodeUtf8 } = deps

  const events = await fetchEncryptedEvents(http, roomId, selfUserId)
  if (events.length === 0) {
    return {
      received: false,
      reason: 'no encrypted event from anyone else is in the room',
    }
  }

  let lastReason = 'no encrypted event could be decrypted'

  for (const event of events) {
    let envelope: EventEnvelope
    try {
      envelope = await machine.decryptEvent(roomId, event)
    } catch (cause: unknown) {
      lastReason = getErrorMessage(cause)
      continue
    }

    // The library's own naming warning, in the other direction: on the
    // decrypt path the field called `ciphertext` holds the plaintext this
    // call just recovered. Everything a product does to plaintext, it must
    // do to this.
    let content: DecryptedContent
    try {
      content = JSON.parse(decodeUtf8(envelope.ciphertext)) as DecryptedContent
    } catch (cause: unknown) {
      lastReason = getErrorMessage(cause)
      continue
    }

    if (typeof content.body !== 'string') {
      lastReason = 'the decrypted event names no message body'
      continue
    }

    return {
      received: true,
      body: content.body,
      claimedSender: envelope.sender,
    }
  }

  return { received: false, reason: lastReason }
}
