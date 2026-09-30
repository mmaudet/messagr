import { membershipLeaveOf } from '../calls/transport'
import type { TimelineMachine } from '../timeline/buildTimeline'
import { fetchRoomMessages, toTimelineEntries } from '../timeline/buildTimeline'
import { fetchJoinedMembers, fetchJoinedRooms } from './encryptedSend'
import { getErrorMessage } from './errors'
import { EVERYTHING_SHOWN, shownOf, type NotShown } from './notShown'
import type { HttpRequester } from './pump'
import { howManyOthers, theOtherMember } from './vouch'

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
 * # A few round trips per conversation, and that is a limit
 *
 * A conversation's members and last messages are not in `/joined_rooms`, so
 * each one is asked for separately -- and who was here, for one this account
 * is alone in (#388). Fine for the handful a person has, and it is written
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
   * How many people other than this account are in it.
   *
   * `other` cannot answer this: it is `null` both for a conversation with
   * three people in it and for one this account is now alone in. A row needs
   * them apart -- there is a true sentence for the second and none for the
   * first. `null` when the membership could not be read, which is a third
   * thing again and not a zero.
   */
  readonly others: number | null
  /**
   * The one other participant who was in this conversation and is not any
   * more -- deleted, evicted or gone -- when this account is now alone in it.
   * Absent otherwise, and for a conversation somebody was only invited to.
   * #388: without it, the row lost the name it was given and said nobody had
   * ever joined.
   */
  readonly departed?: string
  /**
   * Set when this account is alone in the conversation and its memberships
   * could not be read: who was here is not known, which is not the same as
   * nobody. The row says « personne d'autre ici », true either way, and
   * `mergeSummaries` keeps a name it already had.
   */
  readonly membershipsUnread?: true
  /**
   * The opening of the last message this device could read, or `null`.
   *
   * Not truncated here. How many words fit is the screen's question, and a
   * value cut to a guess would be a value no screen could uncut.
   */
  readonly preview: string | null
  /**
   * Who wrote that opening, when there is one (#469): what lets a row read
   * from the notebook drop an opening a blocked account wrote, when it has no
   * `window` to be drawn again from.
   */
  readonly previewBy?: string
  /** Why there is no preview, when there is none. */
  readonly reason?: string
  /**
   * The homeserver's timestamp of the last event seen, or `0`.
   *
   * `0` sorts a conversation nothing has been said in to the bottom, which is
   * where it belongs — and it is a real answer rather than a missing one.
   */
  readonly lastAt: number
  /**
   * How much arrived since this device last looked at the conversation.
   *
   * Bounded by `LOOK_BACK`, and that bound is real rather than incidental:
   * this counts what it fetched, so a conversation left alone for a hundred
   * messages reports twelve. A row saying "at least twelve" is honest about a
   * list that is built from a window; a row extrapolating past its window
   * would not be. See `unread.ts` for where the mark comes from.
   */
  readonly unread: number
  /**
   * The messages this row was derived from, without what this device does
   * not draw (#469): what the row says is drawn again from them, at once and
   * with nothing asked, when an account is blocked (`listWithoutTheBlocked`).
   *
   * IN MEMORY ONLY. The notebook keeps a row's opening and nothing behind it
   * (`listCacheStore.ts`), and a row read from it has none.
   */
  readonly window?: readonly RowMessage[]
}

/**
 * One message of a row's window, as the row needs it: who sent it, when,
 * what it says, and whether it counts as unread.
 */
export interface RowMessage {
  readonly sender: string
  readonly sentAt: number
  /** `null` when this device could not read it. */
  readonly body: string | null
  /** Why it could not be read, when it could not. */
  readonly reason?: string
  /** Removed for everyone: a line, and no opening. */
  readonly removed?: boolean
  /**
   * Arrived after this device last looked at the conversation, from somebody
   * else: what `unread.ts` counts.
   */
  readonly unread: boolean
}

/**
 * What a row says when every message its window holds is one this device
 * does not draw (#469): hidden here, or written by a blocked account.
 *
 * NOT A FAILURE, and not « nothing has been said » either: something was
 * said, and none of it is to be shown. `mergeSummaries` keeps the row before
 * a derivation that failed, and a row that took this for one kept the
 * blocked account's opening and count for good.
 */
export const NOTHING_LEFT_TO_SHOW = 'nothing left to show'

/**
 * What a row says of its window: its opening and who wrote it, or why there
 * is none; when the last message came; and how many are unread.
 */
export function saidIn(
  window: readonly RowMessage[],
): Pick<
  ConversationSummary,
  'preview' | 'previewBy' | 'reason' | 'lastAt' | 'unread'
