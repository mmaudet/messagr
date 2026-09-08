import { displayNameFor, type GivenNames } from './givenName'
import type { HttpRequester } from './pump'
import { readChangedScopes, readTimelineEvents } from './syncResponse'
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
 * # A CALL IS NOT A MESSAGE, AND IT IS FOUND IN THE SAME SYNC
 *
 * A ringing telephone and a message that arrived are the same push and the
 * same poll, and they are not the same notification: one is a line on a lock
 * screen and the other takes the screen. So this returns both out of one
 * sync rather than syncing twice -- on a wake, the second round trip is
 * ninety seconds of somebody's invitation spent on a request that asks what
 * the first one already answered.
 *
 * They are also found differently. A message comes out of the conversation
 * this device derives; a call comes out of the raw events, because
 * `buildTimeline` deliberately draws no bubble for `m.call.*` and would
 * hand back a conversation with the invitation missing from it.
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
  /**
   * Opens the sealed events of one conversation and answers the `m.call.*`
   * among them, in order. `inbox.ts`'s `openCallEvents`, bound to the
   * device's crypto machine by whoever calls this.
   */
  readonly openCalls: (
    scope: string,
    events: readonly unknown[],
  ) => Promise<readonly unknown[]>
  readonly names: GivenNames
  readonly selfUserId: string
  /** How far each conversation had been read here before the wake. */
  readonly lastRead: ReadonlyMap<string, number>
}

/** Somebody calling, found in a poll nobody was watching. */
export interface Ringing {
  readonly scope: string
  /** Who is calling, as this device would show them. */
  readonly shown: string
  /** Their identifier, which is what a call has to be answered towards. */
  readonly from: string
}

/**
 * How old an invitation may be and still be worth ringing for.
 *
 * The specification's own default lifetime for `m.call.invite` is ninety
 * seconds, and the transport already refuses a stale one. This is the same
 * bound applied one stage earlier, so that a wake replaying a poll from
 * before the application was closed does not ring a telephone about a call
 * that ended ten minutes ago -- which is what a cursor deliberately left
 * unadvanced makes possible.
 */
const RINGS_FOR_MS = 90_000

export interface WhatArrived {
  readonly messages: readonly Arrival[]
  /**
   * Calls, and they come first wherever both exist. A telephone that draws a
   * message notification over a ringing call is a telephone somebody misses
   * a call on.
   */
  readonly ringing: readonly Ringing[]
}

export async function lookForWhatArrived(
  looking: Looking,
): Promise<WhatArrived> {
  const sync = await fetchOnce(looking.http, looking.since)
  const changed = readChangedScopes(sync)
  if (changed.length === 0) return { messages: [], ringing: [] }

  const names = await looking.names.all()
  const ringing = await whoIsCalling(looking, sync, names)
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

  return { messages: found, ringing }
}

/**
 * Who is calling, out of the raw events the same sync carried.
 *
 * # THE INVITATION IS THE ONLY EVENT WORTH WAKING A TELEPHONE FOR
 *
 * A poll replayed from an unadvanced cursor carries whatever the call
 * exchanged -- the answer, the candidates, the hangup. Ringing for any of
 * those would ring for a call that is already over, or already running on
 * this very device. Only `m.call.invite` is somebody asking.
 *
 * # AND ITS OWN AGE DECIDES, NOT THE POLL'S
 *
 * `unsigned.age` is how long ago the homeserver received it, and it is the
 * one thing here that survives the cursor being left where it was: a wake
 * that replays yesterday's poll sees yesterday's invitation looking exactly
 * as new as one from a second ago. `inbox.ts` carries the field through the
 * decryption for this.
 */
async function whoIsCalling(
  looking: Looking,
  sync: Record<string, unknown>,
  names: ReadonlyMap<string, string>,
): Promise<readonly Ringing[]> {
  const found: Ringing[] = []
  for (const [scope, events] of readTimelineEvents(sync)) {
    // Guarded per conversation, like the messages below: one conversation
    // this device holds no key for must not silence a call in another.
    try {
      for (const event of await looking.openCalls(scope, events)) {
        const call = event as {
          type?: unknown
          sender?: unknown
          unsigned?: { age?: unknown }
        }
        if (call.type !== 'm.call.invite') continue
        if (typeof call.sender !== 'string') continue
        // This account's own invitation, placed from another of its devices.
        // Ringing here would be a telephone ringing at the person holding
        // the one that is calling.
        if (call.sender === looking.selfUserId) continue
        const age = call.unsigned?.age
        if (typeof age === 'number' && age > RINGS_FOR_MS) continue
        found.push({
          scope,
          from: call.sender,
          shown: displayNameFor(call.sender, names.get(call.sender)),
        })
        break
      }
    } catch {
      // Nothing to report to, and a call that could not be read is a call
      // this device could not have answered anyway.
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
