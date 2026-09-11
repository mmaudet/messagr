import React from 'react'
import Svg, { Circle, Path, Rect } from 'react-native-svg'

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

export type TabGlyph =
  | 'chat'
  | 'community'
  | 'calls'
  | 'settings'
  // The composer's three, and they are the identity's own like the four
  // above: `messagr-icon-emoji.svg`, `-cam.svg` and `-mic.svg`, transcribed
  // rather than redrawn. #101 refused to draw the tab icons here for exactly
  // this reason -- a set with a deliberate voice, 24 grid, 1.5 stroke,
  // `currentColor`, and no icon carrying a colour of its own.
  | 'emoji'
  | 'cam'
  | 'mic'
  | 'plus'
  | 'camera'
  | 'copy'
  | 'forward'
  | 'star'
  | 'star.on'
  | 'save'
  | 'bin'
  // The loudspeaker, for the in-call control. NOT from `design/icons/`: the
  // identity has no speaker glyph, because until there were calls there was
  // nothing to draw one for. Built on the same rules as the set it joins --
  // 24 grid, 1.5 stroke, `currentColor` -- so it sits beside them without
  // announcing that it came later. It is a cone and two waves, which is what
  // every speaker glyph has been since the first one.
  //
  // FOUR MORE, FOR THE SELECTION BAR, and the same door as the speaker.
  //
  // The bar said its actions in words, deliberately: the identity has no bin
  // and no clipboard, two words survive every catalogue without anybody
  // guessing at a pictogram, and they read aloud for free. That held while
  // there were three actions. There are five now -- copy, forward, keep,
  // save, remove -- and measured on a Pixel 10 Pro Fold the row broke: the
  // count was squeezed into a one-character-wide column reading « 1 sé le
  // cti on né (s) » down the screen. Reported with a screenshot and the ask
  // that it be « un bandeau sur une ligne uniquement, comme WhatsApp ».
  //
  // So these are drawn here on the identity's own rules, exactly as the
  // speaker was, and each is the shape its action has had since long before
  // this product: two sheets, an arrow leaving, a star, a tray, a bin. The
  // words do not disappear -- they become the accessibility labels, which is
  // where they were doing the work that mattered.
  | 'speaker'

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

      {glyph === 'speaker' && (
        <>
          <Path
            d="M11.5 4.8 6.8 8.6H3.9a.9.9 0 0 0-.9.9v5a.9.9 0 0 0 .9.9h2.9l4.7 3.8z"
            stroke={tint}
            {...STROKE}
          />
          <Path d="M15.4 9.2a4 4 0 0 1 0 5.6" stroke={tint} {...STROKE} />
          <Path d="M18.1 6.6a7.7 7.7 0 0 1 0 10.8" stroke={tint} {...STROKE} />
        </>
      )}
      {/* Two sheets, the back one offset. Every clipboard glyph since the
          first one is this, and a clipboard with a clip on it would be a
          board rather than the act of copying. */}
      {glyph === 'copy' && (
        <>
          <Rect
            x={9}
            y={9}
            width={11}
            height={11}
            rx={2}
            stroke={tint}
            {...STROKE}
          />
          <Path
            d="M5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5"
            stroke={tint}
            {...STROKE}
          />
        </>
      )}

      {/* An arrow leaving to the right, over a line that stays. Forwarding is
          a copy that goes somewhere, so the arrow leaves and nothing is
          drawn as removed. */}
      {glyph === 'forward' && (
        <>
          <Path d="m14 6 6 6-6 6" stroke={tint} {...STROKE} />
          <Path d="M20 12H8a4 4 0 0 0-4 4v2" stroke={tint} {...STROKE} />
        </>
      )}

      {/* A five-pointed star, outlined when the message is not kept and
          filled when it is. The fill is the whole state: §13 refuses a state
          carried by colour alone, and full against empty is a shape. */}
      {(glyph === 'star' || glyph === 'star.on') && (
        <Path
          d="M12 3.6l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"
          stroke={tint}
          {...STROKE}
          {...(glyph === 'star.on' ? { fill: tint } : {})}
        />
      )}

      {/* An arrow coming down into a tray. Not a cloud and not a disk: the
          photograph is already here, and what the gesture does is put it
          somewhere else on this same telephone. */}
      {glyph === 'save' && (
        <>
          <Path d="M12 3.5v10" stroke={tint} {...STROKE} />
          <Path d="m8 9.6 4 4 4-4" stroke={tint} {...STROKE} />
          <Path
            d="M4 15.5v3A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5v-3"
            stroke={tint}
            {...STROKE}
          />
        </>
      )}

      {/* A bin with a lid and two staves. The one glyph the identity most
          conspicuously lacks, and the one whose meaning is least in doubt. */}
      {glyph === 'bin' && (
        <>
          <Path d="M4 6.5h16" stroke={tint} {...STROKE} />
          <Path
            d="M9.5 6.5V4.8A1.3 1.3 0 0 1 10.8 3.5h2.4a1.3 1.3 0 0 1 1.3 1.3v1.7"
            stroke={tint}
            {...STROKE}
          />
          <Path
            d="M6 6.5l.9 12.1A1.5 1.5 0 0 0 8.4 20h7.2a1.5 1.5 0 0 0 1.5-1.4L18 6.5"
            stroke={tint}
            {...STROKE}
          />
          <Path d="M10.3 10v6" stroke={tint} {...STROKE} />
          <Path d="M13.7 10v6" stroke={tint} {...STROKE} />
        </>
      )}

      {glyph === 'calls' && (
        <Path
          d="M5 3.5h3l1.7 4.2-2.1 1.6a11.5 11.5 0 0 0 5.6 5.6l1.6-2.1 4.2 1.7v3a1.7 1.7 0 0 1-1.9 1.7C9.6 18.6 5.4 14.4 3.8 5.4A1.7 1.7 0 0 1 5 3.5z"
          stroke={tint}
          {...STROKE}
        />
      )}

      {glyph === 'emoji' && (
        <>
          <Circle cx={12} cy={12} r={9} stroke={tint} {...STROKE} />
          <Path
            d="M9 14.5c1 1 2 1.5 3 1.5s2-.5 3-1.5"
            stroke={tint}
            {...STROKE}
          />
          {/* Filled and unstroked, which is the file's own instruction:
              `fill="currentColor" stroke="none"`. The eyes are dots, not
              rings, and stroking them would close them. */}
          <Circle cx={9.2} cy={9.8} r={0.9} fill={tint} />
          <Circle cx={14.8} cy={9.8} r={0.9} fill={tint} />
        </>
      )}

      {glyph === 'camera' && (
        <>
          {/* The body with the viewfinder's bump, and the lens. Given by the
              account holder on 6 September 2026 and transcribed at the set's
              own 1.5 rather than the 1.6 it arrived at: an icon that is a
              tenth heavier than its twenty-two neighbours reads as a
              different weight of line, not as a different icon. */}
          <Path
            d="M4 8.5a2 2 0 0 1 2-2h2.2l1.2-1.6a1.2 1.2 0 0 1 1-.5h3.2a1.2 1.2 0 0 1 1 .5l1.2 1.6H18a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"
            stroke={tint}
            {...STROKE}
          />
          <Circle cx={12} cy={13} r={3.6} stroke={tint} {...STROKE} />
        </>
      )}

      {glyph === 'plus' && (
        <Path d="M12 5v14M5 12h14" stroke={tint} {...STROKE} />
      )}

      {glyph === 'cam' && (
        <>
          <Rect
            x={2.5}
            y={6.5}
            width={13}
            height={11}
            rx={2.4}
            stroke={tint}
            {...STROKE}
          />
          <Path d="M15.5 11l6-3.4v8.8l-6-3.4z" stroke={tint} {...STROKE} />
        </>
      )}

      {glyph === 'mic' && (
        <>
          <Path
            d="M12 3a3 3 0 013 3v5a3 3 0 01-6 0V6a3 3 0 013-3z"
            stroke={tint}
            {...STROKE}
          />
          <Path d="M5.5 11a6.5 6.5 0 0013 0" stroke={tint} {...STROKE} />
          <Path d="M12 17.5V21" stroke={tint} {...STROKE} />
        </>
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
