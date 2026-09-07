import React, { useEffect, useRef, useState } from 'react'
import {
  AccessibilityInfo,
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
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Svg, { Path } from 'react-native-svg'

import { t } from '../copy'
import { color, floors, layout, space, type } from '../design/tokens'
import type { ShownImage } from '../runtime/receiveImage'
import type { ReadFile } from '../timeline/imageEvent'
import type { Plate } from '../timeline/plates'
import { notchedRectPath, notchLegFor } from './notchGeometry'
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
  /**
   * Whether the controls are drawn over the photograph.
   *
   * A tap takes them away and a tap brings them back, which is what a hand
   * does to a photograph that has a button in front of it. Visible on
   * opening, because the way out has to be findable before anybody has
   * learnt the gesture.
   */
  const [chrome, setChrome] = useState(true)
  /**
   * NEVER HIDDEN WHILE A SCREEN READER IS RUNNING.
   *
   * "Tap the picture to bring the button back" is an instruction nobody
   * hears. Hiding the only control on the screen behind a gesture that has
   * no announcement would make this the one screen somebody could enter and
   * not leave, so for them the controls simply stay.
   */
  const [assistive, setAssistive] = useState(false)
  useEffect(() => {
    let wanted = true
    AccessibilityInfo.isScreenReaderEnabled()
      .then(on => {
        if (wanted) setAssistive(on)
      })
      .catch(() => {
        // A platform that will not answer is not a reason to lose the
        // viewer; the controls behave as they do for everybody else.
      })
    const watching = AccessibilityInfo.addEventListener(
      'screenReaderChanged',
      on => setAssistive(on),
    )
    return () => {
      wanted = false
      watching.remove()
    }
  }, [])
  const shown = chrome || assistive

  /**
   * Where the finger went down, when the touch is still a candidate tap.
   *
   * `null` once it stops being one -- a second finger, a drag, or the tap
   * already counted. A ref because it is written and read inside one
   * gesture, and a re-render per touch move is the cost this whole screen
   * spent a bug avoiding.
   */
  const tap = useRef<{ x: number; y: number; at: number } | null>(null)

  const watch = (event: GestureResponderEvent) => {
    const two = event.nativeEvent.touches.length >= 2
    if (two) tap.current = null
    // Only on a change: this runs on every touch move, and a `setState` per
    // frame would re-render the whole viewer under the gesture it is trying
    // to let through.
    setTwoFingers(held => (held === two ? held : two))
    return false
  }

  /**
   * OBSERVED, NEVER CLAIMED, LIKE EVERYTHING ELSE ON THIS VIEW.
   *
   * The pager owns horizontal drags and `Pinchable` owns two fingers. A
   * `Pressable` over the photograph would have to win the gesture from one
   * of them to hear a tap, and whichever it won it would break. So the touch
   * is measured in the capture phase instead: one finger, that went down and
   * came up in the same place and quickly, is a tap and nothing else can be.
   * A swipe moves, a pinch is two, a long press takes too long -- all three
   * fall out on their own, and none of them is taken away from its owner.
   */
  const began = (event: GestureResponderEvent) => {
    const touch = event.nativeEvent
    tap.current =
      touch.touches.length > 1
        ? null
        : { x: touch.pageX, y: touch.pageY, at: Date.now() }
    return watch(event)
  }

  const ended = (event: GestureResponderEvent) => {
    const from = tap.current
    tap.current = null
    if (from === null) return
    const touch = event.nativeEvent
    const moved = Math.hypot(touch.pageX - from.x, touch.pageY - from.y)
    if (moved > TAP_SLOP || Date.now() - from.at > TAP_TIME) return
    setChrome(held => !held)
  }
  const rail = useRef<React.ComponentRef<typeof ScrollView>>(null)
  /**
   * The clock and the battery sit where this bar does.
   *
   * The bar floats over the photograph now, so nothing in the flow pushes it
   * clear of the status bar the way a header does -- on the Pixel the green
   * plate was drawn under the time. The provider is at the application's
   * root and a `Modal`'s children are its React children, so the inset
   * reaches in here even though the native window does not.
   */
  const inset = useSafeAreaInsets()

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
          onStartShouldSetResponderCapture={began}
          onMoveShouldSetResponderCapture={watch}
          onTouchEndCapture={ended}>
          <View
            style={[styles.bar, { paddingTop: inset.top + space.m }]}
            pointerEvents="box-none">
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
            {shown && (
              <>
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
                  {/* THE PRODUCT'S OWN SHAPE, IN THE PRODUCT'S OWN GREEN.
                      It was a pale disc on a dark ground, and on a
                      photograph it disappeared: reported from the device as
                      "pas visible et pas pratique". A control that has to be
                      found on top of somebody's picture cannot be a tint of
                      the ground it sits on, so it is the notched rectangle
                      every primary action in this product wears, filled with
                      the brand green -- the same thing to look for here as
                      everywhere else. */}
                  <Svg
                    width={floors.touchTargetMin}
                    height={floors.touchTargetMin}
                    style={StyleSheet.absoluteFill}>
                    <Path
                      d={notchedRectPath(
                        floors.touchTargetMin,
                        floors.touchTargetMin,
                        notchLegFor(floors.touchTargetMin),
                      )}
                      fill={color.dark.brand.green500}
                    />
                  </Svg>
                  <Text style={styles.chevron}>{'←'}</Text>
                </Pressable>
                <Text style={styles.of} testID="plate-of">
                  {t('plate_of %1$d %2$d', showing + 1, entries.length)}
                </Text>
              </>
            )}
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

/** How far a finger may travel and still have meant a tap, in points. */
const TAP_SLOP = 12

/** How long it may stay down. Past this it is a press, which means a menu. */
const TAP_TIME = 300

const styles = StyleSheet.create({
  ground: {
    flex: 1,
    backgroundColor: color.brand.ink900,
  },
  bar: {
    // OVER THE PHOTOGRAPH, NOT ABOVE IT. In the flow, taking the controls
    // away gave the pager a taller viewport and the picture jumped -- a
    // photograph that resizes when you tap it is a photograph you cannot
    // read. Floating, the space it leaves is the picture's either way.
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: layout.screenGutter,
    // `paddingTop` is set on the element: it is the status bar's height plus
    // a gap, and only the device knows the first half.
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
    // The fill is the notched path drawn inside, not a background: a
    // background is a rectangle, and the shape is the point.
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Pressing says so. On a screen with no other chrome, a control that does
  // not answer the finger reads as a control that did not receive it -- which
  // is what "not responsive enough" meant.
  pressed: { opacity: 0.7 },
  chevron: {
    ...type.titleLg,
    // On the brand green, the dark ink rather than paper: the same pairing
    // the primary action uses everywhere else in the product.
    color: color.brand.ink900,
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