> {
  // The newest first, so the search below stops at the first readable one.
  const newest = [...window].sort((a, b) => b.sentAt - a.sentAt)
  const readable = newest.find(one => one.body !== null)
  return {
    preview: readable?.body ?? null,
    // Named separately from a missing preview, because "nothing has been
    // said" and "this device cannot read what was said" look identical on a
    // row and mean opposite things to the person reading it.
    ...(readable === undefined
      ? {
          reason:
            newest.length === 0
              ? NOTHING_LEFT_TO_SHOW
              : // A REMOVAL IS NOT A KEY THAT NEVER ARRIVED, and the row
                // said it was. A tombstone carries `body: null` like an
                // unreadable message and nothing else here told them
                // apart, so a conversation whose last message had been
                // deleted for everyone reported "this device cannot read
                // the last message" -- a fault claimed where the truth is
                // that somebody deleted something.
                newest[0]?.removed === true
                ? 'the last message was removed'
                : (newest[0]?.reason ??
                  'this device cannot read the last message'),
        }
      : { previewBy: readable.sender }),
    lastAt: newest[0]?.sentAt ?? 0,
    unread: window.filter(one => one.unread).length,
  }
}

/**
 * Most recently active first. Ties broken by the identifier so that two
 * conversations with the same timestamp do not swap places between
 * launches, which reads as movement nobody caused.
 */
export function byActivity(
  a: ConversationSummary,
  b: ConversationSummary,
): number {
  return b.lastAt - a.lastAt || a.scope.localeCompare(b.scope)
}

/**
 * A conversation and one other account in it: the other person of a
 * conversation of two, as the screen found them, or the account a gesture
 * made in it is about.
 */
export interface WithSomebody {
  readonly scope: string
  readonly other: string
}

/**
 * What blocking accounts does to a conversation (#469, #472, #494): it
 * leaves the list, and the screen with it; it stays, without what they
 * wrote; or which of the two is not known yet, and nothing is claimed.
 */
export type AfterTheBlock = 'leaves' | 'stays' | 'not known'

/**
 * What blocking `blocked` does to the conversation of `row`. THE ONE RULE:
 * the list reads it (`listWithoutTheBlocked`), and so does the conversation
 * open (`openAfterTheBlock`), which the screen that says what a block will
 * do and what is said once it is done read in turn.
 *
 * It leaves when it is the conversation with a blocked account: its other
 * person, or the one who left it when this account is alone in it now. It
 * stays when its row knows who is in it and it is not that: a conversation
 * of more than two, or one with somebody else. A row whose membership could
 * not be read does not know.
 */
export function rowAfterTheBlock(
  row: ConversationSummary,
  blocked: ReadonlySet<string>,
): AfterTheBlock {
  const withWhom = row.other ?? row.departed
  if (withWhom !== null && withWhom !== undefined && blocked.has(withWhom)) {
    return 'leaves'
  }
  return row.others === null || row.membershipsUnread === true
    ? 'not known'
    : 'stays'
}

/**
 * The conversation open, as the screen knows it: its scope, and its other
 * person once it has found one, `null` for a conversation of more than two
 * or before it knows.
 */
export interface OpenConversation {
  readonly scope: string
  readonly other: string | null
}

/**
 * The conversation `scope`, open, with the other person the screen found:
 * that person only when it was found for this conversation. The screen's
 * finding is the conversation open before this one's until this one has
 * asked who is in it.
 */
export function openConversationOf(
  scope: string,
  found: WithSomebody | null,
): OpenConversation {
  return { scope, other: found?.scope === scope ? found.other : null }
}

/**
 * What blocking `blocked` does to the conversation open (#472, #494): what
 * its row says, or, before the list has a row for it or while the row does
 * not know, what the conversation itself found of who is in it. A
 * conversation that leaves closes, whichever device made the block: open,
 * what is written in it would still leave.
 */
export function openAfterTheBlock(
  open: OpenConversation,
  rows: readonly ConversationSummary[],
  blocked: ReadonlySet<string>,
): AfterTheBlock {
  if (open.other !== null && blocked.has(open.other)) return 'leaves'
  const row = rows.find(one => one.scope === open.scope)
  const said = row === undefined ? 'not known' : rowAfterTheBlock(row, blocked)
  if (said !== 'not known') return said
  return open.other !== null ? 'stays' : 'not known'
}

/**
 * The conversations with a blocked account, whoever is in them now: those
 * a block takes off the list.
 */
