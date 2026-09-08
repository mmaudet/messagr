import React, { useRef, useState } from 'react'
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'

import { t } from '../copy'
import { color, floors, radius, space, type } from '../design/tokens'
import { EMOJI } from './emojiCatalogue'

/**
 * The whole catalogue, behind the `+` at the end of the reaction row.
 *
 * # WHY THE SIX ARE STILL THE SIX
 *
 * The row on the bubble offers six keys and said so: "a full emoji keyboard
 * is a different screen and a different ticket; six covers what a reaction is
 * for". That was right about the row and wrong about the ceiling -- somebody
 * who wants a seventh was told to say it in words, and the account holder
 * asked for what WhatsApp does instead: the quick six, and a `+` that opens
 * everything.
 *
 * So the six stay where a thumb already finds them, and this is the second
 * tap for the rest. Nothing moves for the person who wanted 👍.
 *
 * # A SHEET, NOT A KEYBOARD
 *
 * The system's emoji keyboard cannot be opened without a text field to open
 * it into, and a hidden field behind a reaction row would be a text field
 * this product does not want. `emojiCatalogue.ts` says why the list is
 * written down rather than enumerated from Unicode.
 *
 * # THE CATEGORY TABS SCROLL THE GRID, THEY DO NOT REPLACE IT
 *
 * One long grid with headings, and the tabs jump to a heading -- which is
 * what every emoji keyboard does, and it is why scrolling past the end of
 * "visages" lands in "gestes" rather than in nothing.
 */

/** How many keys fit across. Seven is what a 44pt target gives on a 360dp phone. */
const ACROSS = 7

export function EmojiPicker({
  onChoose,
  onClose,
}: {
  readonly onChoose: (key: string) => void
  readonly onClose: () => void
}) {
  const grid = useRef<React.ComponentRef<typeof ScrollView>>(null)
  // Where each group starts, measured rather than computed: the rows wrap, so
  // only a layout knows how tall a group turned out.
  const [starts, setStarts] = useState<ReadonlyMap<string, number>>(new Map())
  const [at, setAt] = useState(0)

  return (
    <Modal
      visible
      transparent
      animationType="slide"
      onRequestClose={onClose}
      testID="emoji-picker">
      <View style={styles.over}>
        <Pressable
          testID="emoji-scrim"
          style={styles.scrim}
          accessibilityRole="button"
          accessibilityLabel={t('emoji_close')}
          onPress={onClose}
        />
        <View style={styles.sheet}>
          <View style={styles.head}>
            <Text style={styles.heading}>{t('emoji_title')}</Text>
            <Pressable
              testID="emoji-close"
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel={t('emoji_close')}
              style={styles.close}>
              <Text style={styles.closeLabel}>{t('emoji_close')}</Text>
            </Pressable>
          </View>

          {/* THE TABS. Their own row, horizontal, because eight categories do
              not fit across a telephone at a size a thumb can hit. */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.tabs}>
            {EMOJI.map((group, index) => (
              <Pressable
                key={group.label}
                testID={`emoji-tab-${group.label}`}
                onPress={() => {
                  setAt(index)
                  grid.current?.scrollTo({
                    y: starts.get(group.label) ?? 0,
                    animated: true,
                  })
                }}
                accessibilityRole="tab"
                accessibilityState={{ selected: at === index }}
                accessibilityLabel={t(group.label)}
                style={[styles.tab, at === index && styles.tabOn]}>
                <Text style={styles.tabGlyph}>{group.tab}</Text>
              </Pressable>
            ))}
          </ScrollView>

          <ScrollView
            ref={grid}
            testID="emoji-grid"
            style={styles.grid}
            showsVerticalScrollIndicator={false}>
            {EMOJI.map(group => (
              <View
                key={group.label}
                onLayout={event => {
                  const y = event.nativeEvent.layout.y
                  setStarts(held => {
                    if (held.get(group.label) === y) return held
                    const next = new Map(held)
                    next.set(group.label, y)
                    return next
                  })
                }}>
                <Text style={styles.groupLabel}>{t(group.label)}</Text>
                <View style={styles.keys}>
                  {group.keys.map(key => (
                    <Pressable
                      key={`${group.label}-${key}`}
                      testID={`emoji-${key}`}
                      onPress={() => onChoose(key)}
                      accessibilityRole="button"
                      accessibilityLabel={key}
                      style={({ pressed }) => [
                        styles.key,
                        pressed && styles.keyPressed,
                      ]}>
                      <Text style={styles.keyGlyph}>{key}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  over: { flex: 1, justifyContent: 'flex-end' },
  scrim: {
    ...StyleSheet.absoluteFill,
    // The ink and an opacity, as `Plate.tsx` and `LanguagePicker.tsx`: the
    // palette carries no translucent value and invariant 11 forbids one.
    backgroundColor: color.brand.ink900,
    opacity: 0.62,
  },
  sheet: {
    backgroundColor: color.surface.paper,
    borderTopLeftRadius: radius.bubble,
    borderTopRightRadius: radius.bubble,
    paddingTop: space.m,
    paddingHorizontal: space.s,
    // Half the screen. A sheet that covers everything is a screen, and this
    // one is opened over a conversation somebody is reading.
    maxHeight: '58%',
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.m,
  },
  heading: { ...type.titleMd, color: color.neutral['900'] },
  close: { minHeight: floors.touchTargetMin, justifyContent: 'center' },
  closeLabel: { ...type.action, color: color.brand.green700 },
  tabs: { gap: space.xs, paddingHorizontal: space.s, paddingVertical: space.s },
  tab: {
    minWidth: floors.touchTargetMin,
    minHeight: floors.touchTargetMin,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  // The same pale-green pill the active tab and the chosen language wear.
  tabOn: { backgroundColor: color.brand.green100 },
  tabGlyph: { ...type.titleMd },
  grid: { paddingHorizontal: space.s },
  groupLabel: {
    ...type.caption,
    color: color.neutral['600'],
    paddingHorizontal: space.s,
    paddingTop: space.s,
    paddingBottom: space.xs,
  },
  keys: { flexDirection: 'row', flexWrap: 'wrap' },
  key: {
    width: `${100 / ACROSS}%`,
    height: floors.touchTargetMin,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  keyPressed: { backgroundColor: color.neutral['200'] },
  keyGlyph: { ...type.titleLg },
})
