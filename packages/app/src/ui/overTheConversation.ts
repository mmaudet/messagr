import {
  openAfterTheBlock,
  openConversationOf,
  type ConversationSummary,
  type WithSomebody,
} from '../runtime/conversationList'
import type { TrustReading } from '../runtime/cryptoPump'
import type { FindingStage } from '../runtime/findContacts'
import { allShown } from '../runtime/notShown'
import type { TimelineEntry } from '../timeline/mergeTimeline'
import type { Plate } from '../timeline/plates'
import {
  forwardingWithoutTheBlocked,
  selectionWithoutTheBlocked,
} from '../timeline/selection'
import type { InviteStage } from './Invite'
import type { OpenReport } from './reportStage'
import type { Tab } from './TabBar'

/**
 * What is drawn over the conversation open, and what closing it, opening
 * another, a block and a share that failed make of it (#494, #498). Pure, as
 * `reportStage.ts` asks of a rule a screen applies (#491): state in, state
 * out, and `App.tsx` holds the state and applies what comes back.
 *
 * They were written inline in `App.tsx`, where nothing could test them, and
 * one of them closed the conversation by hand: a share that failed left the
 * sheets, the forward picker and the photograph full screen standing over
 * the list.
 */

/** A photograph open full screen: its plate, and at which of them. */
export interface OpenPlate {
  readonly plate: Plate
  readonly at: number
}

/** Everything that can be drawn over the conversation open, as one value. */
export interface OverTheConversation {
  /**
   * The messages the selection mode holds. Empty means there is no mode:
   * `Conversation.tsx` derives the reaction row from it too, so the two
   * cannot disagree.
   */
  readonly selected: ReadonlySet<string>
  /** What is known of the other person, while their trust screen is up. */
  readonly trust: TrustReading | null
  /** The panel of the person. */
  readonly personOpen: boolean
  /**
   * « Bloquer l'expéditeur »'s sheet (#472): the conversation, and the
   * account taken from the selection when the action was pressed.
   */
  readonly blockingSender: WithSomebody | null
  /** The report's sheet (#468): `reportStage.ts`. */
  readonly reporting: OpenReport | null
  /** The removal's sheet. */
  readonly removing: boolean
  /**
   * The messages waiting in the forward picker, while it is up: taken from
   * the selection when the gesture starts, since the picker clears it.
   */
  readonly forwarding: readonly string[] | null
  /** A photograph full screen: the viewer is a modal over everything. */
  readonly openPlate: OpenPlate | null
}

/**
 * NOTHING OVER THE CONVERSATION: what every closing leaves -- the header's
 * back arrow and the system's, a block, what becomes known afterwards, a
 * share that failed -- and what every opening starts from (#494). Left up,
 * each layer outlived its conversation: the removal sheet opened again in
 * the next one, the others stood over the list.
 */
export const NOTHING_OVER: OverTheConversation = {
  selected: new Set(),
  trust: null,
  personOpen: false,
  blockingSender: null,
  reporting: null,
  removing: false,
  forwarding: null,
  openPlate: null,
}

/**
 * What a block of `blocked` leaves over a conversation that stays open
 * (#472, #494, #498): without that account's messages, and without what was
 * bound to them -- its messages in the selection and in the forward picker,
 * which closes when none of the messages waiting in it are left, its
 * photograph full screen, and a sheet about it, reporting its messages or
 * blocking it again. What shows somebody else stays as it is, and the same
 * value comes back when nothing of that account was over the conversation.
 */
export function overAfterTheBlock(
  over: OverTheConversation,
  conversation: readonly TimelineEntry[],
  blocked: ReadonlySet<string>,
): OverTheConversation {
  const after: OverTheConversation = {
    selected: selectionWithoutTheBlocked(over.selected, conversation, blocked),
    trust: over.trust,
    personOpen: over.personOpen,
    blockingSender:
      over.blockingSender !== null && blocked.has(over.blockingSender.other)
        ? null
        : over.blockingSender,
    reporting:
      over.reporting !== null && blocked.has(over.reporting.author)
        ? null
        : over.reporting,
    removing: over.removing,
    forwarding:
      over.forwarding === null
        ? null
        : forwardingWithoutTheBlocked(over.forwarding, conversation, blocked),
    openPlate:
      over.openPlate === null ||
      allShown(over.openPlate.plate.entries, { hidden: new Set(), blocked })
        ? over.openPlate
        : null,
  }
  const changed = (Object.keys(after) as (keyof OverTheConversation)[]).some(
    layer => after[layer] !== over[layer],
  )
  return changed ? after : over
}

/**
 * Whether the conversation `open` leaves now that `blocked` are blocked
 * (#494, #498), read on what is known of it: `found`, the other person the
 * screen found -- for this conversation only --, and its row. The rule is
 * the list's (`openAfterTheBlock`): the conversation with a blocked account
 * leaves, as the one blocked from does.
 *
 * WHAT WAS NOT KNOWN IS ASKED AGAIN, whenever more is known: a block that
 * arrived while nothing said who was in the conversation open left it open,
 * and nothing looked again -- a conversation of two with the blocked account
 * stayed open once its participants were known, and what was written in it
 * still left. `false` while no conversation is open.
 */
export function leavesNow(
  open: string | null,
  found: WithSomebody | null,
  rows: readonly ConversationSummary[],
  blocked: ReadonlySet<string>,
): boolean {
  return (
    open !== null &&
    openAfterTheBlock(openConversationOf(open, found), rows, blocked) ===
      'leaves'
  )
}

/**
 * Where the person is: the conversation open, what is drawn over it, the
 * tab, and what can stand over the list or be drawn in its place.
 */
export interface TheScreen {
  readonly open: string | null
  readonly over: OverTheConversation
  readonly tab: Tab
  /** The invitation panel, drawn in the list's place (`Invite.tsx`). */
  readonly invite: InviteStage
  /** The sheet the green « + » opens (#394). */
  readonly plusOpen: boolean
  /** Who an invitation just let in, said with the panel. */
  readonly admission: 'waiting' | 'admitted' | null
  /** Looking for one's contacts (#400), drawn in the list's place. */
  readonly finding: FindingStage
}

/**
 * The list, where what became of a share is said (#498): no conversation
 * open and nothing over it, the conversations' tab, and nothing over the
 * list or drawn in its place -- the invitation panel, the « + » sheet, the
 * admission, looking for one's contacts. The tab is enough to fold Favoris,
 * which live under Réglages only.
 *
 * Measured on the emulator on 12 September 2026: a share refused while a
 * conversation was open disappeared without a word, since the screen that
 * says it was not the one being looked at.
 */
export function backToTheList(screen: TheScreen): TheScreen {
  return {
    ...screen,
    open: null,
    over: NOTHING_OVER,
    tab: 'chat',
    invite: { stage: 'shut' },
    plusOpen: false,
    admission: null,
    finding: { stage: 'shut' },
  }
}
