import type { CallRecord } from './callLogStore'
import { errcodeOf, getErrorMessage } from './errors'
import type { HttpRequester } from './pump'
import type { KeptMessage } from './readFavourites'
import { withinTheDeadline } from './serviceDeadline'
import { asRecord } from './syncResponse'
import type { UntoldBlocks } from './untoldBlocksStore'

/**
 * Blocking an account, from the panel of the person (#469, #462, ADR 0015).
 *
 * # THREE THINGS, IN THIS ORDER
 *
 * 1. **The account's ignored list** (`m.ignored_user_list`, the account's
 *    global account data), read, changed and written back, keeping every
 *    entry it had. From then on the homeserver hides what that account
 *    sends -- earlier messages too, encrypted ones included -- and its
 *    notifications, receipts and invitations: measured on Continuwuity,
 *    which hides them at read time.
 * 2. **The screens, at once.** The conversation leaves the list, and that
 *    account's messages leave every conversation and every preview, those
 *    already received included. Nothing waits for the homeserver to be asked
 *    again, nor for the service.
 * 3. **The invitation service**, which keeps the same block as « Refuser et
 *    bloquer » (#406): what stops the account's invitations delivered inside
 *    Messagr, which the homeserver never sees, and what the operator's daily
 *    count reads (`services/invitations`, `handlers::blocks`).
 *
 * If the list cannot be read or written, nothing has changed, and the screen
 * says so. If only the service fails, the block holds on the homeserver and
 * the screen says what waits: a page of the notebook keeps the account
 * (`untoldBlocksStore.ts`), and each launch asks again until the service has
 * heard it (`tellWhatIsWaiting`).
 *
 * # DERIVED FROM THE HOMESERVER'S LIST, AND WHAT THAT COSTS
 *
 * What leaves the screens is read from the ignored list the homeserver keeps
 * and the sync loop brings to every device of the account (`ignoredInSync`):
 * another telephone of the same account hides the same conversation, and a
 * list emptied elsewhere shows it again. The price is the one ADR 0015 names:
 * « The homeserver's account data now shows who ignores whom », as the
 * service's database already shows who blocked whom.
 *
 * It is the price `hiddenStore.ts` refused to pay for « supprimer pour moi »:
 * a hiding put in the account's server-side data would tell the homeserver
 * which messages somebody wanted out of their sight, sharper than most
 * content. A block pays it, because a block is what the homeserver must act
 * on: it is the one that holds the account's messages back.
 *
 * The device keeps two things of its own, and neither decides anything. A
 * cache of the list as the homeserver last said it (`ignoredListStore.ts`),
 * so that a launch hides what it must before any network; it is replaced
 * whole by every read and every sync that carries the list. And the accounts
 * whose block the service has not heard of yet, until it has.
 *
 * # THE CONVERSATION IS NEVER LEFT
 *
 * Leaving it would tell the blocked account, which sees the membership
 * change. The device stays in it; the list stops drawing it.
 */

/** The account data type Matrix keeps the ignored accounts under. */
export const IGNORED_LIST = 'm.ignored_user_list'

/** What the gesture needs, so the whole of it is testable without a device. */
export interface Blocking {
  readonly http: HttpRequester
  readonly selfUserId: string
  /**
   * Hands the new ignored list to what draws the screens. Called once the
   * list is written and before the service is told: the screens do not wait.
   */
  readonly nowIgnored: (ignored: ReadonlySet<string>) => void
  /** The accounts whose block the service has not heard of yet. */
  readonly untold: UntoldBlocks
  /**
   * `POST /blocks` on the invitation service, answering its HTTP status. A
   * throw is a service nobody reached.
   */
  readonly tellTheService: (blocked: string) => Promise<number>
  /** Resolves after `ms`: how long the service is waited for. */
  readonly after: (ms: number) => Promise<void>
}

