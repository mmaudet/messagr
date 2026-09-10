import React from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

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
 * Messagr ».
 *
 * # IT IS THE BAND'S CONTENTS, NOT A BAND OF ITS OWN
 *
 * The second version owned its own `SafeAreaView` and `StatusBar`, drawn
 * where `Header` had been unmounted -- so entering the mode tore down the top
 * of the screen and built another one, measuring the inset again and popping
 * the status-bar style back to the platform default for a frame. Reported as
 * « un flash vraiment pas agréable ». `Header` takes children now, and this
 * is what it takes.
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
  canForward: forwardable,
  canKeep: keepable,
  onClear,
  onCopy,
  onForward,
  onKeep,
  onRemove,
}: {
  readonly count: number
  readonly canCopy: boolean
  readonly canForward: boolean
  /**
   * Whether the selection is one photograph, and so has somewhere to be
   * kept. Words have no gallery to go to.
   */
  readonly canKeep: boolean
  readonly onClear: () => void
  readonly onCopy: () => void
  readonly onForward: () => void
  readonly onKeep: () => void
  readonly onRemove: () => void
}) {
  return (
    <View style={styles.row} testID="selection-bar">
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

      {forwardable && (
        <Pressable
          testID="selection-forward"
          onPress={onForward}
          accessibilityRole="button"
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
          <Text style={styles.actionLabel}>{t('selection_forward')}</Text>
        </Pressable>
      )}

      {/* THE ONLY ACTION HERE THAT LEAVES THE PRODUCT. Copy and Forward move
          a photograph to another place this application still stands behind;
          this one puts it in the gallery, where the camera's pictures live,
          and stops standing behind it. `keepPhotograph.ts` says what that
          costs and ADR-0006 carries the amendment.

          Offered only on a single photograph: a gallery takes pictures, and
          a selection with a word in it has no picture to give. */}
      {keepable && (
        <Pressable
          testID="selection-keep"
          onPress={onKeep}
          accessibilityRole="button"
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
          <Text style={styles.actionLabel}>{t('selection_keep')}</Text>
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
  // No ground and no inset: the band around it has both. See the note above
  // for what happened when this had its own.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s,
    paddingHorizontal: layout.screenGutter,
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
