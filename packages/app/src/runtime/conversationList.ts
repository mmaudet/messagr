import type { TimelineMachine } from '../timeline/buildTimeline'
import { fetchRoomMessages, toTimelineEntries } from '../timeline/buildTimeline'
import { fetchJoinedMembers, fetchJoinedRooms } from './encryptedSend'
import { getErrorMessage } from './errors'
import type { HttpRequester } from './pump'
import { theOtherMember } from './vouch'

/**
 * The list of conversations, derived rather than stored.
 *
 * ADR-0006 keeps nothing decrypted on disk, so this is built on every launch
 * out of what the homeserver holds and what this device can decrypt — the
 * same bargain the conversation itself makes, for the same reason, and it is
 * why a device that lost its keys shows a legible list of unreadable
 * conversations rather than nothing at all.
 *
 * # Why not from the sync loop
 *
 * The loop has a sync response in hand and it looks like the obvious source.
 * It is not: a relaunch resumes from a persisted cursor, so its first
 * response carries only what changed since — which for a quiet account is
 * nothing, and a list built from it would be empty. The loop says *when* a
 * conversation moved (ADR-0007); this says *what the conversations are*.
 *
 * # One round trip per conversation, and that is a limit
 *
 * A conversation's last message is not in `/joined_rooms`, so each one is
 * asked for separately. Fine for the handful a person has, and it is written
 * down here rather than discovered: the day somebody has two hundred, this
 * needs a different shape, not a bigger `Promise.all`.
 */

export interface ConversationSummary {
  /** The conversation space's identifier. */
  readonly scope: string
  /**
   * The other participant, when there is exactly one — which is what makes a
   * conversation direct. `null` for anything else, including a conversation
   * whose membership could not be read.
   */
  readonly other: string | null
  /**
   * The opening of the last message this device could read, or `null`.
   *
   * Not truncated here. How many words fit is the screen's question, and a
   * value cut to a guess would be a value no screen could uncut.
   */
  readonly preview: string | null
  /** Why there is no preview, when there is none. */
  readonly reason?: string
  /**
   * The homeserver's timestamp of the last event seen, or `0`.
   *
   * `0` sorts a conversation nothing has been said in to the bottom, which is
   * where it belongs — and it is a real answer rather than a missing one.
   */
  readonly lastAt: number
}

export interface ConversationListDeps {
  readonly http: HttpRequester
  readonly machine: TimelineMachine
  readonly decodeUtf8: (bytes: Uint8Array) => string
}

/**
 * How many events to ask for per conversation.
 *
 * More than one, because the last event is often not a message: a membership
 * change, a power-level change, or a message this device holds no key for.
 * Asking for one would show an empty preview on a conversation that has
 * plenty to show.
 */
const LOOK_BACK = 12

export async function fetchConversationSummaries(
  deps: ConversationListDeps,
  selfUserId: string,
): Promise<ConversationSummary[]> {
  const scopes = await fetchJoinedRooms(deps.http)

  // In parallel, and each one guarded on its own: a conversation whose
  // membership or history could not be read is a row that says so, not a
  // list that failed. The whole point of a list is that it survives one of
  // its rows going wrong.
  const summaries = await Promise.all(
    scopes.map(scope => summarise(deps, scope, selfUserId)),
  )

  // Most recently active first. Ties broken by the identifier so that two
  // conversations with the same timestamp do not swap places between
  // launches, which reads as movement nobody caused.
  return summaries.sort(
    (a, b) => b.lastAt - a.lastAt || a.scope.localeCompare(b.scope),
  )
}

async function summarise(
  deps: ConversationListDeps,
  scope: string,
  selfUserId: string,
): Promise<ConversationSummary> {
  let other: string | null = null
  try {
    other = theOtherMember(
      await fetchJoinedMembers(deps.http, scope),
      selfUserId,
    )
  } catch {
    // Left null. A conversation whose membership could not be read is still a
    // conversation, and the row shows what it can.
  }

  try {
    const entries = await toTimelineEntries(
      deps.machine,
      deps.decodeUtf8,
      scope,
      await fetchRoomMessages(deps.http, scope, LOOK_BACK),
    )
    // The newest first, so the search below stops at the first readable one.
    const newest = [...entries].sort((a, b) => b.sentAt - a.sentAt)
    const readable = newest.find(entry => entry.body !== null)

    return {
      scope,
      other,
      preview: readable?.body ?? null,
      // Named separately from a missing preview, because "nothing has been
      // said" and "this device cannot read what was said" look identical on a
      // row and mean opposite things to the person reading it.
      ...(readable === undefined
        ? {
            reason:
              newest.length === 0
                ? 'nothing has been said yet'
                : (newest[0]?.reason ??
                  'this device cannot read the last message'),
          }
        : {}),
      lastAt: newest[0]?.sentAt ?? 0,
    }
  } catch (cause: unknown) {
    return {
      scope,
      other,
      preview: null,
      reason: getErrorMessage(cause),
      lastAt: 0,
    }
  }
}
