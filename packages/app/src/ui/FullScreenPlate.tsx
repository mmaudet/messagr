import React, { useRef, useState } from 'react'
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type GestureResponderEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native'

import { GestureHandlerRootView } from 'react-native-gesture-handler'

import { t } from '../copy'
import { color, floors, layout, radius, space, type } from '../design/tokens'
import type { ShownImage } from '../runtime/receiveImage'
import type { ReadFile } from '../timeline/imageEvent'
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
 *
 * # The one surface that asks for the photograph itself
 *
 * Everywhere else draws the sender's thumbnail (#117). Here the picture is
 * the screen, so a thumbnail upscaled to it would be visibly soft -- and here
 * the photograph is affordable, because it is one at a time and its quarter
 * second of base64 blocks a thread nothing else is drawing on.
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
  readonly fetch: (file: ReadFile) => Promise<ShownImage>
  readonly onClose: () => void
}) {
  const entries = plate.entries
  const opening = Math.min(Math.max(at, 0), Math.max(entries.length - 1, 0))
  const [showing, setShowing] = useState(opening)
  const { width, height } = useWindowDimensions()
  // A zoomed photograph owns the drag. `Pinchable` says why the pager has to
  // give it up rather than the two of them sharing it.
  const [zoomed, setZoomed] = useState(false)
  /**
   * Whether two fingers are down anywhere on this screen.
   *
   * THE PAGER WAS WINNING THE PINCH, AND CAPTURE IS WHY.
   *
   * `Pinchable` asked for the gesture with `onMoveShouldSetPanResponder
   * Capture`, on the reasoning that a ScrollView takes a drag before a child
   * sees one. That reasoning is right and the remedy was backwards: React
   * Native's capture phase runs from the root *towards* the target, so an
   * ancestor captures first -- and the pager is the ancestor. Two fingers
   * spreading move their centroid, the pager read that as a swipe and
   * claimed, and the pinch never began. Reported from the device, where it
   * simply did nothing.
   *
   * So the count is read here, above the pager, in the phase that runs before
   * it, and the handlers decline every time -- they observe, they never
   * claim. A pager that is not scrollable cannot take a drag, and `Pinchable`
   * is then the only thing left asking for it.
   */
  const [twoFingers, setTwoFingers] = useState(false)
  const watch = (event: GestureResponderEvent) => {
    const two = event.nativeEvent.touches.length >= 2
    // Only on a change: this runs on every touch move, and a `setState` per
    // frame would re-render the whole viewer under the gesture it is trying
    // to let through.
    setTwoFingers(held => (held === two ? held : two))
    return false
  }
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
      {/* ITS OWN ROOT, BECAUSE A MODAL IS ITS OWN WINDOW.
          React Native renders a `Modal` into a separate native view
          hierarchy, so the `GestureHandlerRootView` at the application's root
          does not reach inside it -- and a gesture handler with no root above
          it receives nothing and reports nothing, which looks exactly like a
          library that does not work. */}
      <GestureHandlerRootView style={styles.ground}>
        <View
          style={styles.ground}
          onStartShouldSetResponderCapture={watch}
          onMoveShouldSetResponderCapture={watch}>
          <View style={styles.bar}>
            {/* A TARGET, NOT A GLYPH.
                It was a bare arrow in the top-left corner. The touch area met
                the 44pt floor, but on a photograph with nothing behind it
                there was nothing to aim at -- and 44pt hard against the edge
                of a screen shares its room with the system's own back
                gesture. Reported from the device as small and unresponsive,
                and both halves of that were true.

                So: a plate that says where to press, and `hitSlop` past it --
                the same split the reaction chips use, where the drawn size
                and the reachable size are allowed to differ. */}
            <Pressable
              testID="plate-close"
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel={t('plate_close')}
              hitSlop={REACH}
              style={({ pressed }) => [
                styles.target,
                pressed && styles.pressed,
              ]}>
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
            scrollEnabled={!zoomed && !twoFingers}
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
                      full
                      testID={`full-${entry.eventId}`}
                    />
                  </Pinchable>
                )}
              </View>
            ))}
          </ScrollView>
        </View>
      </GestureHandlerRootView>
    </Modal>
  )
}

/**
 * How far past its plate the close control answers.
 *
 * The plate is 44 and the floor is met without this; the slop is for where it
 * sits. A control in the top-left corner of a phone shares that corner with
 * the system's back gesture and with a hand's least accurate reach, and the
 * cheapest answer to both is to make it answer sooner than it looks.
 */
const REACH = { top: space.m, bottom: space.m, left: space.m, right: space.m }

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
    width: floors.touchTargetMin,
    height: floors.touchTargetMin,
    borderRadius: radius.pill,
    // The one surface in the dark palette that is *lighter* than its ground,
    // which is what a control on a photograph needs to be found at all.
    backgroundColor: color.dark.surface.raised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Pressing says so. On a screen with no other chrome, a control that does
  // not answer the finger reads as a control that did not receive it -- which
  // is what "not responsive enough" meant.
  pressed: { backgroundColor: color.dark.surface.paper },
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
