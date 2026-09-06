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
  testID = 'language-strip',
}: {
  readonly chosen: Language
  /** Fires while the thumb moves. Retranslates; does not persist. */
  readonly onChoose: (language: Language) => void
  /** Fires when the strip stops. This is the one that persists. */
  readonly onSettle?: (language: Language) => void
  /** Whether the ground behind it is `ink900`. See the note above. */
  readonly onDark?: boolean
  readonly testID?: string
}) {
  // The last one reported, so a drag inside one item reports nothing. A ref
  // rather than state: this is compared during a scroll, and a re-render for
  // the comparison's own sake would be a re-render per frame.
  const reported = useRef<Language>(chosen)

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

  return (
    <ScrollView
      testID={testID}
      // Bounded, because a column inside a screen that scrolls must not
      // scroll the screen instead. Four rows of room and six languages, so
      // the list is visibly a list -- something that can be moved -- rather
      // than a stack that happens to be cut off.
      style={styles.rail}
      showsVerticalScrollIndicator={false}
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
}

const styles = StyleSheet.create({
  // Four rows deep. Six languages do not fit, and that is the point: a list
  // that ends inside the frame gives no reason to move it.
  rail: { maxHeight: ITEM * 4 },
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
