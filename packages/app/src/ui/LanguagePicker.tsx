import React, { useState } from 'react'
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'

import { t } from '../copy'
import { LANGUAGES, type Language } from '../copy/languages'
import { color, floors, radius, space, stroke, type } from '../design/tokens'

/**
 * Choosing the language: a closed control that says what is chosen, and opens
 * a list when tapped.
 *
 * # IT WAS A SCROLLING STRIP AND NOBODY FOUND IT
 *
 * The strip was the account holder's own idea and it read well on paper: you
 * drag, and whichever language is centred is the one the screen is speaking
 * *while you drag*, so trying a language costs a thumb movement rather than a
 * decision. It even grew two chevrons when it was cut down to one row,
 * because "a row that does not look scrollable is a row nobody scrolls".
 *
 * Nobody scrolled it. A tester installed the application on 8 September 2026,
 * wanted another language, and could not find where to change it -- on the
 * first screen, where the control is the screen's own business, and again in
 * Réglages. Two chevrons were not enough of an affordance, and the argument
 * that they would be was made by people who already knew the control was
 * there.
 *
 * So: the thing every operating system does. A row showing the current
 * language with a chevron, and a list on top when it is tapped. « une liste
 * déroulante classique y compris dans la page des paramètres », in his words.
 * What is lost is the retranslate-as-you-drag trick; what is gained is that
 * somebody who cannot read the screen can see there is a choice at all, which
 * was the whole reason the control had to be legible in the first place.
 *
 * # TWO GROUNDS, STILL
 *
 * The promise screen is `ink900` and Réglages is paper, so the closed row is
 * drawn in one of two ways -- the same argument the strip before it made, and the
 * same reason `tokens.json` carries a dark palette. The open list is always
 * on paper: it is a sheet over the screen, not part of it.
 *
 * # BOTH CALLBACKS FIRE ON THE SAME TAP
 *
 * The strip needed two because a drag is not a decision: `onChoose`
 * retranslated about sixty times a second and `onSettle` was the one that
 * wrote to the keystore. A tap is a decision the moment it happens, so both
 * fire together. They stay two so the call sites do not change and so the
 * distinction survives if a gesture ever comes back.
 */

/** How tall one row of the open list is. */
const ITEM = 56

