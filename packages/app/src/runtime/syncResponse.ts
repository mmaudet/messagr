import type { HttpRequester } from './pump'

/**
 * Reading a `/sync` response, and fetching one.
 *
 * `syncDelta.ts` reduces a sync response to the crypto machine's slice and
 * documents why that reduction has to exist at all. This module is the layer
 * underneath it: the request itself, and the two ordinary reads a loop needs
 * that have nothing to do with encryption — where to resume from, and which
 * conversations moved.
 *
 * They are separated because they change for different reasons. The
 * encryption slice changes when the bridge's `SyncDelta` changes; these two
 * change when the loop's needs change. Folding them together would put the
 * documented workaround and ordinary field access in one module with one
 * name for two jobs.
 *
 * Nothing here is typed against matrix-js-sdk's sync models. ADR-0005 keeps
 * the timeline the application's own state, and adopting the SDK's response
 * types would be the first step back towards its room model. A sync response
 * is read here as what it is on the wire: JSON.
 */

/** How long the homeserver may hold a poll open, in milliseconds. */
export const LONG_POLL_TIMEOUT_MS = 30_000

/**
 * Fetches one `/sync`, over the same authenticated-request escape hatch the
 * outgoing pump uses, and parses it.
 *
 * `since` is omitted rather than sent empty on the first poll of an install:
 * the homeserver reads an absent token as "everything you would tell a new
 * client" and an empty one as a malformed parameter.
 *
 * `timeoutMs` of 0 makes this a single non-blocking round trip, which is what
 * the pump wants; anything larger makes the homeserver hold the connection
 * until something happens, which is what the loop wants. It is a parameter
 * rather than two functions because it is the only difference between them.
 */
export async function fetchSync(
  http: HttpRequester,
  since: string | null,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  const queryParams: Record<string, string> = { timeout: String(timeoutMs) }
  if (since !== null) queryParams.since = since
  const responseJson = await http.authedRequest(
    'GET',
    '/_matrix/client/v3/sync',
    queryParams,
    undefined,
  )
  return JSON.parse(responseJson) as Record<string, unknown>
}

/**
 * Where the next poll resumes from, or `null` when the response carries no
 * token at all.
 *
 * `null` rather than a throw because a response without one is not an error
 * the loop can act on differently: it polls again from where it was. A token
 * of the wrong type is treated the same way, since a homeserver that sent a
 * number is one this cannot resume against either.
 */
export function readNextBatch(sync: Record<string, unknown>): string | null {
  const token = sync.next_batch
  return typeof token === 'string' && token.length > 0 ? token : null
}

/**
 * Which joined conversation spaces this response says moved.
 *
 * A space is reported when its timeline carries any event, which covers both
 * a message arriving and a membership changing — the caller re-derives the
 * conversation either way, so distinguishing them here would be a
 * distinction nothing downstream acts on.
 *
 * Invites and leaves are deliberately not read. Nothing in this application
 * shows either yet, and a field read by nobody is a field that goes stale
 * without anything failing.
 */
export function readChangedScopes(
  sync: Record<string, unknown>,
): readonly string[] {
  const rooms = asRecord(sync.rooms)
  const joined = asRecord(rooms?.join)
  if (joined === null) return []
  return Object.keys(joined).filter(scope => {
    const timeline = asRecord(asRecord(joined[scope])?.timeline)
    return Array.isArray(timeline?.events) && timeline.events.length > 0
  })
}

/**
 * `null` for anything that is not a plain object, arrays included. Every read
 * above walks a path the homeserver could have sent differently, and a walk
 * that assumed its shape would turn a strange response into a crash inside
 * the loop rather than a poll that found nothing.
 */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}
