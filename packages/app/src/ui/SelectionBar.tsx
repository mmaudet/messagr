import React from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { t } from '../copy'
import { color, floors, layout, space, type } from '../design/tokens'

/**
 * What replaces the conversation's header while messages are selected.
 *
 * # A MODE, AND IT HAS TO LOOK LIKE ONE
 *
 * Selecting changes what every tap in the conversation means, so the screen
 * has to say so from the top. Taking the header's place is how: the person's
 * name goes, a count arrives, and there is exactly one way out and it is on
 * the left where a back arrow was.
 *
 * # ABSENT, NEVER GREYED
 *
 * An action that does not apply to everything selected is not drawn. #192:
 * *« une commande grisée est une commande qu'il faut expliquer »* -- and the
 * alternative, applying an action to the part of a selection it happens to
 * fit, would destroy three messages of five without saying so.
 *
 * # WORDS RATHER THAN ICONS
 *
 * The identity's set has no bin and no clipboard, and `TabIcon` is explicit
 * that an icon invented in a component is one the identity never agreed to.
 * Two words also survive translation into six languages without anybody
 * guessing at a pictogram, and they read aloud correctly for free.
 */
export function SelectionBar({
  count,
  canCopy: copyable,
  onClear,
  onCopy,
  onRemove,
}: {
  readonly count: number
  readonly canCopy: boolean
  readonly onClear: () => void
  readonly onCopy: () => void
  readonly onRemove: () => void
}) {
  const insets = useSafeAreaInsets()

  return (
    <View
      testID="selection-bar"
      style={[styles.bar, { paddingTop: insets.top }]}>
      <Pressable
        testID="selection-clear"
        onPress={onClear}
        accessibilityRole="button"
        accessibilityLabel={t('selection_clear')}
        style={styles.leave}>
        <Text style={styles.leaveMark}>{'✕'}</Text>
      </Pressable>

      <Text style={styles.count} testID="selection-count">
        {t('selection_count %1$d', count)}
      </Text>

      {copyable && (
        <Pressable
          testID="selection-copy"
          onPress={onCopy}
          accessibilityRole="button"
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
          <Text style={styles.actionLabel}>{t('selection_copy')}</Text>
        </Pressable>
      )}

      {/* ALWAYS THERE, unlike Copy. Removing has two scopes and the
          narrower one -- hiding on this telephone -- applies to anything,
          including somebody else's message. Which of the two is offered is
          the sheet's question, not the bar's: see `RemoveSheet.tsx`. */}
      <Pressable
        testID="selection-remove"
        onPress={onRemove}
        accessibilityRole="button"
        style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
        <Text style={[styles.actionLabel, styles.destructive]}>
          {t('selection_remove')}
        </Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  // The header's own ground, so the bar arrives in the place the header was
  // rather than as a second thing above it.
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s,
    paddingHorizontal: layout.screenGutter,
    paddingBottom: space.s,
    backgroundColor: color.brand.green900,
  },
  leave: {
    minWidth: floors.touchTargetMin,
    minHeight: floors.touchTargetMin,
    alignItems: 'center',
    justifyContent: 'center',
  },
  leaveMark: { ...type.titleMd, color: color.surface.paper },
  count: { ...type.titleMd, color: color.surface.paper, flex: 1 },
  action: {
    minHeight: floors.touchTargetMin,
    justifyContent: 'center',
    paddingHorizontal: space.s,
  },
  actionLabel: { ...type.action, color: color.surface.paper },
  // Red on a dark green ground would be unreadable, so the destructive one
  // is said by its word and placed last, which is the order every system
  // dialogue uses. `deny.200` is the palette's own light red.
  destructive: { color: color.deny['200'] },
  pressed: { opacity: 0.7 },
})