/** The ways a block ends. */
export type BlockOutcome =
  /** The ignored list was not written: nothing has changed. */
  | { readonly blocked: false; readonly reason: string }
  /** Written, off the screens, and recorded by the service. */
  | { readonly blocked: true; readonly told: true }
  /**
   * Written and off the screens; the service has not heard of it. `kept`
   * says whether this device kept it to ask again at the next launch.
   */
  | { readonly blocked: true; readonly told: false; readonly kept: boolean }

/**
 * What the list says after a block: done, done with the service's record
 * waiting for the next launch, or done with nothing kept to ask again.
 */
export type BlockNotice = 'blocked' | 'waiting' | 'not-kept'

/**
 * What the screens say after a block (#469, #472): how it ended, and the
 * conversation it was made from when that one stays, in the list and open,
 * which a conversation of more than two does. `null` when it left the list.
 */
export interface BlockSaid {
  readonly notice: BlockNotice
  readonly stays: string | null
}

/**
 * The list's sentence for an outcome, or `null` when nothing changed: the
 * panel says that one, where the gesture was made.
 */
export function noticeOf(outcome: BlockOutcome): BlockNotice | null {
  if (!outcome.blocked) return null
  if (outcome.told) return 'blocked'
  return outcome.kept ? 'waiting' : 'not-kept'
}

/** Blocks `blocked`, in the order the module says. Never throws. */
export async function blockAccount(
  deps: Blocking,
  blocked: string,
): Promise<BlockOutcome> {
  let ignored: ReadonlySet<string>
  try {
    ignored = await ignoredWith(deps.http, deps.selfUserId, blocked)
  } catch (cause: unknown) {
    return { blocked: false, reason: getErrorMessage(cause) }
  }

  deps.nowIgnored(ignored)

  // KEPT BEFORE THE SERVICE IS ASKED, so that a launch killed while it waits
  // still has something to ask again.
  const kept = await deps.untold.remember(blocked)
  // A YES THAT COMES LATE STILL COUNTS: the service has the block, and the
  // page lets it go, even after the screen has said it waits.
  const telling = heardBy(deps, blocked).then(async heard => {
    if (heard) await deps.untold.forget(blocked)
    return heard
  })
  const told = await withinTheDeadline(telling, deps.after, false)
  return told
    ? { blocked: true, told: true }
    : { blocked: true, told: false, kept }
}

/**
 * Asks the service again about every block it has not heard of, as a launch
 * does. How many it heard of this time, and how many still wait.
 */
export async function tellWhatIsWaiting(deps: {
  readonly untold: UntoldBlocks
  readonly tellTheService: (blocked: string) => Promise<number>
}): Promise<{ readonly told: number; readonly waiting: number }> {
  const waiting = await deps.untold.all()
  let told = 0
  // One at a time: a launch has more pressing requests than these.
  for (const blocked of waiting) {
    if (await heardBy(deps, blocked)) {
      await deps.untold.forget(blocked)
      told += 1
    }
  }
  return { told, waiting: waiting.length - told }
}

/**
 * The accounts this account ignores, as its homeserver keeps them: none when
 * it never kept a list. Throws when the homeserver did not say, which is not
 * knowing, and not the same as nobody.
 */
export async function readIgnored(
  http: HttpRequester,
  selfUserId: string,
): Promise<ReadonlySet<string>> {
  return accountsIn(await readTheList(http, selfUserId))
}

/**
 * What a sync response says the ignored list is now, or `null` when it says
 * nothing of it: a sync resumed from a cursor carries account data only when
 * it changed.
 */
export function ignoredInSync(
  sync: Record<string, unknown>,
): ReadonlySet<string> | null {
  const events = asRecord(sync.account_data)?.events
  if (!Array.isArray(events)) return null
  let found: ReadonlySet<string> | null = null
  for (const event of events) {
    const read = asRecord(event)
    if (read?.type !== IGNORED_LIST) continue
    const content = asRecord(read.content)
    // The last one wins, as the homeserver sends the latest last.
    if (content !== null) found = accountsIn(content)
  }
  return found
}

