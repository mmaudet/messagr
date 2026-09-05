import { useState } from 'react'
import { Pressable, StyleSheet, Text, useColorScheme, View } from 'react-native'

import { t } from '../copy'
import {
  color,
  radius,
  space,
  stroke,
  type as typeScale,
} from '../design/tokens'
import type { VouchOutcome } from '../runtime/vouch'
import { NotchedButton } from './NotchedButton'

/**
 * The inviter's gesture: saying they answer for the person they invited.
 *
 * # Why it asks twice
 *
 * What this does cannot be undone. The keys it hands over are keys the other
 * device keeps -- no revocation, no expiry, no narrowing afterwards -- and it
 * hands them to one named person rather than to a room. A single tap that did
 * that would be a single tap somebody could make by mistake, once, forever.
 *
 * So the first press does nothing but explain, in the plainest words the
 * product has, and the second press is the one that acts. That is the same
 * shape the crypto library gives its own surface, and for the same reason:
 * `buildHistoryBundle` has no side effect and reports what the gesture would
 * give away, precisely so a screen can put it in front of a person before
 * anything leaves the device.
 *
 * # Why no number appears
 *
 * The library reports how many Megolm sessions a bundle carries, and the
 * temptation is to show it. It is not a count of messages and does not
 * correspond to anything a person could check -- two sessions may be a
 * thousand messages or none. Showing it would be precision about a quantity
 * nobody can interpret, which reads as information and is not.
 *
 * The one thing the count genuinely settles is whether there is a past at
 * all, and that changes what is true enough to change the sentence. So the
 * screen branches on empty and says nothing numeric.
 *
 * # The word that is not here
 *
 * "Vérifier" appears nowhere, and `copy.spec.ts` fails the build if it ever
 * does. Verification is a real act in this product -- comparing a short
 * string, scanning a code -- and vouching is a human judgement that proves
 * nothing cryptographically. Borrowing the word would tell somebody they had
 * done the one when they had done the other.
 */
export interface VouchProps {
  /** Who is being vouched for. Shown so the gesture names its target. */
  readonly entrantId: string
  /**
   * Whether this conversation has a past to hand over.
   *
   * From `buildHistoryBundle`'s `shared` count, reduced to the one thing it
   * settles. `null` when nothing has looked yet, which reads the same as
   * "assume there is": the sentence about history is the cautious one.
   */
  readonly hasHistory: boolean | null
  readonly onVouch: () => void
  readonly state: 'idle' | 'working' | VouchOutcome
}

export function Vouch({ entrantId, hasHistory, onVouch, state }: VouchProps) {
  const [asked, setAsked] = useState(false)
  const dark = useColorScheme() === 'dark'
  const palette = dark ? color.dark : color

  if (state !== 'idle' && state !== 'working') {
    return (
      <Text
        testID="vouch-outcome"
        style={[styles.outcome, { color: palette.neutral['600'] }]}>
        {!state.vouched
          ? t('vouch_failed_nothing_changed')
          : state.shared === 0
            ? t('vouch_done_no_history')
            : t('vouch_done')}
      </Text>
    )
  }

  if (state === 'working') {
    return (
      <Text
        testID="vouch-working"
        style={[styles.outcome, { color: palette.neutral['600'] }]}>
        {t('vouch_working')}
      </Text>
    )
  }

  if (!asked) {
    return (
      <View style={styles.block}>
        <NotchedButton
          label={t('vouch_action')}
          testID="vouch-open"
          onPress={() => setAsked(true)}
        />
        <Text
          testID="vouch-hint"
          style={[styles.hint, { color: palette.neutral['600'] }]}>
          {t('vouch_hint')}
        </Text>
      </View>
    )
  }

  return (
    <View
      testID="vouch-explain"
      style={[
        styles.panel,
        {
          backgroundColor: palette.surface.sunk,
          borderColor: palette.neutral['300'],
        },
      ]}>
      <Text style={[styles.title, { color: palette.neutral['900'] }]}>
        {t('vouch_explain_title')}
      </Text>
      <Text style={[styles.line, { color: palette.neutral['900'] }]}>
        {hasHistory === false
          ? t('vouch_explain_history_empty')
          : t('vouch_explain_history')}
      </Text>
      <Text style={[styles.line, { color: palette.neutral['900'] }]}>
        {t('vouch_explain_invite')}
      </Text>
      {/* Last, and on its own, because it is the sentence somebody has to have
          read before the button below means anything. */}
      <Text
        testID="vouch-final"
        style={[styles.final, { color: palette.neutral['900'] }]}>
        {t('vouch_explain_final')}
      </Text>
      <Text style={[styles.target, { color: palette.neutral['600'] }]}>
        {entrantId}
      </Text>

      <View style={styles.actions}>
        <NotchedButton
          label={t('vouch_confirm')}
          testID="vouch-confirm"
          onPress={onVouch}
        />
        <Pressable
          testID="vouch-cancel"
          onPress={() => setAsked(false)}
          accessibilityRole="button"
          accessibilityLabel={t('vouch_cancel')}>
          <Text style={[styles.cancel, { color: palette.neutral['600'] }]}>
            {t('vouch_cancel')}
          </Text>
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  block: { gap: space.s, marginTop: space.m },
  hint: typeScale.caption,
  outcome: { ...typeScale.bodySm, marginTop: space.m },
  panel: {
    gap: space.s,
    marginTop: space.m,
    padding: space.m,
    borderRadius: radius.bubble,
    borderWidth: stroke.base,
  },
  title: typeScale.bodySm,
  line: typeScale.bodySm,
  final: typeScale.bodySm,
  target: typeScale.caption,
  actions: { gap: space.s, marginTop: space.s },
  cancel: typeScale.caption,
})
