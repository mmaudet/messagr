import type { SyncDelta } from 'react-native-matrix-crypto'

import type { HttpRequester } from './pump'

/**
 * The documented workaround for ADR-0001's second named exposure.
 *
 * matrix-js-sdk consumes `device_lists` and `device_one_time_keys_count`
 * internally (`processDeviceLists` / `processKeyCounts` in its own
 * `sync.ts`) and drops both when no crypto is configured, and no public
 * accessor reads either back out of a `ClientEvent.Sync` payload —
 * `ISyncStateData` carries only sync tokens and status, never the response
 * body. Bypassing the SDK's own sync processing with a raw fetch, over the
 * same authenticated-request escape hatch the outgoing pump uses, is what
 * recovers them: this reads the response the SDK's internal loop already
 * discarded, before it has the chance to.
 *
 * `HttpRequester` and `encryptionSlice` are both injected rather than
 * imported: the former to stay free of matrix-js-sdk here exactly as
 * `sessionSync.ts` does for `SyncClient`, the latter because
 * `react-native-matrix-crypto`'s package entry point cannot be imported at
 * all under Vitest — it installs a native JSI host object as a side effect —
 * so even a pure function re-exported from it has to cross this boundary as
 * a parameter, not an import. `HttpRequester` itself is `pump.ts`'s own —
 * imported rather than redeclared, so the two pieces of the pump cannot
 * silently drift into two different shapes for the same thing.
 */
export type EncryptionSliceFn = (sync: Record<string, unknown>) => SyncDelta

/**
 * Fetches one raw `/sync` and reduces it to the crypto machine's slice via
 * `encryptionSlice`.
 *
 * `timeout=0` always: this is not the app's live sync loop (`sessionSync.ts`
 * already runs and stops one of those), it is a single, deliberately
 * non-blocking round trip whose only purpose is to recover the two fields
 * the SDK's own loop cannot hand back.
 *
 * No `since` token, and none returned: one fetch per pump cycle is all this
 * increment needs, and a continuation token nothing persists or reads back
 * would be plumbing for a caller that does not exist yet. The ticket that
 * first pumps more than once is the one that should decide where such a
 * token lives.
 */
export async function fetchEncryptionSyncDelta(
  http: HttpRequester,
  encryptionSlice: EncryptionSliceFn,
): Promise<SyncDelta> {
  const responseJson = await http.authedRequest(
    'GET',
    '/_matrix/client/v3/sync',
    { timeout: '0' },
    undefined,
  )
  const sync = JSON.parse(responseJson) as Record<string, unknown>
  return encryptionSlice(sync)
}