/**
 * The messages kept in Favoris without those of a blocked account: what it
 * wrote leaves every screen, this one included.
 */
export function keptWithoutTheBlocked(
  kept: readonly KeptMessage[],
  blocked: ReadonlySet<string>,
): readonly KeptMessage[] {
  if (blocked.size === 0) return kept
  return kept.filter(
    one => one.entry === null || !blocked.has(one.entry.claimedSender),
  )
}

/**
 * The calls tab without the calls of a blocked account (#494), whichever way
 * they went: what it wrote leaves every screen, and a row of the tab is also
 * a « Rappeler » that would ring it. The same list, handed back, when nobody
 * is blocked.
 */
export function callsWithoutTheBlocked(
  calls: readonly CallRecord[],
  blocked: ReadonlySet<string>,
): readonly CallRecord[] {
  if (blocked.size === 0) return calls
  return calls.filter(call => !blocked.has(call.peerUserId))
}

/**
 * Whether a call may be placed to `peer` (#494): never to a blocked account,
 * whatever the gesture. The homeserver holds back what that account sends,
 * never what this one sends it, so a call placed would ring its telephone.
 */
export function mayCall(peer: string, blocked: ReadonlySet<string>): boolean {
  return !blocked.has(peer)
}

/** Whether two ignored lists name the same accounts. `null` is not knowing. */
export function sameAccounts(
  one: ReadonlySet<string>,
  other: ReadonlySet<string> | null,
): boolean {
  return (
    other !== null &&
    one.size === other.size &&
    [...one].every(account => other.has(account))
  )
}

/**
 * Reads the ignored list, adds `blocked` keeping every entry and every field
 * it had, and writes it back when it changed. The accounts it names now.
 *
 * READ BEFORE WRITTEN, ALWAYS: account data is replaced whole, and a list
 * written without being read -- or over a read that did not answer -- would
 * drop every account blocked before.
 */
async function ignoredWith(
  http: HttpRequester,
  selfUserId: string,
  blocked: string,
): Promise<ReadonlySet<string>> {
  const content = await readTheList(http, selfUserId)
  const users = asRecord(content.ignored_users) ?? {}
  if (!(blocked in users)) {
    await http.authedRequest(
      'PUT',
      listPath(selfUserId),
      {},
      JSON.stringify({
        ...content,
        ignored_users: { ...users, [blocked]: {} },
      }),
    )
  }
  return new Set([...Object.keys(users), blocked])
}

/**
 * The list's content, or an empty one when the account never had a list.
 *
 * ONLY `M_NOT_FOUND` SAYS THAT: the specification's answer for account data
 * never written. Any other refusal, a 404 without that code included, is not
 * knowing: taken for an empty list, it would be written back over the list
 * there is, and every account blocked before would come back.
 */
async function readTheList(
  http: HttpRequester,
  selfUserId: string,
): Promise<Record<string, unknown>> {
  let answer: string
  try {
    answer = await http.authedRequest(
      'GET',
      listPath(selfUserId),
      {},
      undefined,
    )
  } catch (cause: unknown) {
    if (errcodeOf(cause) === 'M_NOT_FOUND') return {}
    throw cause
  }
  const read = asRecord(JSON.parse(answer) as unknown)
  if (read === null) throw new Error('the ignored list is not an object')
  return read
}

/** Whether the service heard of the block: a success, and nothing else. */
async function heardBy(
  deps: { readonly tellTheService: (blocked: string) => Promise<number> },
  blocked: string,
): Promise<boolean> {
  try {
    const status = await deps.tellTheService(blocked)
    return status >= 200 && status < 300
  } catch {
    return false
  }
}

function listPath(selfUserId: string): string {
  return `/_matrix/client/v3/user/${encodeURIComponent(selfUserId)}/account_data/${IGNORED_LIST}`
}

function accountsIn(content: Record<string, unknown>): ReadonlySet<string> {
  return new Set(Object.keys(asRecord(content.ignored_users) ?? {}))
}
