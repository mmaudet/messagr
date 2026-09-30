import React from 'react'
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'

import { t } from '../copy'
import { color, floors, layout, radius, space, type } from '../design/tokens'

/**
 * What the green "+" opens: the ways to start something with somebody (#394).
 *
 * # A SHEET, EVEN WITH ONE LINE IN IT
 *
 * Inviting somebody is what the "+" used to do directly. Address-book
 * discovery (#392, #400) adds « Retrouver mes contacts » beside it, where
 * this service serves discovery, and a second gesture on the same circle
 * needed a place to be chosen from: the sheet came first, alone, so that
 * discovery adds a line rather than a new way of opening things.
 *
 * Its shape is `RemoveSheet`'s: a scrim that closes, the choices, then a way
 * out of the same weight. Closing it, by any of the three ways, does nothing
 * else.
 */
export function PlusSheet({
  onInvite,
  onFindContacts,
  onClose,
}: {
  readonly onInvite: () => void
  /**
   * « Retrouver mes contacts » (#400), given only when this service serves
   * discovery: without it, the line is not drawn at all rather than drawn
   * and refused later, as « Être trouvable » in Settings.
   */
  readonly onFindContacts?: () => void
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
          accessibilityLabel={t('plus_close')}
          onPress={onClose}
        />
        <View style={styles.sheet}>
          <Pressable
            testID="plus-invite"
            onPress={onInvite}
            accessibilityRole="button"
            style={({ pressed }) => [styles.choice, pressed && styles.pressed]}>
            <Text style={styles.choiceLabel}>{t('plus_invite')}</Text>
          </Pressable>

          {onFindContacts !== undefined && (
            <Pressable
              testID="plus-find-contacts"
              onPress={onFindContacts}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.choice,
                pressed && styles.pressed,
              ]}>
              <Text style={styles.choiceLabel}>{t('plus_find_contacts')}</Text>
            </Pressable>
          )}

          <Pressable
            testID="plus-close"
            onPress={onClose}
            accessibilityRole="button"
            style={({ pressed }) => [styles.choice, pressed && styles.pressed]}>
            <Text style={styles.choiceLabel}>{t('plus_close')}</Text>
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
    opacity: layout.scrimOpacity,
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