export function scopesWithTheBlocked(
  rows: readonly ConversationSummary[],
  blocked: ReadonlySet<string>,
): readonly string[] {
  return rows
    .filter(row => rowAfterTheBlock(row, blocked) === 'leaves')
    .map(row => row.scope)
}

/**
 * The list as it is drawn once `blocked` are blocked (#469), with nothing
 * asked of anybody: the conversation with one of them leaves it, and every
 * other row is drawn again from its window without their messages -- its
 * opening, its time and its count, in the same draw as the block.
 *
 * A row with no window, read from the notebook, loses an opening a blocked
 * account wrote; what it says of the others waits for the next derivation.
 * The same list, handed back, when nobody is blocked.
 */
export function listWithoutTheBlocked(
  rows: readonly ConversationSummary[],
  blocked: ReadonlySet<string>,
): readonly ConversationSummary[] {
  if (blocked.size === 0) return rows
  let changed = false
  const drawn: ConversationSummary[] = []
  for (const row of rows) {
    if (rowAfterTheBlock(row, blocked) === 'leaves') {
      changed = true
      continue
    }
    const redrawn = rowWithout(row, blocked)
    if (redrawn !== row) changed = true
    drawn.push(redrawn)
  }
  return changed ? drawn.sort(byActivity) : rows
}

function rowWithout(
  row: ConversationSummary,
  blocked: ReadonlySet<string>,
): ConversationSummary {
  const { window } = row
  if (window === undefined) {
    if (row.previewBy === undefined || !blocked.has(row.previewBy)) return row
    return {
      ...whoAndWhere(row),
      preview: null,
      reason: NOTHING_LEFT_TO_SHOW,
      lastAt: row.lastAt,
      unread: row.unread,
    }
  }
  if (!window.some(one => blocked.has(one.sender))) return row
  const left = window.filter(one => !blocked.has(one.sender))
  return { ...whoAndWhere(row), ...saidIn(left), window: left }
}

/**
 * A row without what it says of its messages: whom it is with, and what is
 * known of who was there. What a redraw keeps, whatever a row comes to hold.
 */
function whoAndWhere({
  preview: _preview,
  previewBy: _previewBy,
  reason: _reason,
  lastAt: _lastAt,
  unread: _unread,
  window: _window,
  ...rest
}: ConversationSummary): Omit<
  ConversationSummary,
  'preview' | 'previewBy' | 'reason' | 'lastAt' | 'unread' | 'window'
> {
  return rest
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
  /** How far each conversation has been read here. Empty means none of them. */
  lastRead: ReadonlyMap<string, number>,
  /**
   * What this device does not draw: the messages hidden here, and the
   * conversation with a blocked account and its messages everywhere else
   * (#469). See `notShown.ts`.
   */
  notShown: NotShown = EVERYTHING_SHOWN,
): Promise<ConversationSummary[]> {
  const scopes = await fetchJoinedRooms(deps.http)

  // In parallel, and each one guarded on its own: a conversation whose
  // membership or history could not be read is a row that says so, not a
  // list that failed. The whole point of a list is that it survives one of
  // its rows going wrong.
  const summaries = await Promise.all(
    scopes.map(scope =>
      summarise(deps, scope, selfUserId, lastRead.get(scope) ?? 0, notShown),
    ),
  )

  return [...listWithoutTheBlocked(summaries, notShown.blocked)].sort(
    byActivity,
  )
}

