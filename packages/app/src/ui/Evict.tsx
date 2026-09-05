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
import type { EvictOutcome } from '../runtime/evict'
import { NotchedButton } from './NotchedButton'

/**
 * Putting somebody out of a conversation.
 *
 * # Why it asks twice, and what the second screen has to say
 *
 * The same shape as vouching, and for the same reason: this cannot be undone.
 * But the sentence it owes a person is a different one, and it is the one a
 * product is tempted to leave off.
 *
 * Removing somebody bounds the *future*. Every message already delivered to
 * their device, and every key that opened it, is theirs now and stays theirs.
 * No call in this application, in the crypto library, or on the homeserver
 * can take that back. `evict_explain_past` says so where the gesture is
 * offered rather than in a help page nobody opens, which is the difference
 * between a person choosing this and a person discovering it.
 *
 * # Three outcomes, not two
 *
 * "Done" splits, because the key rotation is the part that decides whether
 * the removal meant anything, and it has two honest answers. A key of this
 * device's existed and was replaced; or there was none, because this device
 * had never encrypted here, so nothing of ours was out there to replace.
 * Both are success. Reporting them the same way would hide the one case
 * where a reader might want to know why.
 *
 * And the failure that matters is neither: removed, not rotated. A person
 * told only "cela n'a pas abouti" would reasonably assume nothing happened
 * and stop -- while the departed party goes on reading. That state gets its
 * own sentence, and it asks for a retry.
 */
export interface EvictProps {
  /** Who is being removed. Shown so the gesture names its target. */
  readonly memberId: string
  readonly onEvict: () => void
  readonly state: 'idle' | 'working' | EvictOutcome
}

export function Evict({ memberId, onEvict, state }: EvictProps) {
  const [asked, setAsked] = useState(false)
  const dark = useColorScheme() === 'dark'
  const palette = dark ? color.dark : color

  if (state !== 'idle' && state !== 'working') {
    return (
      <Text
        testID="evict-outcome"
        style={[styles.outcome, { color: palette.neutral['600'] }]}>
        {state.evicted
          ? state.rotated
            ? t('evict_done')
            : t('evict_done_no_key')
          : state.stage === 'removing'
            ? t('evict_failed_nothing_changed')
            : t('evict_failed_key_still_valid')}
      </Text>
    )
  }

  if (state === 'working') {
    return (
      <Text
        testID="evict-working"
        style={[styles.outcome, { color: palette.neutral['600'] }]}>
        {t('evict_working')}
      </Text>
    )
  }

  if (!asked) {
    return (
      <View style={styles.block}>
        <NotchedButton
          label={t('evict_action')}
          testID="evict-open"
          onPress={() => setAsked(true)}
        />
        <Text
          testID="evict-hint"
          style={[styles.hint, { color: palette.neutral['600'] }]}>
          {t('evict_hint')}
        </Text>
      </View>
    )
  }

  return (
    <View
      testID="evict-explain"
      style={[
        styles.panel,
        {
          backgroundColor: palette.surface.sunk,
          borderColor: palette.neutral['300'],
        },
      ]}>
      <Text style={[styles.title, { color: palette.neutral['900'] }]}>
        {t('evict_explain_title')}
      </Text>
      <Text style={[styles.line, { color: palette.neutral['900'] }]}>
        {t('evict_explain_future')}
      </Text>
      {/* The sentence the ticket requires, and the one nobody volunteers:
          what they already read is theirs, and nothing takes it back. */}
      <Text
        testID="evict-past"
        style={[styles.line, { color: palette.neutral['900'] }]}>
        {t('evict_explain_past')}
      </Text>
      <Text
        testID="evict-final"
        style={[styles.final, { color: palette.neutral['900'] }]}>
        {t('evict_explain_final')}
      </Text>
      <Text style={[styles.target, { color: palette.neutral['600'] }]}>
        {memberId}
      </Text>

      <View style={styles.actions}>
        <NotchedButton
          label={t('evict_confirm')}
          testID="evict-confirm"
          onPress={onEvict}
        />
        <Pressable
          testID="evict-cancel"
          onPress={() => setAsked(false)}
          accessibilityRole="button"
          accessibilityLabel={t('evict_cancel')}>
          <Text style={[styles.cancel, { color: palette.neutral['600'] }]}>
            {t('evict_cancel')}
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
