import React from 'react'
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'

import { t } from '../copy'
import { color, floors, radius, space, type } from '../design/tokens'

/**
 * What the green "+" opens: the ways to start something with somebody (#394).
 *
 * # A SHEET, EVEN WITH ONE LINE IN IT
 *
 * Today the only line is inviting somebody, which is what the "+" used to do
 * directly. Address-book discovery (#392) adds « Retrouver mes contacts »
 * beside it, and a second gesture on the same circle needs a place to be
 * chosen from. The sheet comes first, alone, so that the discovery ticket
 * adds a line rather than a new way of opening things.
 *
 * Its shape is `RemoveSheet`'s: a scrim that closes, the choices, then a way
 * out of the same weight. Closing it, by any of the three ways, does nothing
 * else.
 */
export function PlusSheet({
  onInvite,
  onClose,
}: {
  readonly onInvite: () => void
  readonly onClose: () => void
}) {
  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={onClose}
      testID="plus-sheet">
      <View style={styles.over}>
        <Pressable
          testID="plus-scrim"
          style={styles.scrim}
          accessibilityRole="button"
          accessibilityLabel={t('invite_close')}
          onPress={onClose}
        />
        <View style={styles.sheet}>
          <Pressable
            testID="plus-invite"
            onPress={onInvite}
            accessibilityRole="button"
            style={({ pressed }) => [styles.choice, pressed && styles.pressed]}>
            <Text style={styles.choiceLabel}>{t('invite_action')}</Text>
          </Pressable>

          <Pressable
            testID="plus-close"
            onPress={onClose}
            accessibilityRole="button"
            style={({ pressed }) => [styles.choice, pressed && styles.pressed]}>
            <Text style={styles.choiceLabel}>{t('invite_close')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  over: { flex: 1, justifyContent: 'flex-end' },
  scrim: {
    ...StyleSheet.absoluteFill,
    // The ink and an opacity, as `RemoveSheet.tsx`: the palette carries no
    // translucent value and invariant 11 forbids inventing one.
    backgroundColor: color.brand.ink900,
    opacity: 0.62,
  },
  sheet: {
    backgroundColor: color.surface.paper,
    borderTopLeftRadius: radius.bubble,
    borderTopRightRadius: radius.bubble,
    padding: space.m,
    gap: space.xs,
  },
  choice: {
    minHeight: floors.touchTargetMin,
    justifyContent: 'center',
    paddingVertical: space.s,
    paddingHorizontal: space.s,
    borderRadius: radius.bubble,
  },
  choiceLabel: { ...type.titleMd, color: color.neutral['900'] },
  pressed: { backgroundColor: color.neutral['200'] },
})
