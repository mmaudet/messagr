import { useState } from 'react'
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native'
import Svg, { Path } from 'react-native-svg'

import {
  color,
  floors,
  space,
  stroke,
  type as typeScale,
} from '../design/tokens'
import { notchedRectPath, notchLegFor } from './notchGeometry'

/**
 * The primary action, and where the brand lives.
 *
 * Built before any screen on purpose: the notch appears on nearly every
 * primary action in the product, and if the geometry could not be carried
 * faithfully onto this platform that was worth finding out before three
 * screens were drawn around it. It can, by drawing the shape rather than
 * clipping it -- see notchGeometry.ts for the translation and why it is not
 * faked with a triangle painted in the background colour.
 *
 * # The height decides the cut, not a constant
 *
 * The leg is derived from whatever height this button actually lays out at,
 * which is why it is measured rather than assumed. A fixed cut looks
 * deliberate at one size and like a mistake at every other.
 *
 * # Both palettes
 *
 * The dark palette is a second set of values, not the light one dimmed: its
 * "text and border" green is *lighter* than its primary, because the role
 * survives the inversion and the value does not. Reading the scheme here and
 * indexing the token file is what keeps that true without this component
 * knowing why.
 */
export interface NotchedButtonProps {
  readonly label: string
  /**
   * Whether the button takes the width it is given.
   *
   * Inline by default, which is right for an action sitting beside text. The
   * brand screen's own action is full width in the prototype, and a notch cut
   * into a button that only wraps its label is a much smaller gesture than
   * the one that mockup draws.
   */
  readonly wide?: boolean
  readonly onPress?: () => void
  /** Reported through `onGeometry` so a device test can assert the shape. */
  readonly testID?: string
  /**
   * Called with the geometry this button actually laid out at. The shape is
   * the product's, so something has to be able to check it on a device
   * rather than only in a unit test.
   */
  readonly onGeometry?: (geometry: { height: number; leg: number }) => void
  /**
   * What the button is, in the palette's own vocabulary.
   *
   * `brand` is `green500`, whose token reads *« Humain et vérifié. Action
   * principale, accusé de lecture, marque. »* — so it is the principal action
   * and nothing else.
   *
   * `measure` is `deny.500`: *« Action de mesure. Jamais un avertissement. »*
   * Removing somebody from a conversation is a measure. It was green until
   * this existed, which said the wrong thing twice over: it spent the colour
   * reserved for a verified human on taking one away.
   *
   * `quiet` carries no fill and a border instead. It exists so a refusal can
   * be a button of the same rank as the thing it refuses — see `Vouch` and
   * `Evict`, and the prototype's own rule for the verification screen:
   * *« Le refus est un bouton de même rang que l'acceptation. »*
   */
  readonly tone?: 'brand' | 'measure' | 'quiet'
}

export function NotchedButton({
  label,
  wide = false,
  onPress,
  testID,
  onGeometry,
  tone = 'brand',
}: NotchedButtonProps) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(
    null,
  )
  // THE LIGHT PALETTE, NOT THE SYSTEM'S THEME.
  //
  // This read `useColorScheme()` and switched to `color.dark`. Four
  // components did, and nothing else in the application does -- so on a
  // phone set to dark mode these four turned dark inside screens that stayed
  // pale: a black composer under a paper conversation, reported from an
  // iPhone on 7 September 2026 with the words "meme pb de fond".
  //
  // The application has a light palette and a dark one reserved for surfaces
  // that ASK for it -- the promise screen, a photograph full screen. Which
  // ground a component sits on is its parent's business, which is why
  // `LanguagePicker` takes `onDark` and does not guess. A component that reads
  // the system theme is guessing, and it guessed wrong here.
  const palette = color

  function measure(event: LayoutChangeEvent) {
    const { width, height } = event.nativeEvent.layout
    setSize({ width, height })
    onGeometry?.({ height, leg: notchLegFor(height) })
  }

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      onLayout={measure}
      style={[styles.button, wide && styles.wide]}
      accessibilityRole="button"
      accessibilityLabel={label}>
      {/* Behind the label rather than around it: the shape is painted, and a
          label inside an Svg would not wrap, select or scale with the
          system's text size. */}
      {size !== null && (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <Svg width={size.width} height={size.height}>
            <Path
              d={notchedRectPath(
                size.width,
                size.height,
                notchLegFor(size.height),
              )}
              fill={
                tone === 'measure'
                  ? palette.deny['500']
                  : tone === 'quiet'
                    ? 'transparent'
                    : palette.brand.green500
              }
              stroke={tone === 'quiet' ? palette.neutral['300'] : undefined}
              strokeWidth={tone === 'quiet' ? stroke.base : undefined}
            />
          </Svg>
        </View>
      )}
      {/* INK ON GREEN, NOT PAPER ON GREEN.
          Every one of the prototype's fourteen primary buttons is dark ink on
          the brand green, and this was light on green until somebody compared
          them. It is not only an off-brand button: paper on green500 measures
          about 2:1, which fails the AA threshold for text, while ink on the
          same green is comfortably above it. The mockup's choice was the
          accessible one and this was not. */}
      {/* The label's colour follows the fill. Ink on green and on the
          measure red -- both are light enough that paper would fail AA, which
          `NotchedButton` learned the hard way -- and the neutral ink on the
          quiet one, which has no fill at all. */}
      <Text
        style={[
          styles.label,
          {
            color:
              tone === 'quiet' ? palette.neutral['900'] : palette.brand.ink900,
          },
        ]}>
        {label}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  button: {
    // The floor is geometry rather than a token, which is why it is asserted
    // here: no provenance rule can reach a touch target's height.
    minHeight: floors.touchTargetMin,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: space.l,
    paddingVertical: space.m,
    alignSelf: 'flex-start',
  },
  wide: { alignSelf: 'stretch' },
  // The prototype's fourteen primary buttons are all at 16, which is its own
  // role now rather than the nearest body size.
  label: typeScale.action,
})
