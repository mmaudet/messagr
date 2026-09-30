import { useState } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'

import { t, type CopyKey } from '../copy'
import { color, space, type as typeScale } from '../design/tokens'
import type { AfterTheBlock } from '../runtime/conversationList'
import { BottomSheet } from './BottomSheet'
import { Consequences, type Consequence } from './Consequences'
import { NotchedButton } from './NotchedButton'

/**
 * Blocking an account: from the panel of the person of a conversation of
 * two (#469), or from the selection, « Bloquer l'expéditeur » (#472), the
 * only way in a conversation of more than two. The gesture is
 * `runtime/block.ts`, the same from both.
 *
 * # ASKED TWICE, IN THE SHAPE OF EVERY GESTURE NOTHING TAKES BACK
 *
 * A block does not lift (decided on 27 September 2026), so it takes
 * `Consequences.tsx`, as vouching and eviction do: what it does, what it does
 * not do, what the operator learns of it, and how to report, which has to be
 * done before -- once blocked, that account's messages leave the screens.
 * Three sentences are « Refuser et bloquer »'s own (#406), since it is the
 * same block: what it does not hide, told apart for somebody findable or
 * not, and that it does not lift.
 *
 * # ONE SCREEN, FROM BOTH ENTRIES
 *
 * The panel asks with its own « Bloquer » first; the selection bar's action
 * is that first asking, and opens the same screen in a sheet over the
 * conversation, as « Signaler » opens its own. What tells them apart is the
 * conversation's, not the entry's, and it is read from the one rule that
 * decides it (`AfterTheBlock`, `conversationList.ts`):
 *
 * - it leaves the list, as a conversation of two with that account does;
 * - it stays, as one of more than two does, and that account still reads
 *   what is written in it: said plainly, so that nothing is found out
 *   afterwards (#462, story 22);
 * - or who is in it is not known yet, and nothing is claimed either way.
 *
 * # WHAT IS SAID AFTERWARDS, AND WHERE
 *
 * Here, only what did not happen: a list that could not be written, or this
 * account itself, which is never blocked. A block that holds takes the
 * person back to the list at once, where the conversation is gone, and the
 * list says what is done and what still waits; or, from a conversation that
 * stays, leaves them in it, and the conversation says so (`BlockLine.tsx`).
 */
export interface BlockProps {
  /** Who is being blocked. Shown so the gesture names its target. */
  readonly memberId: string
  /**
   * Whether this account is findable now: what the screen can truthfully say
   * of who still sees it on Messagr, as « Refuser et bloquer » says it.
   */
  readonly findable: boolean
  /** What the block will do to the conversation it is made from. */
  readonly after: AfterTheBlock
  readonly state: 'idle' | 'working' | 'failed' | 'itself'
  readonly onBlock: () => void
}

/** The panel of the person's own entry: « Bloquer », then the screen. */
export function Block(props: BlockProps) {
  const [asked, setAsked] = useState(false)

  if (!asked && props.state !== 'working') {
    return (
      <View style={styles.block}>
        <NotchedButton
          label={t('block_action')}
          testID="block-open"
          onPress={() => setAsked(true)}
        />
        <Text testID="block-hint" style={styles.hint}>
          {t('block_hint')}
        </Text>
      </View>
    )
  }

  return <WhatTheBlockDoes {...props} onCancel={() => setAsked(false)} />
}

/**
 * « Bloquer l'expéditeur » (#472): the same screen, in a sheet over the
 * conversation. Closing it takes back to the selection, to report its
 * messages first or to do something else with them.
 *
 * NEITHER BACK NOR THE SCRIM CLOSE IT WHILE THE LIST IS BEING WRITTEN:
 * closed then, a list that could not be written would be said nowhere, and
 * somebody could believe an account blocked that is not.
 */
export function BlockSheet({
  onClose,
  ...props
}: BlockProps & { readonly onClose: () => void }) {
  return (
    <BottomSheet
      testID="block-sheet"
      scrimTestID="block-scrim"
      closeLabel={t('block_cancel')}
      onClose={props.state === 'working' ? () => undefined : onClose}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <WhatTheBlockDoes {...props} onCancel={onClose} />
      </ScrollView>
    </BottomSheet>
  )
}

