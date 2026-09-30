import type { CopyKey } from '../copy'
import {
  openAfterTheBlock,
  openConversationOf,
  type AfterTheBlock,
  type ConversationSummary,
  type WithSomebody,
} from '../runtime/conversationList'
import { isFindable, type DiscoveryReading } from '../runtime/discovery'
import type { ConsequenceTone } from './Consequences'

/**
 * What the screen of a block says before the person decides (#469, #472,
 * #498): the same screen from the panel of the person and from « Bloquer
 * l'expéditeur » (`Block.tsx`).
 *
 * It was read in `App.tsx`, and the facts it states in `Block.tsx`, where
 * nothing could test them, and it said « il lit encore cette conversation »
 * of an account that had left it. They are here, pure, as `reportStage.ts`
 * asks of a rule a screen applies (#491).
 */
export interface WhatTheBlockWillDo {
  /** What the block does to the conversation it is made from. */
  readonly after: AfterTheBlock
  /**
   * Whether the account still reads that conversation, which stays: one of
   * its participants, as far as this device knows (#498).
   */
  readonly stillReads: boolean
  /** Whether this account is findable, as far as this device knows. */
  readonly findable: boolean
}

/**
 * What blocking `target.other` from the conversation `target.scope` will do,
 * read on what the screen knows now: the other person it found, `found`, and
 * the rows of the list, those the list no longer draws included. The rule is
 * the one that closes the conversation once the block holds
 * (`openAfterTheBlock`).
 */
export function whatTheBlockWillDo(
  target: WithSomebody,
  found: WithSomebody | null,
  rows: readonly ConversationSummary[],
  discovery: DiscoveryReading,
  now: number,
): WhatTheBlockWillDo {
  const after = openAfterTheBlock(
    openConversationOf(target.scope, found),
    rows,
    new Set([target.other]),
  )
  return {
    after,
    stillReads: after === 'stays' && stillIn(target, rows),
    findable: findableAsFarAsKnown(discovery, now),
  }
}

/**
 * Whether this account is findable now, as far as this device knows: what a
 * screen about a block can truthfully say of who still sees it on Messagr
 * (#406, #469), « Refuser et bloquer »'s included. Unknown counts as
 * findable: telling somebody they are still seen is the cautious error of
 * the two.
 */
export function findableAsFarAsKnown(
  discovery: DiscoveryReading,
  now: number,
): boolean {
  return !discovery.read || isFindable(discovery, now)
}

/**
 * Whether the account of `target` still takes part in its conversation, as
 * the row last read its participants (#498). Not read counts as taking part:
 * telling somebody the account still reads what they write is the cautious
 * error of the two, the other being to let them write for it believing it
 * gone.
 */
function stillIn(
  target: WithSomebody,
  rows: readonly ConversationSummary[],
): boolean {
  const participants = rows.find(
    row => row.scope === target.scope,
  )?.participants
  return participants === undefined || participants.includes(target.other)
}

/** One fact the screen states, as its copy keys. */
export interface BlockFact {
  readonly tone: ConsequenceTone
  /** Four or five words. */
  readonly said: CopyKey
  /** The sentence, the part that has to be true. */
  readonly body: CopyKey
  readonly testID: string
}

/** What the conversation's fate makes of « Ce qu'il a écrit quitte vos écrans ». */
const GONE: Readonly<Record<AfterTheBlock, CopyKey>> = {
  leaves: 'block_explain_gone',
  stays: 'block_explain_gone_stays',
  'not known': 'block_explain_gone_not_known',
}

/**
 * The facts the screen states, in order: what the block does, what it does
 * not do, what the operator learns of it, and how to report, which has to be
 * done before -- once blocked, that account's messages leave the screens.
 * Three are « Refuser et bloquer »'s own (#406), since it is the same block:
 * what it does not hide, told apart for somebody findable or not, and, said
 * after them, that it does not lift.
 */
export function factsOfTheBlock(
  will: WhatTheBlockWillDo,
): readonly BlockFact[] {
  return [
    {
      // THE MEASURE, in the red `deny` is for.
      tone: 'measure',
      said: 'block_fact_nothing',
      body: 'block_explain_nothing',
      testID: 'block-fact-nothing',
    },
    {
      tone: 'plain',
      said: 'block_fact_gone',
      body: GONE[will.after],
      testID: 'block-fact-gone',
    },
    // WHAT STAYS, WHERE THE CONVERSATION DOES AND THE ACCOUNT IS STILL IN
    // IT: it reads what is written there. Something to weigh, in the ochre.
    // Of an account that left, it would be false (#498).
    ...(will.stillReads
      ? [
          {
            tone: 'weigh' as const,
            said: 'block_fact_still_reads' as const,
            body: 'block_explain_still_reads' as const,
            testID: 'block-fact-still-reads',
          },
        ]
      : []),
    {
      tone: 'plain',
      said: 'block_fact_untold',
      body: 'block_explain_untold',
      testID: 'block-fact-untold',
    },
    {
      // WHAT A PERSON MIGHT ASSUME AND MUST NOT: the block hides nobody from
      // discovery. Something to weigh, in the ochre.
      tone: 'weigh',
      said: 'block_fact_not_hidden',
      body: will.findable ? 'invited_block_not' : 'invited_block_not_hidden',
      testID: 'block-fact-not-hidden',
    },
    {
      tone: 'weigh',
      said: 'block_fact_operator',
      body: 'block_explain_operator',
      testID: 'block-fact-operator',
    },
    {
      tone: 'plain',
      said: 'block_fact_report',
      body: 'block_explain_report',
      testID: 'block-fact-report',
    },
  ]
}
