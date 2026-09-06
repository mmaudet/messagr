import React from 'react'
import Svg, { Circle, Path } from 'react-native-svg'

import { icon } from '../design/tokens'

/**
 * The four tab-bar glyphs, transcribed from `design/icons/`.
 *
 * # Why transcribed rather than loaded
 *
 * React Native cannot import an `.svg` file without a transform, and adding
 * one for four glyphs would be a build-time dependency bought to avoid typing
 * four paths. The files stay the source: they carry the identity's provenance
 * and they are what a designer edits. This is their transcription, and the
 * geometry is theirs verbatim.
 *
 * # `currentColor` becomes a prop
 *
 * The set's own rule is that no icon carries a colour of its own, which in
 * SVG is `currentColor` and here is `tint`. A glyph that hard-coded a colour
 * would be one the active state could not tint, and the tab bar's whole
 * signal is that the current tab is green and the others are not.
 *
 * # 20, not 24
 *
 * `tokens.json` says so, in the words of the token itself: `icon.size.md` is
 * "ligne de liste, champ de saisie, **barre d'onglets**". A glyph at 20 stays
 * centred in a 44 pt target, which is the rule the same token states next to
 * it — the size of the glyph is never the size of the button.
 */

export type TabGlyph = 'chat' | 'community' | 'calls' | 'settings'

const STROKE = {
  fill: 'none' as const,
  strokeWidth: icon.strokeWidth,
  strokeLinecap: icon.linecap,
  strokeLinejoin: icon.linejoin,
}

export function TabIcon({
  glyph,
  tint,
  size = icon.size.md,
}: {
  readonly glyph: TabGlyph
  readonly tint: string
  readonly size?: number
}) {
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${icon.grid} ${icon.grid}`}>
      {glyph === 'chat' && (
        <Path
          d="M20.5 12.2c0 4.2-3.8 7.6-8.5 7.6-1 0-2-.15-2.9-.44L4.5 20.8l1.2-3.4A7.2 7.2 0 0 1 3.5 12.2c0-4.2 3.8-7.6 8.5-7.6s8.5 3.4 8.5 7.6z"
          stroke={tint}
          {...STROKE}
        />
      )}

      {glyph === 'community' && (
        <>
          <Circle cx={9} cy={8.2} r={3.2} stroke={tint} {...STROKE} />
          <Circle cx={17} cy={9.4} r={2.4} stroke={tint} {...STROKE} />
          <Path
            d="M3.5 18.5c0-2.6 2.5-4.3 5.5-4.3s5.5 1.7 5.5 4.3"
            stroke={tint}
            {...STROKE}
          />
          <Path d="M16 14.4c2.4.2 4.5 1.6 4.5 4.1" stroke={tint} {...STROKE} />
        </>
      )}

      {glyph === 'calls' && (
        <Path
          d="M5 3.5h3l1.7 4.2-2.1 1.6a11.5 11.5 0 0 0 5.6 5.6l1.6-2.1 4.2 1.7v3a1.7 1.7 0 0 1-1.9 1.7C9.6 18.6 5.4 14.4 3.8 5.4A1.7 1.7 0 0 1 5 3.5z"
          stroke={tint}
          {...STROKE}
        />
      )}

      {glyph === 'settings' && (
        <>
          <Path d="M3.5 7h17" stroke={tint} {...STROKE} />
          <Path d="M3.5 12h17" stroke={tint} {...STROKE} />
          <Path d="M3.5 17h17" stroke={tint} {...STROKE} />
          {/* Filled, and the only fill in the set: these are the handles on
              the sliders, and an outlined handle at this size closes up into
              a dot anyway. */}
          <Circle cx={9} cy={7} r={2.1} fill={tint} />
          <Circle cx={15} cy={12} r={2.1} fill={tint} />
          <Circle cx={8} cy={17} r={2.1} fill={tint} />
        </>
      )}
    </Svg>
  )
}
