import React from 'react'
import { Pressable, StatusBar, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { t } from '../copy'
import { color, floors, layout, space, type } from '../design/tokens'

/**
 * What replaces the conversation's header while messages are selected.
 *
 * # A MODE, AND IT HAS TO LOOK LIKE ONE
 *
 * Selecting changes what every tap in the conversation means, so the screen
 * has to say so from the top. Taking the whole top is how: the person's name
 * goes, the brand band goes with it, a count arrives, and there is exactly
 * one way out and it is on the left where a back arrow was.
 *
 * BOTH BANDS, not one. The first version replaced the conversation's header
 * and left the application's band above it -- two dark green bars stacked,
 * which read as two applications. Reported from the Pixel with a screenshot:
 * « le bandeau de sélection devrait se substituer au bandeau supérieur
 * Messagr ». So this owns the safe area too, exactly as `Header` does, and
 * `App.tsx` draws the band again when the mode ends.
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
  return (
    <SafeAreaView edges={['top']} style={styles.bar} testID="selection-bar">
      {/* The same light content the band it replaces asks for: the ground is
          the same green, and the status bar must not change under a mode. */}
      <StatusBar barStyle="light-content" />
      <View style={styles.row}>
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
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  // The brand band's own ground, because this replaces it rather than
  // sitting under it. The safe area belongs to the bar for the same reason:
  // it is the top of the screen while the mode lasts.
  bar: { backgroundColor: color.brand.green900 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s,
    paddingHorizontal: layout.screenGutter,
    paddingVertical: space.s,
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
