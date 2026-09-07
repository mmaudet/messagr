import React, { useRef } from 'react'
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native'

import { LANGUAGES, type Language } from '../copy/languages'
import { color, floors, radius, space, type } from '../design/tokens'

/**
 * Choosing a language by running a thumb down a list of flags.
 *
 * # The gesture is the point
 *
 * Not a dropdown. You drag, and whichever language is centred is the one the
 * screen is speaking **while you drag** — so trying a language costs a thumb
 * movement rather than a decision. Somebody who cannot read the screen behind
 * it does not have to guess which menu holds the languages: the flags are
 * visible at rest, and the screen answers as they pass.
 *
 * # A flag and the language's own name for itself
 *
 * A flag names a country and not a language. Carrying the endonym beside it
 * settles that without giving up the recognisability that made a flag worth
 * having — which matters here, since the strip has to be readable by somebody
 * who cannot read the screen behind it. `languages.ts` says the rest.
 *
 * # It appears on two opposite grounds, and marks the chosen one differently
 *
 * The promise screen is `ink900` and the settings screen is paper. The same
 * pale pill on both would be a pale blob on the dark one, and the same dark
 * text on both would be invisible there. So the dark ground marks the chosen
 * language with `dark.brand.green700` — the token whose role is *« texte et
 * bordure »*, and which the dark palette makes *lighter* than green500 rather
 * than darker, exactly for this — and the light ground keeps the pale pill the
 * active tab already wears.
 *
 * Two treatments rather than one because there are two grounds, not because
 * one of them was got wrong: `tokens.json` carries a dark palette precisely so
 * that "the same colour" is a question with two answers.
 *
 * # Two callbacks, because a drag is not a decision
 *
 * `onChoose` fires each time the centred item changes — about sixty times a
 * second while the thumb moves, guarded so a drag within one item costs
 * nothing. That is the feature: the screen retranslates as the flags pass.
 *
 * `onSettle` fires once, when the strip stops. **Only what settles is
 * written down.** The first version had one callback doing both, so crossing
 * from Français to Nederlands wrote five values into the keystore on the way
 * — five writes for one decision, and the module's own comment claimed
 * nothing was committed until you let go. A review caught the contradiction.
 * Retranslating is free; remembering is not.
 */

/**
 * How tall one row is. Fixed, because the snap interval has to be.
 *
 * IT WAS A HORIZONTAL STRIP, AND THE ACCOUNT HOLDER ASKED FOR A COLUMN. The
 * strip was his own idea and it worked on the screen it was drawn for -- the
 * first launch, full width, nothing beside it. In Réglages it sat between two
 * sections and was cut off at the right edge: « Englis… ». A column is what
 * every operating system does with a language list, and it is what a thumb
 * does without being taught -- up and down, one language to a line.
 *
 * Both screens now, at his word. One shape rather than two: a selector that
 * behaved differently in the two places it appears would be two selectors.
 */
const ITEM = 56

