import { reactionsShown, shownOf, type NotShown } from '../runtime/notShown'
import type { TimelineEntry } from '../timeline/mergeTimeline'
import type { LooseReaction, ReactionTally } from '../timeline/reactions'
import {
  blockable,
  canCopy,
  canFavourite,
  canForward,
  canRemoveForEveryone,
  onlyPhotograph,
  reportable,
  type Reportable,
} from '../timeline/selection'
import type { BarAction } from './barActions'

/**
 * The conversation open, as this device shows it and as this account reads
 * it (#469, #472, #494, #498): everything the screen reads of it once per
 * draw, read here in one place.
 *
 * ONE CONVERSATION, THE ONE SHOWN: without what this device does not draw
 * (`notShown.ts`). The selection is made of it, and what the bar offers, what
 * « Signaler » would carry, whom « Bloquer l'expéditeur » would block and
 * whether « pour tout le monde » is offered are read on it: a message hidden
 * or blocked since offers nothing.
 *
 * ONE ACCOUNT, THE SESSION'S (`self`). Whose messages are this account's own
 * decides whether « pour tout le monde » is offered, which reaction is its
 * own, and that « Signaler » and « Bloquer l'expéditeur » are offered on
 * somebody else's only -- as it decides which side a bubble is drawn on and
 * which messages carry the ticks, from the same account. Two were read: the
 * session's, and one a launch set only when it found a conversation, the
 * empty string after a launch that found none: a conversation joined
 * afterwards drew this account's own messages as somebody else's, never
 * offered to remove them for everyone, and never ticked them.
 */
export interface ConversationShown {
  /** The messages drawn. */
  readonly entries: readonly TimelineEntry[]
  /** The reactions drawn under them, this account's own told apart. */
  readonly reactions: ReadonlyMap<string, readonly ReactionTally[]>
  /** What the selection bar offers on the selection. Absent, never greyed. */
  readonly offers: Readonly<Record<BarAction, boolean>>
  /** What a report of the selection would carry, or `null`. */
  readonly reportable: Reportable | null
  /** Whom « Bloquer l'expéditeur » would block, or `null`. */
  readonly blockable: string | null
  /** Whether the removal offers « pour tout le monde » on the selection. */
  readonly forEveryone: boolean
}

export function conversationShown(
  self: string,
  {
    conversation,
    notShown,
    reactions,
    selected,
  }: {
    /** The conversation as the homeserver holds it. */
    readonly conversation: readonly TimelineEntry[]
    readonly notShown: NotShown
    readonly reactions: readonly LooseReaction[]
    readonly selected: ReadonlySet<string>
  },
): ConversationShown {
  const entries = shownOf(conversation, notShown)
  const selecting = selected.size > 0
  const reported = selecting ? reportable(selected, entries, self) : null
  const blocked = selecting ? blockable(selected, entries, self) : null
  return {
    entries,
    reactions: reactionsShown(reactions, notShown, self),
    offers: {
      copy: canCopy(selected, entries),
      forward: canForward(selected, entries),
      favourite: canFavourite(selected, entries),
      // A gallery takes pictures: offered on a single photograph only.
      keep: onlyPhotograph(selected, entries)?.image !== undefined,
      report: reported !== null,
      block: blocked !== null,
      // Always: hiding « pour moi » applies to anything selected.
      remove: true,
    },
    reportable: reported,
    blockable: blocked,
    forEveryone: canRemoveForEveryone(selected, entries, self),
  }
}
