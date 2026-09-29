import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import { t } from '../copy'
import { color, space, type as typeScale } from '../design/tokens'
import { Consequences } from './Consequences'
import { NotchedButton } from './NotchedButton'

/**
 * Blocking the other person of a conversation, from the panel of the person
 * (#469). The gesture is `runtime/block.ts`.
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
 * # WHAT IS SAID AFTERWARDS, AND WHERE
 *
 * Here, only a list that could not be written: nothing has changed, and the
 * confirmation stays, to try again. A block that holds takes the person back
 * to the list at once, where the conversation is gone, and the list says what
 * is done and what still waits.
 */
export interface BlockProps {
  /** Who is being blocked. Shown so the gesture names its target. */
  readonly memberId: string
  /**
   * Whether this account is findable now: what the screen can truthfully say
   * of who still sees it on Messagr, as « Refuser et bloquer » says it.
   */
  readonly findable: boolean
  readonly state: 'idle' | 'working' | 'failed'
  readonly onBlock: () => void
}

export function Block({ memberId, findable, state, onBlock }: BlockProps) {
  const [asked, setAsked] = useState(false)

  if (state === 'working') {
    return (
      <Text testID="block-working" style={styles.said}>
        {t('block_working')}
      </Text>
    )
  }

  if (!asked) {
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

  return (
    <Consequences
      testID="block-explain"
      title={t('block_explain_title')}
      lead={t('block_explain_lead')}
      facts={[
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
          body: t('block_explain_gone'),
          testID: 'block-fact-gone',
        },
        {
          tone: 'plain',
          said: t('block_fact_untold'),
          body: t('block_explain_untold'),
          testID: 'block-fact-untold',
        },
        {
          // WHAT A PERSON MIGHT ASSUME AND MUST NOT: the block hides nobody
          // from discovery. Something to weigh, in the ochre.
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
      ]}
      finally={t('invited_block_lasts')}
      target={memberId}>
      <NotchedButton
        label={t('block_confirm')}
        testID="block-confirm"
        tone="measure"
        onPress={onBlock}
      />
      <NotchedButton
        label={t('block_cancel')}
        testID="block-cancel"
        tone="quiet"
        onPress={() => setAsked(false)}
      />
      {state === 'failed' && (
        <Text testID="block-failed" style={styles.said}>
          {t('block_failed')}
        </Text>
      )}
    </Consequences>
  )
}

// THE LIGHT PALETTE, NOT THE SYSTEM'S THEME, for the reason `Evict.tsx`
// gives: which ground a component sits on is its parent's business.
const styles = StyleSheet.create({
  block: { gap: space.s, marginTop: space.m },
  hint: { ...typeScale.caption, color: color.neutral['600'] },
  said: {
    ...typeScale.bodySm,
    marginTop: space.m,
    color: color.neutral['600'],
  },
})