export function LanguageStrip({
  chosen,
  onChoose,
  onSettle,
  onDark = false,
  rows = 4,
  testID = 'language-strip',
}: {
  readonly chosen: Language
  /** Fires while the thumb moves. Retranslates; does not persist. */
  readonly onChoose: (language: Language) => void
  /** Fires when the strip stops. This is the one that persists. */
  readonly onSettle?: (language: Language) => void
  /** Whether the ground behind it is `ink900`. See the note above. */
  readonly onDark?: boolean
  /**
   * How many rows are visible at once.
   *
   * FOUR ON THE FIRST SCREEN, ONE IN SETTINGS, AND THE ACCOUNT HOLDER ASKED
   * FOR THE SECOND. On first launch the strip is the screen's business and
   * four rows say "this is a list, it moves". In Réglages it sits between
   * two sections that are each one line, and six flags there read as a
   * feature rather than as a setting. One row is a setting: it shows what is
   * chosen, and it moves.
   *
   * One number rather than two components: a selector that behaved
   * differently in the two places it appears would be two selectors, which
   * is the same argument that made it a column in both.
   */
  readonly rows?: number
  readonly testID?: string
}) {
  // The last one reported, so a drag inside one item reports nothing. A ref
  // rather than state: this is compared during a scroll, and a re-render for
  // the comparison's own sake would be a re-render per frame.
  const reported = useRef<Language>(chosen)
  const rail = useRef<React.ComponentRef<typeof ScrollView>>(null)

  // WHERE IT OPENS, AND WHY ONLY THE NARROW ONE NEEDS IT.
  //
  // Four rows deep, the chosen language is usually already in frame. One row
  // deep it is in frame only if it happens to be the first, so a settings
  // screen would show « Français » to somebody reading Español -- the exact
  // failure the web page had this morning, in another form.
  const opensAt = Math.max(
    0,
    LANGUAGES.findIndex(language => language.code === chosen),
  )

  // NO RAIL, AND THE HORIZONTAL VERSION NEEDED ONE.
  //
  // Across, half a viewport of padding at each end was load-bearing: without
  // it the last flags could not reach the centre and could not be chosen by
  // dragging at all -- watched on a device, where the strip stopped at
  // Español and the last two were reachable only by tapping, which is the
  // gesture the control exists to replace.
  //
  // Down, the row under the *top* of the frame is the one being offered, not
  // the row under the middle, so every row can reach that position by itself
  // and padding would only push the first one out of view.
  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const at = event.nativeEvent.contentOffset.y
    // Rounded rather than floored: a row is offered from halfway through its
    // own height, so a thumb that has moved most of a row has chosen it.
    const index = Math.round(at / ITEM)
    const language =
      LANGUAGES[Math.max(0, Math.min(index, LANGUAGES.length - 1))]
    if (language !== undefined && language.code !== reported.current) {
      reported.current = language.code
      onChoose(language.code)
    }
  }

  const strip = (
    <ScrollView
      ref={rail}
      testID={testID}
      // Bounded, because a column inside a screen that scrolls must not
      // scroll the screen instead. Four rows of room and six languages, so
      // the list is visibly a list -- something that can be moved -- rather
      // than a stack that happens to be cut off.
      style={[styles.rail, { maxHeight: ITEM * rows }]}
      showsVerticalScrollIndicator={false}
      // `contentOffset` is honoured on iOS; Android wants the scroll after
      // layout. Both, because each platform quietly ignores the other's --
      // the same pair `FullScreenPlate` needs for the same reason.
      contentOffset={{ x: 0, y: opensAt * ITEM }}
      onLayout={() =>
        rail.current?.scrollTo({ y: opensAt * ITEM, animated: false })
      }
      nestedScrollEnabled
      snapToInterval={ITEM}
      decelerationRate="fast"
      scrollEventThrottle={16}
      onScroll={onScroll}
      // Both, because a flick ends in momentum and a slow drag does not.
      // Either one is the moment the strip stopped, and only one of them
      // fires for any given gesture.
      onMomentumScrollEnd={() => onSettle?.(reported.current)}
      onScrollEndDrag={() => onSettle?.(reported.current)}>
      {LANGUAGES.map(language => {
        const active = language.code === chosen
        return (
          <Pressable
            key={language.code}
            testID={`language-${language.code}`}
            onPress={() => {
              // A tap is a decision the moment it happens: nothing to settle
              // afterwards, so both callbacks fire together.
              reported.current = language.code
              onChoose(language.code)
              onSettle?.(language.code)
            }}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            accessibilityLabel={language.endonym}
            style={styles.slot}>
            <View style={[styles.card, active && !onDark && styles.cardActive]}>
              <Text style={styles.flag}>{language.flag}</Text>
              <Text
                style={[
                  styles.endonym,
                  onDark ? styles.endonymOnDark : styles.endonymOnPaper,
                  active &&
                    (onDark ? styles.chosenOnDark : styles.chosenOnPaper),
                ]}>
                {language.endonym}
              </Text>
            </View>
          </Pressable>
        )
      })}
    </ScrollView>
  )

  if (rows > 1) return strip

  // A ROW THAT DOES NOT LOOK SCROLLABLE IS A ROW NOBODY SCROLLS.
  //
  // Four rows say what they are by being cut off at the bottom. One row says
  // nothing, so the affordance has to be drawn: two chevrons, outside the
  // scrolling area so they stay put, and `pointerEvents: 'none'` so they
  // never take the drag they exist to advertise.
  return (
    <View style={styles.window}>
      {strip}
      <Text style={styles.more} pointerEvents="none">
        {'⌃\n⌄'}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  // Height comes from `rows`. Four rows deep, six languages do not fit, and
  // that is the point: a list that ends inside the frame gives no reason to
  // move it. One row deep, the chevrons below say the same thing instead.
  rail: {},
  window: { justifyContent: 'center' },
  more: {
    position: 'absolute',
    right: space.m,
    // `caption`'s own line height, not a tighter one written in place:
    // invariant 11 allows only values from the token module, and a
    // hand-picked 12 here would be exactly the kind of drift it exists to
    // stop. Two lines of caption fit a 56pt row with room to spare.
    ...type.caption,
    color: color.neutral['400'],
    textAlign: 'center',
  },
  slot: {
    height: ITEM,
    justifyContent: 'center',
  },
  card: {
    minHeight: floors.touchTargetMin,
    // A ROW, NOT A CARD. The flag and the name sit side by side and the row
    // fills the width, so the whole line is the target -- which is what a
    // thumb aims at in a column, rather than a pill in the middle of it.
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.m,
    paddingVertical: space.s,
    borderRadius: radius.pill,
    gap: space.m,
  },
  cardActive: {
    // The same pale-green pill the active tab wears. One idiom for "this is
    // the one", used in both places rather than invented twice.
    backgroundColor: color.brand.green100,
  },
  flag: {
    // Larger than the label: at a glance the flag is what is being scanned,
    // and the word is what confirms it.
    ...type.titleLg,
  },
  // `body` rather than `caption` now. In a column the name is read, not
  // glanced at beside a flag, and a caption-sized word on a full-width row
  // reads as a footnote to the flag rather than as the choice.
  endonym: type.body,
  endonymOnDark: {
    // `agent.400`'s stated use is exactly this: readable on `ink900` at AA.
    color: color.agent['400'],
  },
  endonymOnPaper: {
    color: color.neutral['600'],
  },
  chosenOnDark: {
    color: color.dark.brand.green700,
  },
  chosenOnPaper: {
    color: color.brand.green700,
  },
})
