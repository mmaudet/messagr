import { useState } from 'react'
import {
  Pressable,
  StyleSheet,
  Text,
  useColorScheme,
  View,
  type LayoutChangeEvent,
} from 'react-native'
import Svg, { Path } from 'react-native-svg'

import { color, floors, space, type as typeScale } from '../design/tokens'
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
  readonly onPress?: () => void
  /** Reported through `onGeometry` so a device test can assert the shape. */
  readonly testID?: string
  /**
   * Called with the geometry this button actually laid out at. The shape is
   * the product's, so something has to be able to check it on a device
   * rather than only in a unit test.
   */
  readonly onGeometry?: (geometry: { height: number; leg: number }) => void
}

export function NotchedButton({
  label,
  onPress,
  testID,
  onGeometry,
}: NotchedButtonProps) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(
    null,
  )
  const dark = useColorScheme() === 'dark'
  const palette = dark ? color.dark : color

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
      style={styles.button}
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
              fill={palette.brand.green500}
            />
          </Svg>
        </View>
      )}
      <Text style={[styles.label, { color: palette.surface.paper }]}>
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
  label: typeScale.body,
})
