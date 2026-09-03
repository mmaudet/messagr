// Type-only: no matrix-js-sdk import reaches the module's runtime behaviour,
// only the shape one factory below adapts to. `ReturnType<typeof
// createClient>` names that shape without depending on where the package's
// own .d.ts happens to re-export the class itself from.
import type { createClient } from 'matrix-js-sdk'

import { getErrorMessage } from './errors'

/**
 * Restores a session on an already-constructed client and waits for the
 * first sync, timing the wait.
 *
 * Two checks come before any network call, because a client built without a
 * restored session or with its own crypto is wrong in a way no sync duration
 * can redeem. `isLoggedIn()` is true the moment `createClient` is handed
 * `userId`/`deviceId`/`accessToken`: no `/login` request is made, which is
 * what "restored, not created by an interactive login" means in code.
 *
 * `startClient()` resolves once the sync loop has started, not once the
 * first sync has landed, so the signal waited on is the `sync` event
 * reaching `PREPARED` (or `SYNCING`, its immediate successor) rather than
 * that promise.
 */
export interface SyncClient {
  isLoggedIn: () => boolean
  getCrypto: () => unknown
  startClient: () => Promise<void>
  // Stops the sync loop `startClient` began. Matrix's `/sync` is long-polling
  // by design: once the first sync lands, the client immediately opens
  // another that stays open for up to the server's timeout. This ticket
  // claims one sync completes, not that the client stays connected, and a
  // poll nothing here ever reads again is a leak, not a feature yet, so it is
  // stopped rather than left running once the room count and duration below
  // are captured.
  stopClient: () => void
  getRooms: () => readonly unknown[]
  // `event` is `string`, not the literal `'sync'`: matrix-js-sdk's real
  // `once` is generic over its full event-name union, and a literal type
  // here does not structurally satisfy that generic's constraint, only a
  // parameter this permissive does.
  once: (
    event: string,
    handler: (state: string, prevState: string | null) => void,
  ) => void
}

export type SessionSyncStatus =
  | {
      readonly synced: true
      readonly roomCount: number
      readonly durationMs: number
    }
  | { readonly synced: false; readonly reason: string }

const DEFAULT_TIMEOUT_MS = 30_000

export async function fetchSessionSyncStatus(
  client: SyncClient,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<SessionSyncStatus> {
  if (!client.isLoggedIn()) {
    return {
      synced: false,
      reason: 'the client is not carrying a restored session',
    }
  }
  if (client.getCrypto() != null) {
    return {
      synced: false,
      reason: 'the transport initialised its own crypto backend',
    }
  }

  const startedAt = Date.now()
  const firstSync = waitForFirstSync(client, timeoutMs)

  try {
    await client.startClient()
  } catch (cause: unknown) {
    return { synced: false, reason: getErrorMessage(cause) }
  }

  // From here the loop is running, so every return path stops it: a report
  // read the room count and duration off is not a reason to leave a poll
  // behind that this milestone reads nothing further from.
  try {
    await firstSync
  } catch (cause: unknown) {
    client.stopClient()
    return { synced: false, reason: getErrorMessage(cause) }
  }

  const status: SessionSyncStatus = {
    synced: true,
    roomCount: client.getRooms().length,
    durationMs: Date.now() - startedAt,
  }
  client.stopClient()
  return status
}

function waitForFirstSync(
  client: SyncClient,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`sync did not complete within ${timeoutMs}ms`))
    }, timeoutMs)

    client.once('sync', state => {
      clearTimeout(timer)
      if (state === 'PREPARED' || state === 'SYNCING') {
        resolve()
      } else {
        reject(new Error(`sync entered state ${state}`))
      }
    })
  })
}

/**
 * Adapts a real matrix-js-sdk client to `SyncClient`, the one place this
 * module names the SDK's concrete type rather than the interface above.
 *
 * matrix-js-sdk's own `once` is generic over its full event-name union,
 * which no fixed structural type satisfies without a cast; confined here
 * rather than left at the call site so `fetchSessionSyncStatus` is called
 * with something already shaped correctly, not assembled inline alongside
 * an unrelated probe.
 */
export function makeSyncClient(
  client: ReturnType<typeof createClient>,
): SyncClient {
  return {
    isLoggedIn: () => client.isLoggedIn(),
    getCrypto: () => client.getCrypto(),
    startClient: () => client.startClient(),
    stopClient: () => client.stopClient(),
    getRooms: () => client.getRooms(),
    once: (event, handler) =>
      client.once(event as Parameters<typeof client.once>[0], handler),
  }
}
