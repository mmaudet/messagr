import React, { useRef, useState } from 'react'
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native'

import { t } from '../copy'
import { color, floors, layout, space, type } from '../design/tokens'
import type { ShownImage } from '../runtime/receiveImage'
import type { ReadImage } from '../timeline/imageEvent'
import type { Plate } from '../timeline/plates'
import { Photograph } from './Photograph'
import { Pinchable } from './Pinchable'

/**
 * A plate, one photograph at a time, filling the screen.
 *
 * # The gesture is a swipe, and it did not need a library
 *
 * The first version put a chevron in each bottom corner, on the reasoning
 * that a swipe wants a gesture handler this application does not carry. That
 * reasoning was wrong: React Native pages a horizontal `ScrollView` by
 * itself. So the gesture is the swipe -- what a hand does to a photograph
 * without being told -- at no dependency and less code than the chevrons
 * cost.
 *
 * They are gone with it. Two controls doing what the swipe already does is
 * the second entrance this codebase keeps taking out, and a paged scroll
 * view is a thing a screen reader already knows how to walk.
 *
 * # It pages through the whole plate, not the four that were drawn
 *
 * The grid shows four and counts the rest. Somebody who taps the count is
 * asking to see what the count stands for, and a viewer that could only
 * reach the four already on screen would answer a question nobody asked.
 *
 * # Dark ground, and it is the only screen that gets one
 *
 * `ink900` is the token for a security boundary and this is not one -- it is
 * here because a photograph is the content, and a pale ground around it
 * changes how the photograph reads. Recorded rather than smuggled: a reader
 * revisiting invariant 11 should find the reason next to the use.
 */

export function FullScreenPlate({
  plate,
  at,
  fetch,
  onClose,
}: {
  readonly plate: Plate
  /** Which photograph to open on. */
  readonly at: number
  readonly fetch: (image: ReadImage) => Promise<ShownImage>
  readonly onClose: () => void
}) {
  const entries = plate.entries
  const opening = Math.min(Math.max(at, 0), Math.max(entries.length - 1, 0))
  const [showing, setShowing] = useState(opening)
  const { width, height } = useWindowDimensions()
  // A zoomed photograph owns the drag. `Pinchable` says why the pager has to
  // give it up rather than the two of them sharing it.
  const [zoomed, setZoomed] = useState(false)
  const rail = useRef<React.ComponentRef<typeof ScrollView>>(null)

  function settled(event: NativeSyntheticEvent<NativeScrollEvent>) {
    // Rounded, not floored: the page under the middle of the viewport is the
    // one being looked at, and flooring names the one before it for half of
    // every swipe.
    const page = Math.round(event.nativeEvent.contentOffset.x / width)
    setShowing(Math.min(Math.max(page, 0), entries.length - 1))
  }

  return (
    <Modal
      visible
      transparent={false}
      animationType="fade"
      onRequestClose={onClose}
      testID="plate-full">
      <View style={styles.ground}>
        <View style={styles.bar}>
          <Pressable
            testID="plate-close"
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={t('plate_close')}
            style={styles.target}>
            <Text style={styles.chevron}>{'←'}</Text>
          </Pressable>
          <Text style={styles.of} testID="plate-of">
            {t('plate_of %1$d %2$d', showing + 1, entries.length)}
          </Text>
        </View>

        <ScrollView
          ref={rail}
          testID="plate-rail"
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          scrollEnabled={!zoomed}
          onMomentumScrollEnd={settled}
          // Where it opens. `contentOffset` is honoured on iOS; Android wants
          // the scroll after layout, which is what the callback does. Both,
          // because each platform quietly ignores the other's.
          contentOffset={{ x: opening * width, y: 0 }}
          onLayout={() =>
            rail.current?.scrollTo({ x: opening * width, animated: false })
          }
          style={styles.rail}>
          {entries.map((entry, index) => (
            <View key={entry.eventId} style={[styles.page, { width }]}>
              {entry.image !== undefined && (
                <Pinchable
                  width={width}
                  height={height}
                  active={index === showing}
                  onZoomed={setZoomed}
                  testID={`pinch-${entry.eventId}`}>
                  <Photograph
                    image={entry.image}
                    fetch={fetch}
                    testID={`full-${entry.eventId}`}
                  />
                </Pinchable>
              )}
            </View>
          ))}
        </ScrollView>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  ground: {
    flex: 1,
    backgroundColor: color.brand.ink900,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: layout.screenGutter,
    paddingTop: space.xxl,
    paddingBottom: space.s,
  },
  rail: { flex: 1 },
  page: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  target: {
    minWidth: floors.touchTargetMin,
    minHeight: floors.touchTargetMin,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chevron: {
    ...type.titleLg,
    color: color.surface.paper,
    // The line-height floor is a ratio on a *label*; a glyph centred in its
    // own 44pt target is the target's business. `titleLg` already carries a
    // compliant one -- this only stops Android padding it off centre.
    includeFontPadding: false,
    textAlign: 'center',
  },
  of: {
    ...type.monoLabel,
    color: color.agent['400'],
  },
})
