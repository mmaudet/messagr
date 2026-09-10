import React from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import {
  color,
  elevation,
  floors,
  radius,
  space,
  stroke,
  type,
} from '../design/tokens'

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
 *
 * # And a second circle, which is why `quiet` exists
 *
 * Returning to the newest message wants the same corner: it is the same
 * thumb, reaching for the same place, and a person scrolled into last week's
 * history should not have to find a new one. It is not the same claim, so it
 * is not the same green -- see `quietCircle`. The two never show at once:
 * inviting belongs to the list, returning belongs to a conversation.
 */

export function FloatingAction({
  label,
  onPress,
  testID,
  mark,
  quiet = false,
}: {
  /** Read aloud. The circle itself carries a sign, not a word. */
  readonly label: string
  readonly onPress: () => void
  readonly testID: string
  /**
   * What the circle carries. `+` when nothing says otherwise, because that
   * is what this button was built for -- inviting somebody.
   */
  readonly mark?: string
  /**
   * A quieter circle, for an action that helps rather than one that starts
   * something. Returning to the newest message is the second kind: it is
   * always available and never the point of the screen.
   */
  readonly quiet?: boolean
}) {
  return (
    // LAID OUT ABOVE THE BAR, NOT POSITIONED OVER IT.
    //
    // Two attempts placed this absolutely and offset it by the bar's height
    // -- first computed from tokens, then measured with `onLayout`. Both came
    // out on a device with the circle's bottom painted over by the bar, and
    // the second was worse than the first because it looked principled. The
    // caller puts this in a column above the bar now, so there is no offset
    // to get wrong: a thing laid out above another thing cannot overlap it.
    //
    // The wrapper is what takes the row; the button is what is pressed. Kept
    // apart so the touch target is the circle and not the corner beside it.
    <View style={styles.hover} pointerEvents="box-none">
      <Pressable
        testID={testID}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={({ pressed }) => [
          styles.circle,
          quiet && styles.quietCircle,
          pressed && (quiet ? styles.quietPressed : styles.pressed),
        ]}>
        {/* A sign rather than an icon file: `design/icons/` has no plus, and
            a plus drawn here would be this repository's hand in an identity
            that has a voice. The character is the same stroke weight as the
            typeface around it, which is more than a redrawn one would be. */}
        <Text style={[styles.sign, quiet && styles.quietSign]}>
          {mark ?? '+'}
        </Text>
      </Pressable>
    </View>
  )
}

const SIZE = floors.touchTargetMin + space.m

const styles = StyleSheet.create({
  hover: {
    alignItems: 'flex-end',
    paddingRight: space.l,
    paddingBottom: space.l,
  },
  circle: {
    width: SIZE,
    height: SIZE,
    // `avatar`, not `pill`. `pill` is 26 and this is 56 across, so a pill
    // radius draws a squircle -- the token for a circle of any size is the
    // one whose value is a percentage, and nothing was using it.
    borderRadius: radius.avatar,
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
  // THE QUIET CIRCLE IS THE SAME CIRCLE, PAINTED PAPER.
  //
  // Same size, same place, same elevation: it has to be reachable by the
  // thumb that already knows where the green one is. What changes is what it
  // claims -- `raised` is the value of a surface that is offered rather than
  // one that is the point of the screen, and green500 is *« action
  // principale »* in the token's own words. Returning to the newest message
  // is not the principal action of a conversation; typing in it is.
  quietCircle: {
    backgroundColor: color.surface.raised,
    // Without it, a white circle on `sunk` is a white circle with a shadow
    // and nothing else -- readable, but only because of the shadow, which is
    // the one part of this that Android draws differently.
    borderWidth: stroke.base,
    borderColor: color.neutral['200'],
  },
  quietPressed: {
    backgroundColor: color.surface.sunk,
  },
  quietSign: {
    color: color.neutral['900'],
  },
  sign: {
    ...type.titleLg,
    // Ink rather than paper: `NotchedButton` learned this the hard way --
    // white on `green500` is about two to one, which fails AA.
    color: color.brand.ink900,
    // THE GLYPH IS CENTRED BY ITS FONT METRICS, NOT BY REWRITING THE RAMP.
    //
    // The first attempt set `lineHeight: type.titleLg.fontSize`, which turns
    // 22/27 into 22/22 -- a ratio of 1.0 under a floor of 1.2, and exactly
    // the move `tokens.ts` warns about: "Splitting them is how a line-height
    // floor gets broken." It also passed provenance, because a member
    // expression is not a literal. Found in review.
    //
    // Android's extra font padding is what actually sat the sign low; turning
    // it off centres the glyph with the ramp intact.
    includeFontPadding: false,
    textAlign: 'center',
  },
})
