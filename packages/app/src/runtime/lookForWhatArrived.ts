import { displayNameFor, type GivenNames } from './givenName'
import type { HttpRequester } from './pump'
import { readChangedScopes } from './syncResponse'
import type { Arrival } from './wake'

/**
 * What a woken device finds when it goes and looks.
 *
 * # It starts from nothing, because nothing arrived
 *
 * The push carried `{"prio":"high"}` and a meaningless identifier
 * (`services/invitations`, `handlers::wake`). So this cannot start from the
 * message: there is no message. It starts from the device's own cursor, asks
 * what changed, and reads it.
 *
 * # The cursor is not advanced, and that is deliberate
 *
 * A wake syncs to see what is there. Writing the new cursor would mean the
 * application's own loop, when it next runs, starts *after* what the wake
 * saw — and if the wake failed to draw anything, that message would be
 * missing from the conversation with nothing to say why. So this reads and
 * puts the cursor back untouched: seeing something twice costs a redraw,
 * losing it costs a message.
 *
 * # One arrival per conversation, and only from somebody else
 *
 * A notification per message would be a phone that buzzes eleven times for a
 * conversation somebody is in the middle of. And this account's own messages
 * — sent from another of its devices — are not arrivals: a notification for
 * something you just wrote is the clearest possible way of saying the
 * notifications mean nothing.
 */

export interface Looking {
  readonly http: HttpRequester
  /** The persisted cursor. `null` on a device that has never synced. */
  readonly since: string | null
  /** Decrypts a conversation and answers its entries, newest last. */
  readonly readConversation: (scope: string) => Promise<
    readonly {
      readonly claimedSender: string
      readonly sentAt: number
      readonly body: string | null
    }[]
  >
  readonly names: GivenNames
  readonly selfUserId: string
  /** How far each conversation had been read here before the wake. */
  readonly lastRead: ReadonlyMap<string, number>
}

export async function lookForWhatArrived(
  looking: Looking,
): Promise<readonly Arrival[]> {
  const sync = await fetchOnce(looking.http, looking.since)
  const changed = readChangedScopes(sync)
  if (changed.length === 0) return []

  const names = await looking.names.all()
  const found: Arrival[] = []

  for (const scope of changed) {
    // Each guarded on its own. One conversation this device holds no key for
    // must not silence the one it can read -- and in a headless context there
    // is no screen on which to notice that it did.
    try {
      const entries = await looking.readConversation(scope)
      const mark = looking.lastRead.get(scope) ?? 0
      const newest = entries
        .filter(
          entry =>
            entry.sentAt > mark && entry.claimedSender !== looking.selfUserId,
        )
        .at(-1)
      if (newest === undefined) continue

      found.push({
        scope,
        shown: displayNameFor(
          newest.claimedSender,
          names.get(newest.claimedSender),
        ),
        // A message this device cannot read is still a message that arrived.
        // It says so rather than being dropped, which is what the
        // conversation itself does with the same event.
        preview: newest.body ?? '',
      })
    } catch {
      // Nothing to report to. The blind notification is what covers a wake
      // that found nothing readable, and `wake.ts` draws it when this
      // answers empty.
    }
  }

  return found
}

/**
 * One poll, with no timeout: a wake has seconds, not thirty of them.
 *
 * Written here rather than reusing the loop's `fetchSync`, which takes a
 * long-poll timeout — a headless context that blocked for thirty seconds
 * would be killed by the system before it drew anything.
 */
async function fetchOnce(
  http: HttpRequester,
  since: string | null,
): Promise<Record<string, unknown>> {
  const query =
    since === null
      ? '?timeout=0'
      : `?timeout=0&since=${encodeURIComponent(since)}`
  const body = await http.authedRequest(
    'GET',
    `/_matrix/client/v3/sync${query}`,
    {},
    undefined,
  )
  const parsed: unknown = JSON.parse(body)
  return parsed !== null && typeof parsed === 'object'
    ? (parsed as Record<string, unknown>)
    : {}
}