async function summarise(
  deps: ConversationListDeps,
  scope: string,
  selfUserId: string,
  lastReadAt: number,
  notShown: NotShown,
): Promise<ConversationSummary> {
  let other: string | null = null
  let others: number | null = null
  try {
    const members = await fetchJoinedMembers(deps.http, scope)
    other = theOtherMember(members, selfUserId)
    others = howManyOthers(members, selfUserId)
  } catch {
    // Left null. A conversation whose membership could not be read is still a
    // conversation, and the row shows what it can.
  }
  // WHO WAS HERE, asked only of a conversation this account is alone in: one
  // more request, and only where the answer could change the row.
  let departed: string | undefined
  let membershipsUnread = false
  if (others === 0) {
    try {
      departed = whoWasHereAndLeft(
        await fetchMemberships(deps.http, scope),
        selfUserId,
      )
    } catch {
      membershipsUnread = true
    }
  }
  const whoWasHere = {
    ...(departed === undefined ? {} : { departed }),
    ...(membershipsUnread ? { membershipsUnread: true as const } : {}),
  }

  try {
    // Only the entries: a row shows the last thing said, and a reaction is
    // not something said. The reactions come back too and are dropped here
    // deliberately rather than by omission.
    const { entries: everything } = await toTimelineEntries(
      deps.machine,
      deps.decodeUtf8,
      scope,
      await fetchRoomMessages(deps.http, scope, LOOK_BACK),
    )
    // WITHOUT WHAT THIS DEVICE DOES NOT DRAW. Hiding a message and then
    // reading it in the list is the promise broken in the one place somebody
    // looks first, and the count would go on counting it too; a blocked
    // account's messages leave every row for the same reason (#469).
    const window: RowMessage[] = shownOf(everything, notShown).map(entry => ({
      sender: entry.claimedSender,
      sentAt: entry.sentAt,
      body: entry.body,
      ...(entry.reason === undefined ? {} : { reason: entry.reason }),
      ...(entry.removed === true ? { removed: true } : {}),
      // What `unread.ts` counts: after the mark, from somebody else.
      unread: entry.sentAt > lastReadAt && entry.claimedSender !== selfUserId,
    }))

    return {
      scope,
      other,
      others,
      ...whoWasHere,
      // NOTHING SAID, which is not NOTHING LEFT TO SHOW: `saidIn` says the
      // second when every message of the window is one this device does not
      // draw.
      ...(everything.length === 0
        ? {
            preview: null,
            reason: 'nothing has been said yet',
            lastAt: 0,
            unread: 0,
          }
        : saidIn(window)),
      window,
    }
  } catch (cause: unknown) {
    return {
      scope,
      other,
      others,
      ...whoWasHere,
      preview: null,
      reason: getErrorMessage(cause),
      lastAt: 0,
      // A conversation whose history could not be read has nothing this
      // device can count. `0` rather than a guess: a badge invented from a
      // failure is a number nobody can act on.
      unread: 0,
    }
  }
}

/** Everybody who ever had a membership in the conversation: `/members`. */
async function fetchMemberships(
  http: HttpRequester,
  scope: string,
): Promise<readonly unknown[]> {
  const answer = JSON.parse(
    await http.authedRequest(
      'GET',
      `/_matrix/client/v3/rooms/${encodeURIComponent(scope)}/members`,
      {},
      undefined,
    ),
  ) as { readonly chunk?: unknown }
  return Array.isArray(answer.chunk) ? answer.chunk : []
}

/**
 * The other participant who was in this conversation and is not any more, or
 * `undefined`. #388.
 *
 * `/joined_members` has forgotten them; `/members` has not. Its last word on
 * each person is a membership event, and `unsigned` carries the one before it
 * and who sent it -- measured on Continuwuity, 26 September 2026. A leave or
 * a ban after a join is somebody who was here: deleted, evicted or gone
 * (`membershipLeaveOf` says why a ban counts). After an invite, somebody who
 * never came in, which is the invitation nobody took up and keeps its own
 * sentence.
 *
 * NOT THE ACCOUNT THE SERVICE DREW. When a link is opened by somebody who
 * already has an account, the service's drawn account joins, invites that
 * account, then leaves and is deactivated (`claim.rs`): a leave after a join,
 * from an account nobody here ever talked to. Whoever sent an invitation
 * that `/members` still shows is that account, and is not named.
 *
 * THE MOST RECENT, WHEN MORE THAN ONE IS LEFT. Once the person it let in has
 * left too, their invitation is two events back and out of sight -- but the
 * drawn account always leaves first, so the latest departure is theirs.
 */
export function whoWasHereAndLeft(
  memberships: readonly unknown[],
  selfUserId: string,
): string | undefined {
  const inviters = new Set<string>()
  const departures: { readonly who: string; readonly at: number }[] = []
  for (const event of memberships) {
    const member = event as {
      readonly sender?: unknown
      readonly origin_server_ts?: unknown
      readonly content?: { readonly membership?: unknown }
      readonly unsigned?: {
        readonly prev_content?: { readonly membership?: unknown }
        readonly prev_sender?: unknown
      }
    }
    const before = member.unsigned?.prev_content?.membership
    if (
      member.content?.membership === 'invite' &&
      typeof member.sender === 'string'
    ) {
      inviters.add(member.sender)
    }
    const beforeBy = member.unsigned?.prev_sender
    if (before === 'invite' && typeof beforeBy === 'string') {
      inviters.add(beforeBy)
    }
    const who = membershipLeaveOf(event)
    if (who === undefined || who === selfUserId || before !== 'join') continue
    const at = member.origin_server_ts
    departures.push({ who, at: typeof at === 'number' ? at : 0 })
  }
  return departures
    .filter(departure => !inviters.has(departure.who))
    .sort((a, b) => b.at - a.at)[0]?.who
}
