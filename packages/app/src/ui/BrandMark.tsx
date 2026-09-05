import React from 'react'
import Svg, { Path } from 'react-native-svg'

import { color } from '../design/tokens'

/**
 * The sign, and the only place this application draws it.
 *
 * The path is the identity's own, copied from the prototype rather than
 * redrawn: a mark redrawn is a mark that differs, and this one is the same
 * geometry as `design/icons` and the Play Store listing. The 45° cut across
 * its top-right corner is part of the mark itself, not the interface accent
 * the notch tokens describe — those govern buttons and cards, and a reader
 * who conflates the two ends up putting a logo's diagonal on a list row.
 *
 * `evenodd` is load-bearing: the second subpath is the cut, and under the
 * default winding rule it would fill rather than remove.
 */
export function BrandMark({
  size,
  tint = color.brand.green500,
  testID,
}: {
  readonly size: number
  readonly tint?: string
  readonly testID?: string
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" testID={testID}>
      <Path
        d="M 30 12 H 70 A 18 18 0 0 1 88 30 V 70 A 18 18 0 0 1 70 88 H 30 A 18 18 0 0 1 12 70 V 30 A 18 18 0 0 1 30 12 Z M 54 12 L 88 46 L 88 58 L 42 12 Z"
        fill={tint}
        fillRule="evenodd"
      />
    </Svg>
  )
}