export function LanguagePicker({
  chosen,
  onChoose,
  onSettle,
  onDark = false,
  testID = 'language-picker',
}: {
  readonly chosen: Language
  /** Retranslates the screen. */
  readonly onChoose: (language: Language) => void
  /** Persists the choice. Fires on the same tap; see the note above. */
  readonly onSettle?: (language: Language) => void
  /** Whether the ground behind the closed row is `ink900`. */
  readonly onDark?: boolean
  readonly testID?: string
}) {
  const [open, setOpen] = useState(false)
  const shown =
    LANGUAGES.find(language => language.code === chosen) ?? LANGUAGES[0]

  return (
    <View>
      <Pressable
        testID={testID}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        // What it is and what it holds, in that order, because a screen
        // reader announcing only « Français » would not say it can be
        // changed.
        accessibilityLabel={`${t('language_choose')}. ${shown.endonym}`}
        accessibilityState={{ expanded: open }}
        style={({ pressed }) => [
          styles.closed,
          onDark ? styles.closedOnDark : styles.closedOnPaper,
          pressed && (onDark ? styles.pressedOnDark : styles.pressedOnPaper),
        ]}>
        <Text style={styles.flag}>{shown.flag}</Text>
        <Text
          style={[
            styles.endonym,
            onDark ? styles.endonymOnDark : styles.endonymOnPaper,
          ]}>
          {shown.endonym}
        </Text>
        {/* The one mark that says "this opens". Outside the label above so
            it is never read aloud as a word. */}
        <Text
          style={[
            styles.chevron,
            onDark ? styles.endonymOnDark : styles.endonymOnPaper,
          ]}
          pointerEvents="none">
          {'▾'}
        </Text>
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        // Android's own back gesture closes it. Without this the button does
        // nothing on the one screen where there is nothing behind to go to.
        onRequestClose={() => setOpen(false)}>
        <View style={styles.over}>
          {/* Tapping beside the sheet closes it, which is what every dropdown
              on both platforms does. A SIBLING rather than the sheet's
              parent, because the dimming is an `opacity` -- the palette has
              no translucent value and invariant 11 forbids inventing one,
              which is the same reasoning `Plate.tsx` writes down -- and
              opacity applies to children, so a sheet inside it would be
              dimmed along with the screen behind. */}
          <Pressable
            testID="language-scrim"
            style={styles.scrim}
            accessibilityRole="button"
            accessibilityLabel={t('language_close')}
            onPress={() => setOpen(false)}
          />
          <View style={styles.sheet}>
            <Text style={styles.heading}>{t('language_choose')}</Text>
            <ScrollView
              testID="language-list"
              style={styles.list}
              showsVerticalScrollIndicator={false}>
              {LANGUAGES.map(language => {
                const active = language.code === chosen
                return (
                  <Pressable
                    key={language.code}
                    testID={`language-${language.code}`}
                    onPress={() => {
                      onChoose(language.code)
                      onSettle?.(language.code)
                      setOpen(false)
                    }}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={language.endonym}
                    style={({ pressed }) => [
                      styles.option,
                      active && styles.optionActive,
                      pressed && styles.pressedOnPaper,
                    ]}>
                    <Text style={styles.flag}>{language.flag}</Text>
                    <Text
                      style={[
                        styles.endonym,
                        styles.endonymOnPaper,
                        active && styles.chosenOnPaper,
                      ]}>
                      {language.endonym}
                    </Text>
                    {/* The tick REPEATS the pale pill rather than replacing
                        it: §13 wants no state carried by colour alone. */}
                    {active && <Text style={styles.tick}>{'✓'}</Text>}
                  </Pressable>
                )
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  // A BORDER, NOT A BARE ROW. The closed control has to look like a control
  // on both grounds, and the strip's failure was exactly that it did not.
  closed: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.m,
    minHeight: floors.touchTargetMin,
    paddingHorizontal: space.m,
    paddingVertical: space.s,
    borderRadius: radius.pill,
    borderWidth: stroke.base,
  },
  closedOnDark: {
    borderColor: color.agent['400'],
    backgroundColor: color.brand.ink900,
  },
  closedOnPaper: {
    borderColor: color.neutral['300'],
    backgroundColor: color.surface.paper,
  },
  pressedOnDark: { backgroundColor: color.neutral['900'] },
  pressedOnPaper: { backgroundColor: color.neutral['200'] },
  flag: { ...type.titleLg },
  // `flex: 1` so the chevron sits at the far edge on any width.
  endonym: { ...type.body, flex: 1 },
  endonymOnDark: { color: color.agent['400'] },
  endonymOnPaper: { color: color.neutral['900'] },
  chosenOnPaper: { color: color.brand.green700 },
  chevron: { ...type.body },
  over: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: space.xl,
  },
  scrim: {
    ...StyleSheet.absoluteFill,
    // The ink and an opacity, exactly as `Plate.tsx`: the darkest ground the
    // palette has, dimmed, rather than a translucent value invented here.
    backgroundColor: color.brand.ink900,
    opacity: 0.62,
  },
  sheet: {
    backgroundColor: color.surface.paper,
    borderRadius: radius.bubble,
    paddingVertical: space.m,
    paddingHorizontal: space.s,
    gap: space.s,
  },
  heading: {
    ...type.caption,
    color: color.neutral['600'],
    paddingHorizontal: space.m,
  },
  // THE HALF ROW IS THE POINT. Bounded so the sheet never pushes off the
  // screen -- but bounded on a half row rather than a whole one, because
  // there are seven languages now and a list cut cleanly at six looks like a
  // list of six. That is the same mistake as the strip above: an affordance
  // obvious to whoever already knows what is below it. Whoever came here for
  // the seventh language is exactly the person who must not have to guess.
  list: { maxHeight: ITEM * 6.5 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.m,
    height: ITEM,
    paddingHorizontal: space.m,
    borderRadius: radius.pill,
  },
  // The same pale-green pill the active tab wears, used again rather than
  // invented here.
  optionActive: { backgroundColor: color.brand.green100 },
  tick: { ...type.body, color: color.brand.green700 },
})
