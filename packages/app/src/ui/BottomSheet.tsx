import React from 'react'
import { Modal, Pressable, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { color, layout, radius, space } from '../design/tokens'

/**
 * A sheet raised from the bottom over whatever is on screen, on a scrim that
 * closes it: « Signaler » (`ReportSheet.tsx`), the block's screen opened
 * from the selection (`Block.tsx`), and what « Plus » holds
 * (`SelectionBar.tsx`). The product had no bottom sheet of its own to
 * borrow, and the three were one shape copied; this is the shape.
 *
 * Bounded by `layout.sheetMaxHeight`: what does not fit scrolls inside it,
 * which is its content's business, and a band of the screen stays in sight
 * above it.
 */
export function BottomSheet({
  testID,
  scrimTestID,
  closeLabel,
  onClose,
  visible = true,
  onDismiss,
  children,
}: {
  readonly testID: string
  readonly scrimTestID: string
  /** What pressing the scrim does, as a screen reader says it. */
  readonly closeLabel: string
  /**
   * Back, and the scrim. A caller that must not be closed at a given moment
   * hands a function that does nothing then.
   */
  readonly onClose: () => void
  /**
   * For a sheet kept mounted and hidden rather than taken away, as one must
   * be whose choice opens another sheet: see `onDismiss`.
   */
  readonly visible?: boolean
  /**
   * Once a sheet hidden by `visible` has gone from an iPhone's screen. A
   * sheet opened while another is still going away is one iOS may not
   * show, so what a choice in a sheet opens waits for this there; Android
   * never calls it, and opens it at once.
   */
  readonly onDismiss?: () => void
  readonly children: React.ReactNode
}) {
  const insets = useSafeAreaInsets()

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      onDismiss={onDismiss}
      testID={testID}>
      <View style={styles.over}>
        <Pressable
          testID={scrimTestID}
          style={styles.scrim}
          accessibilityRole="button"
          accessibilityLabel={closeLabel}
          onPress={onClose}
        />
        <View
          style={[styles.sheet, { paddingBottom: space.m + insets.bottom }]}>
          {children}
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  over: { flex: 1, justifyContent: 'flex-end' },
  // The ink at the scrim's own opacity: the palette carries no translucent
  // value, and the opacity is a token like any other design value.
  scrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: color.brand.ink900,
    opacity: layout.scrimOpacity,
  },
  sheet: {
    maxHeight: layout.sheetMaxHeight,
    backgroundColor: color.surface.paper,
    borderTopLeftRadius: radius.bubble,
    borderTopRightRadius: radius.bubble,
    paddingTop: space.m,
    paddingHorizontal: space.m,
  },
})
