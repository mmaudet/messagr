import React from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { color, elevation, floors, radius, space, type } from '../design/tokens'

/**
 * The green circle above the tab bar, and the only way to invite somebody.
 *
 * # Why the inline button had to go rather than gain a friend
 *
 * #83 put an invite button under the list, which was right while the list was
 * the whole screen. It is not any more: with four tabs, a control that lives
 * inside one tab's content scrolls away with it, and inviting is the one
 * thing a person opens this application to do that is not reading. Two
 * entrances to the same gesture would also be two things to keep in step —
 * and the second one would be the one nobody updated.
 *
 * # Green, and this is the uncontroversial half of invariant 3
 *
 * `green500` is *« action principale »* in the token's own words. If the
 * floating action is not the principal action, nothing is.
 */

export function FloatingAction({
  label,
  onPress,
  testID,
}: {
  /** Read aloud. The circle itself carries a sign, not a word. */
  readonly label: string
  readonly onPress: () => void
  readonly testID: string
}) {
  return (
    // The wrapper is what floats; the button is what is pressed. Kept apart
    // so the touch target is the circle and not the empty corner beside it.
    <View style={styles.hover} pointerEvents="box-none">
      <Pressable
        testID={testID}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={({ pressed }) => [styles.circle, pressed && styles.pressed]}>
        {/* A sign rather than an icon file: `design/icons/` has no plus, and
            a plus drawn here would be this repository's hand in an identity
            that has a voice. The character is the same stroke weight as the
            typeface around it, which is more than a redrawn one would be. */}
        <Text style={styles.sign}>+</Text>
      </Pressable>
    </View>
  )
}

const SIZE = floors.touchTargetMin + space.m

const styles = StyleSheet.create({
  hover: {
    position: 'absolute',
    right: space.l,
    bottom: space.l,
    alignItems: 'flex-end',
  },
  circle: {
    width: SIZE,
    height: SIZE,
    borderRadius: radius.pill,
    backgroundColor: color.brand.green500,
    alignItems: 'center',
    justifyContent: 'center',
    // `2` rather than `1`: this floats over the list rather than sitting on
    // it, and the shallower one would read as a flat circle printed on the
    // page.
    ...elevation['2'],
  },
  pressed: {
    backgroundColor: color.brand.green700,
  },
  sign: {
    ...type.titleLg,
    // Ink rather than paper: `NotchedButton` learned this the hard way --
    // white on `green500` is about two to one, which fails AA.
    color: color.brand.ink900,
    // The glyph's own bearing sits it low in its line box, and the title
    // role's line height makes that worse. A line height equal to the size
    // centres it in a circle that is not otherwise centred.
    lineHeight: type.titleLg.fontSize,
  },
})
