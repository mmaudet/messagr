import { useState } from 'react'
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { t } from '../copy'
import {
  color,
  layout,
  radius,
  space,
  type as typeScale,
} from '../design/tokens'
import { Consequences } from './Consequences'
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
 * conversation, as « Signaler » opens its own. One sentence tells them
 * apart, and it is the conversation's, not the entry's: blocked from a
 * conversation of more than two, the conversation stays in the list, and
 * only that account's messages leave it (`stays`).
 *
 * # WHAT IS SAID AFTERWARDS, AND WHERE
 *
 * Here, only a list that could not be written: nothing has changed, and the
 * confirmation stays, to try again. A block that holds takes the person back
 * to the list at once, where the conversation is gone, and the list says what
 * is done and what still waits; or, from a conversation that stays, leaves
 * them in it, and the conversation says so (`blockSays.ts`).
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

/** The panel of the person's own entry: « Bloquer », then the screen. */
export function Block({ memberId, findable, state, onBlock }: BlockProps) {
  const [asked, setAsked] = useState(false)

  if (!asked && state !== 'working') {
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
    <WhatTheBlockDoes
      memberId={memberId}
      findable={findable}
      // The panel is a conversation of two's, which leaves the list.
      stays={false}
      state={state}
      onBlock={onBlock}
      onCancel={() => setAsked(false)}
    />
  )
}

/**
 * « Bloquer l'expéditeur » (#472): the same screen, in a sheet over the
 * conversation. Closing it takes back to the selection, to report its
 * messages first or to do something else with them.
 *
 * Its shape is `ReportSheet.tsx`'s, the ground, the scrim and the sheet, and
 * its long screen scrolls inside the sheet. NEITHER BACK NOR THE SCRIM CLOSE
 * IT WHILE THE LIST IS BEING WRITTEN: closed then, a list that could not be
 * written would be said nowhere, and somebody could believe an account
 * blocked that is not.
 */
export function BlockSheet({
  memberId,
  findable,
  stays,
  state,
  onBlock,
  onClose,
}: BlockProps & {
  /**
   * Whether the conversation blocked from stays in the list, which one of
   * more than two does: the screen then says so, where the panel's says
   * this conversation leaves the list.
   */
  readonly stays: boolean
  readonly onClose: () => void
}) {
  const insets = useSafeAreaInsets()
  const close = state === 'working' ? () => undefined : onClose

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={close}
      testID="block-sheet">
      <View style={styles.over}>
        <Pressable
          testID="block-scrim"
          style={styles.scrim}
          accessibilityRole="button"
          accessibilityLabel={t('block_cancel')}
          onPress={close}
        />
        <View
          style={[styles.sheet, { paddingBottom: space.m + insets.bottom }]}>
          <ScrollView showsVerticalScrollIndicator={false}>
            <WhatTheBlockDoes
              memberId={memberId}
              findable={findable}
              stays={stays}
              state={state}
              onBlock={onBlock}
              onCancel={onClose}
            />
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}

/**
 * What the block does and does not do, then « Oui, bloquer ce compte » and
 * « Annuler », of the same rank: the one screen both entries open.
 */
function WhatTheBlockDoes({
  memberId,
  findable,
  stays,
  state,
  onBlock,
  onCancel,
}: BlockProps & {
  readonly stays: boolean
  readonly onCancel: () => void
}) {
  if (state === 'working') {
    return (
      <Text testID="block-working" style={styles.said}>
        {t('block_working')}
      </Text>
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
          // Its messages leave every conversation either way; this one
          // leaves the list only when it is a conversation of two (#472).
          body: t(stays ? 'block_explain_gone_several' : 'block_explain_gone'),
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
        onPress={onCancel}
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
  over: { flex: 1, justifyContent: 'flex-end' },
  scrim: {
    ...StyleSheet.absoluteFill,
    // The ink and an opacity, as `RemoveSheet.tsx`: the palette carries no
    // translucent value.
    backgroundColor: color.brand.ink900,
    opacity: 0.62,
  },
  // Bounded, so that the screen scrolls inside the sheet rather than pushing
  // its two buttons off the screen.
  sheet: {
    maxHeight: layout.sheetMaxHeight,
    backgroundColor: color.surface.paper,
    borderTopLeftRadius: radius.bubble,
    borderTopRightRadius: radius.bubble,
    paddingHorizontal: space.m,
  },
})
