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
 * Choosing a language by dragging a thumb across flags.
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
 * # It reports on every frame of the drag, and that is deliberate
 *
 * `scrollEventThrottle` is 16, so this fires about sixty times a second and
 * calls `onChoose` each time the centred item changes — which re-renders the
 * screen in another language mid-gesture. That is the feature. It is guarded
 * by only reporting *changes*, so a drag within one item costs nothing.
 */

/** How wide one item is. Fixed, because the snap interval has to be. */
const ITEM = 132

export function LanguageStrip({
  chosen,
  onChoose,
  testID = 'language-strip',
}: {
  readonly chosen: Language
  readonly onChoose: (language: Language) => void
  readonly testID?: string
}) {
  // The last one reported, so a drag inside one item reports nothing. A ref
  // rather than state: this is compared during a scroll, and a re-render for
  // the comparison's own sake would be a re-render per frame.
  const reported = useRef<Language>(chosen)

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const at = event.nativeEvent.contentOffset.x
    // Rounded rather than floored: the item under the centre of the viewport
    // is the one being offered, and flooring would switch a full item early.
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
      horizontal
      showsHorizontalScrollIndicator={false}
      snapToInterval={ITEM}
      decelerationRate="fast"
      scrollEventThrottle={16}
      onScroll={onScroll}
      // Half an item of padding at each end, so the first and the last can
      // reach the centre. Without it neither is choosable by dragging.
      contentContainerStyle={styles.rail}>
      {LANGUAGES.map(language => {
        const active = language.code === chosen
        return (
          <Pressable
            key={language.code}
            testID={`language-${language.code}`}
            onPress={() => onChoose(language.code)}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            accessibilityLabel={language.endonym}
            style={styles.slot}>
            <View style={[styles.card, active && styles.cardActive]}>
              <Text style={styles.flag}>{language.flag}</Text>
              <Text style={[styles.endonym, active && styles.endonymActive]}>
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
  rail: {
    paddingHorizontal: space.xl,
  },
  slot: {
    width: ITEM,
    alignItems: 'center',
  },
  card: {
    minHeight: floors.touchTargetMin,
    paddingHorizontal: space.m,
    paddingVertical: space.s,
    borderRadius: radius.pill,
    alignItems: 'center',
    gap: space.xs,
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
  endonym: {
    ...type.caption,
    // On the dark promise screen. `agent.400` is the token whose stated use
    // is exactly this: readable on `ink900` at AA.
    color: color.agent['400'],
  },
  endonymActive: {
    color: color.brand.green700,
  },
})
