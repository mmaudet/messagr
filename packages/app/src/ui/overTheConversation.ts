import {
  openAfterTheBlock,
  type AfterTheBlock,
  type ConversationSummary,
  type OpenConversation,
  type WithSomebody,
} from '../runtime/conversationList'
import { allShown } from '../runtime/notShown'
import type { TimelineEntry } from '../timeline/mergeTimeline'
import type { Plate } from '../timeline/plates'
import {
  forwardingWithoutTheBlocked,
  selectionWithoutTheBlocked,
} from '../timeline/selection'
import type { OpenReport } from './reportStage'

/**
 * What is drawn over the conversation open, and the one way it is put down
 * (#494, #498): whether the conversation is left, another opened in its
 * place, a block closes it or keeps it open, or a share that failed takes
 * the person back to the list.
 *
 * They were written inline in `App.tsx`, where nothing could test them, and
 * one of them closed the conversation by hand: a share that failed left the
 * sheets, the forward picker and the photograph full screen standing over
 * the list. They are here, pure, and `App.tsx` calls them with its setters,
 * as `reportStage.ts` asks of it (#491).
 */

/**
 * A piece of the screen's state, as React holds it: set to a value, or
 * changed from the one it holds.
 */
export type Setter<T> = (next: T | ((held: T) => T)) => void

/** A photograph open full screen: its plate, and at which of them. */
export interface OpenPlate {
  readonly plate: Plate
  readonly at: number
}

/** Everything that can be drawn over the conversation open, each its setter. */
export interface OverTheConversation {
  /** The selection mode: empty, it is gone. */
  readonly setSelected: Setter<ReadonlySet<string>>
  /** The trust screen about the other person. */
  readonly setTrust: (next: null) => void
  /** The panel of the person. */
  readonly setPersonOpen: (next: false) => void
  /** « Bloquer l'expéditeur »'s sheet (#472). */
  readonly setBlockingSender: Setter<WithSomebody | null>
  /** The report's sheet (#468). */
  readonly setReporting: Setter<OpenReport | null>
  /** The removal's sheet. */
  readonly setRemoving: (next: false) => void
  /** The messages waiting in the forward picker, while it is up. */
  readonly setForwarding: Setter<readonly string[] | null>
  /** A photograph full screen. */
  readonly setOpenPlate: Setter<OpenPlate | null>
}

/** The screen a conversation is open on: it, and what is over it. */
export interface TheConversationScreen extends OverTheConversation {
  /** No conversation open any more. */
  readonly closeTheConversation: () => void
}

/**
 * The same, with what the list is drawn under: its tab, and the panels that
 * open over it.
 */
export interface TheListScreen extends TheConversationScreen {
  readonly setTab: (next: 'chat') => void
  readonly setInvite: (next: { readonly stage: 'shut' }) => void
  readonly setPlusOpen: (next: false) => void
  readonly setAdmission: (next: null) => void
}

/**
 * Puts down everything drawn over the conversation open, with it or when
 * another opens in its place (#494). Left up, each outlived its
 * conversation: the removal sheet opened again in the next one, the others
 * stood over the list.
 */
export function putDownWhatIsOver(screen: OverTheConversation): void {
  screen.setSelected(new Set())
  screen.setTrust(null)
  screen.setPersonOpen(false)
  screen.setBlockingSender(null)
  screen.setReporting(null)
  screen.setRemoving(false)
  screen.setForwarding(null)
  screen.setOpenPlate(null)
}

/**
 * Out of the conversation open, back to the list: THE ONE WAY OUT, which
 * every closing takes -- the header's back arrow and the system's back, a
 * block that holds and one that arrives (#469, #494), what becomes known of
 * it afterwards (`lookAgain`), and a share that failed (`backToTheList`).
 */
export function leaveTheConversation(screen: TheConversationScreen): void {
  screen.closeTheConversation()
  putDownWhatIsOver(screen)
}

/**
 * The list, where what became of a share is said (#498): the conversation
 * open left by the one way out, everything over it with it, then the
 * conversations' tab with no panel open over it. Measured on the emulator
 * on 12 September 2026: a share refused while a conversation was open
 * disappeared without a word, since the screen that says it was not the one
 * being looked at.
 */
export function backToTheList(screen: TheListScreen): void {
  leaveTheConversation(screen)
  // The tab is enough to fold Favoris, which live under Réglages only.
  screen.setTab('chat')
  screen.setInvite({ stage: 'shut' })
  screen.setPlusOpen(false)
  screen.setAdmission(null)
}

/**
 * What blocking `blocked` takes from the conversation open, whichever device
 * made the block (#494, #498), by the one rule (`openAfterTheBlock`). What it
 * said, or `null` when no conversation is open.
 *
 * A conversation that leaves closes, the way every conversation does: left
 * open, what is written in it would still leave. One that stays stays open,
 * without that account's messages and without what was bound to them: its
 * messages in the selection and in the forward picker -- which closes when
 * none of the messages waiting in it are left --, its photograph full
 * screen, and a sheet about it, reporting its messages or blocking it again.
 * What shows somebody else stays as it is.
 *
 * One of which the screen does not know yet who is in it stays open for the
 * moment: `lookAgain` closes it once that is known.
 */
export function takeWhatTheBlockTakes(
  screen: TheConversationScreen,
  open: OpenConversation | null,
  rows: readonly ConversationSummary[],
  blocked: ReadonlySet<string>,
  conversation: readonly TimelineEntry[],
): AfterTheBlock | null {
  if (open === null) return null
  const after = openAfterTheBlock(open, rows, blocked)
  if (after === 'leaves') {
    leaveTheConversation(screen)
    return after
  }
  screen.setSelected(held =>
    selectionWithoutTheBlocked(held, conversation, blocked),
  )
  screen.setForwarding(held =>
    held === null
      ? null
      : forwardingWithoutTheBlocked(held, conversation, blocked),
  )
  screen.setOpenPlate(shown =>
    shown === null ||
    allShown(shown.plate.entries, { hidden: new Set(), blocked })
      ? shown
      : null,
  )
  screen.setReporting(sheet =>
    sheet !== null && blocked.has(sheet.author) ? null : sheet,
  )
  screen.setBlockingSender(sheet =>
    sheet !== null && blocked.has(sheet.other) ? null : sheet,
  )
  return after
}

/**
 * Looks again at the conversation open, once more is known of it (#498): its
 * other person found, its row read, or the blocked accounts changed. It
 * closes when the rule now says it leaves.
 *
 * WHAT WAS NOT KNOWN IS ASKED AGAIN. A block that arrived while nothing said
 * who was in the conversation open left it open, and nothing looked again:
 * a conversation of two with the blocked account stayed open once its
 * members were known, and what was written in it still left.
 */
export function lookAgain(
  screen: TheConversationScreen,
  open: OpenConversation | null,
  rows: readonly ConversationSummary[],
  blocked: ReadonlySet<string>,
): void {
  if (open === null) return
  if (openAfterTheBlock(open, rows, blocked) === 'leaves') {
    leaveTheConversation(screen)
  }
}
