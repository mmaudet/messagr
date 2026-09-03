// Type-only: no matrix-js-sdk import reaches this module's runtime
// behaviour, only the shape `makeToDeviceSource` adapts to, the same
// discipline `sessionSync.ts` keeps for `SyncClient`.
import type { createClient } from 'matrix-js-sdk'

/**
 * Feeds incoming to-device messages to the crypto machine. This is where
 * room keys arrive: a device that never wires this in can encrypt to
 * others but never decrypt what they send back.
 *
 * `ReceivedToDeviceMessage` (confirmed in #9's own investigation) is
 * delivered with no crypto configured on matrix-js-sdk's side — the SDK
 * only ever attempts to decrypt when `getCrypto()` is set, which this
 * application's transport deliberately never is (ADR-0001). One message
 * arrives at a time, so each is fed as its own `to_device_events` entry
 * rather than batched, matching how a raw `/sync`'s own array would hold
 * zero or more per poll.
 */
export interface ToDeviceSource {
  // `event` is `string`, not a literal union, for the same reason
  // `sessionSync.ts`'s `SyncClient.once` is: matrix-js-sdk's real `on`/`off`
  // are generic over the full event-name union, which no fixed literal type
  // satisfies structurally.
  on: (event: string, handler: (payload: { message: unknown }) => void) => void
  off: (event: string, handler: (payload: { message: unknown }) => void) => void
}

export interface CryptoMachineSyncFeed {
  receiveSyncChanges: (delta: { to_device_events?: unknown[] }) => Promise<void>
}

const RECEIVED_TO_DEVICE_MESSAGE = 'receivedToDeviceMessage'

/**
 * Subscribes for the life of the caller. Returns an unsubscribe function;
 * call it when the screen or session this was opened for goes away, so nothing
 * keeps feeding a crypto machine no one reads reports from any more.
 *
 * A feed failure is reported to `onError` rather than thrown: this runs
 * inside an event handler, where a throw has no caller to reach.
 */
export function subscribeToDeviceMessages(
  source: ToDeviceSource,
  machine: CryptoMachineSyncFeed,
  onError: (cause: unknown) => void,
): () => void {
  const handler = (payload: { message: unknown }): void => {
    machine
      .receiveSyncChanges({ to_device_events: [payload.message] })
      .catch(onError)
  }
  source.on(RECEIVED_TO_DEVICE_MESSAGE, handler)
  return () => source.off(RECEIVED_TO_DEVICE_MESSAGE, handler)
}

/**
 * Adapts a real matrix-js-sdk client to `ToDeviceSource`, the one place this
 * module names the SDK's concrete type. `on`/`off` are generic over the
 * SDK's full event-name union, which no fixed structural type satisfies
 * without a cast at this one boundary — the same shape `sessionSync.ts`'s
 * `makeSyncClient` uses for `once`.
 */
export function makeToDeviceSource(
  client: ReturnType<typeof createClient>,
): ToDeviceSource {
  return {
    on: (event, handler) =>
      client.on(event as Parameters<typeof client.on>[0], handler),
    off: (event, handler) =>
      client.off(event as Parameters<typeof client.off>[0], handler),
  }
}
