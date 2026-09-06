import React from 'react'
import { View } from 'react-native'
import Svg, { Path, Rect } from 'react-native-svg'

import { color } from '../design/tokens'
import { pathOf, QUIET, qrOf } from '../runtime/qr'

/**
 * A link, drawn as something a camera can read.
 *
 * The encoder is `qr.ts`, which is a port of the one the website's `/i/` page
 * carries and is decoded by its own tests. This draws what it returns and
 * knows nothing else about QR codes.
 *
 * # The quiet zone is part of the symbol
 *
 * Four modules of light on every side. Not padding: a decoder needs it to
 * find the edges, and a symbol drawn flush against a coloured screen is one
 * that will not scan for a reason nobody can see. It is inside the `viewBox`
 * rather than around the component so no layout can take it away.
 *
 * # The path is arithmetic, so it is not in here
 *
 * `pathOf` builds it, next to the encoder, where a test paints it back into
 * pixels and decodes it. Arithmetic in a component is arithmetic nothing runs
 * except a device.
 *
 * # Nothing when it cannot be drawn
 *
 * `qrOf` answers null for a string no version holds. The screen above still
 * has the link, which is the path that has to keep working -- so this returns
 * nothing rather than an empty frame that looks like a broken symbol.
 */
export function QrCode({
  /** What the symbol encodes, character for character. */
  text,
  /** The drawn side, in points. */
  size,
  testID,
  accessibilityLabel,
}: {
  readonly text: string
  readonly size: number
  readonly testID?: string
  readonly accessibilityLabel?: string
}) {
  const symbol = qrOf(text)
  if (symbol === null) return null

  const span = symbol.side + QUIET * 2

  return (
    <View testID={testID} accessibilityLabel={accessibilityLabel}>
      <Svg width={size} height={size} viewBox={`0 0 ${span} ${span}`}>
        {/* The light ground is drawn rather than left to the screen behind
            it: the contrast a decoder needs is between the two shades of the
            symbol, and a translucent ground makes that whatever is under it. */}
        <Rect
          x={0}
          y={0}
          width={span}
          height={span}
          fill={color.surface.raised}
        />
        <Path d={pathOf(symbol)} fill={color.brand.ink900} />
      </Svg>
    </View>
  )
}