/** What the conversation's fate makes of « Ce qu'il a écrit quitte vos écrans ». */
const GONE: Readonly<Record<AfterTheBlock, CopyKey>> = {
  leaves: 'block_explain_gone',
  stays: 'block_explain_gone_stays',
  'not known': 'block_explain_gone_not_known',
}

/**
 * What the block does and does not do, then « Oui, bloquer ce compte » and
 * « Annuler », of the same rank: the one screen both entries open.
 */
function WhatTheBlockDoes({
  memberId,
  findable,
  after,
  state,
  onBlock,
  onCancel,
}: BlockProps & { readonly onCancel: () => void }) {
  if (state === 'working') {
    return (
      <Text testID="block-working" style={styles.said}>
        {t('block_working')}
      </Text>
    )
  }

  const facts: Consequence[] = [
    {
      // THE MEASURE, in the red `deny` is for.
      tone: 'measure',
      said: t('block_fact_nothing'),
      body: t('block_explain_nothing'),
      testID: 'block-fact-nothing',
    },
    {
      tone: 'plain',
      said: t('block_fact_gone'),
      body: t(GONE[after]),
      testID: 'block-fact-gone',
    },
    // WHAT STAYS, WHERE THE CONVERSATION DOES: that account is still in it
    // and reads what is written there. Something to weigh, in the ochre.
    ...(after === 'stays'
      ? [
          {
            tone: 'weigh' as const,
            said: t('block_fact_still_reads'),
            body: t('block_explain_still_reads'),
            testID: 'block-fact-still-reads',
          },
        ]
      : []),
    {
      tone: 'plain',
      said: t('block_fact_untold'),
      body: t('block_explain_untold'),
      testID: 'block-fact-untold',
    },
    {
      // WHAT A PERSON MIGHT ASSUME AND MUST NOT: the block hides nobody from
      // discovery. Something to weigh, in the ochre.
      tone: 'weigh',
      said: t('block_fact_not_hidden'),
      body: t(findable ? 'invited_block_not' : 'invited_block_not_hidden'),
      testID: 'block-fact-not-hidden',
    },
    {
      tone: 'weigh',
      said: t('block_fact_operator'),
      body: t('block_explain_operator'),
      testID: 'block-fact-operator',
    },
    {
      tone: 'plain',
      said: t('block_fact_report'),
      body: t('block_explain_report'),
      testID: 'block-fact-report',
    },
  ]

  return (
    <Consequences
      testID="block-explain"
      title={t('block_explain_title')}
      lead={t('block_explain_lead')}
      facts={facts}
      finally={t('invited_block_lasts')}
      target={memberId}>
      {/* ABSENT WHEN IT COULD ONLY FAIL: this account itself is never
          blocked, and a button that says « Oui, bloquer » there would be a
          button that does nothing. */}
      {state !== 'itself' && (
        <NotchedButton
          label={t('block_confirm')}
          testID="block-confirm"
          tone="measure"
          onPress={onBlock}
        />
      )}
      <NotchedButton
        label={t('block_cancel')}
        testID="block-cancel"
        tone="quiet"
        onPress={onCancel}
      />
      {state === 'failed' && (
        <Text testID="block-failed" style={styles.said}>
          {t('block_failed')}
        </Text>
      )}
      {state === 'itself' && (
        <Text testID="block-itself" style={styles.said}>
          {t('block_itself')}
        </Text>
      )}
    </Consequences>
  )
}

// THE LIGHT PALETTE, NOT THE SYSTEM'S THEME, for the reason `Evict.tsx`
// gives: which ground a component sits on is its parent's business. The
// sheet's is paper, the panel's the screen's.
const styles = StyleSheet.create({
  block: { gap: space.s, marginTop: space.m },
  hint: { ...typeScale.caption, color: color.neutral['600'] },
  said: {
    ...typeScale.bodySm,
    marginTop: space.m,
    color: color.neutral['600'],
  },
})
