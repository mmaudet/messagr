import React, { useEffect, useRef, useState } from 'react'
import { Animated, StyleSheet, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'

import { logEvent } from '../runtime/log'
import { isZoomed, LEAST, MOST, panBound, within } from './pinch'

/**
 * Two fingers, on whatever is inside it.
 *
 * # This took a dependency, and the device is why
 *
 * The first two versions used React Native's own `PanResponder`, on the
 * argument that a gesture library is two native modules and a regenerated
 * CocoaPods graph for one screen's gesture -- and that if a device said it
 * was not good enough, *that* would be the argument for the dependency.
 *
 * The device said so twice, and not about smoothness: the pinch did nothing
 * at all. A zoomable view nested in a paging `ScrollView` is a responder
 * negotiation the JavaScript responder system cannot win. Asking in the
 * capture phase fails because capture runs root-first and the pager is the
 * ancestor; asking in the bubble phase fails because by the time a second
 * finger lands the pager already owns the touch, and disabling it then does
 * not take the gesture back. `react-native-gesture-handler` exists for
 * exactly this: its handlers are native and negotiate with the scroll view
 * where the scroll view actually lives.
 *
 * **It cost one module, not two.** The estimate that turned it down assumed
 * `react-native-reanimated` came with it; 3.2.1 declares only `react` and
 * `react-native` as peers, and without reanimated the callbacks simply run on
 * the JavaScript thread -- which is where `PanResponder` ran them too. So the
 * price was half what the refusal was priced against, and the refusal was
 * wrong on its own terms as well as on the device's.
 *
 * # It tells the pager to stop
 *
 * A zoomed photograph and a pager want the same drag. `onZoomed` is how the
 * viewer above knows to stop paging: while somebody is inside a photograph,
 * a drag moves the photograph.
 *
 * # It springs back rather than staying wrong
 *
 * Let go while pinched below fit and it returns to fit; drag past an edge and
 * it comes back to the edge. Nothing here can be left in a state a person
 * cannot get out of, which is the same reason `MOST` exists.
 *
 * # The zoom is centred, not focal
 *
 * A pinch grows the photograph about its middle; it does not keep the point
 * between the fingers still. Written down as a known limit rather than left
 * for somebody to discover.
 */
export function Pinchable({
  children,
  /** The frame the content is shown in. Bounds the drag. */
  width,
  height,
  /** Told whenever this goes in or out of zoom. */
  onZoomed,
  /**
   * Whether this is the page being looked at. A page that scrolls away
   * returns to fit, so coming back to it is not coming back to somebody
   * else's zoom.
   */
  active = true,
  testID,
}: {
  readonly children: React.ReactNode
  readonly width: number
  readonly height: number
  readonly onZoomed?: (zoomed: boolean) => void
  readonly active?: boolean
  readonly testID?: string
}) {
  const scale = useRef(new Animated.Value(1)).current
  const panX = useRef(new Animated.Value(0)).current
  const panY = useRef(new Animated.Value(0)).current

  // What the animated values currently hold. `Animated.Value` will not be
  // read synchronously, and every sum here needs the number it has now.
  const held = useRef({ scale: 1, x: 0, y: 0 })
  const began = useRef({ scale: 1, x: 0, y: 0 })
  const [zoomed, setZoomed] = useState(false)

  function settle(next: { scale: number; x: number; y: number }) {
    const bound = {
      x: panBound(width, next.scale),
      y: panBound(height, next.scale),
    }
    const put = {
      scale: within(next.scale, LEAST, MOST),
      x: within(next.x, -bound.x, bound.x),
      y: within(next.y, -bound.y, bound.y),
    }
    held.current = put
    scale.setValue(put.scale)
    panX.setValue(put.x)
    panY.setValue(put.y)

    const now = isZoomed(put.scale)
    if (now !== zoomed) {
      setZoomed(now)
      onZoomed?.(now)
    }
  }

  // Back to fit, in one place: released below fit, and scrolled away from.
  function toFit() {
    Animated.parallel([
      Animated.spring(scale, { toValue: LEAST, useNativeDriver: false }),
      Animated.spring(panX, { toValue: 0, useNativeDriver: false }),
      Animated.spring(panY, { toValue: 0, useNativeDriver: false }),
    ]).start()
    held.current = { scale: LEAST, x: 0, y: 0 }
    if (zoomed) {
      setZoomed(false)
      onZoomed?.(false)
    }
  }

  // In an effect, not in the render: `toFit` updates this component's state
  // and the pager's, and React refuses a state update on another component
  // during a render. It would have thrown the first time somebody paged away
  // from a photograph they had zoomed into.
  useEffect(() => {
    if (!active && held.current.scale !== LEAST) toFit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  // `e.scale` is the ratio since the gesture began, so it multiplies what the
  // scale was then -- a second pinch continues the first rather than starting
  // over.
  const pinch = Gesture.Pinch()
    .onStart(() => {
      // SAID OUT LOUD, BECAUSE THREE THEORIES WERE WRONG.
      //
      // The pinch did nothing on a device three times, and each diagnosis was
      // a guess about a layer. A line here answers the question that has to
      // come first -- does the handler receive the gesture at all -- and
      // separates "the fingers never arrive" from "they arrive and the
      // transform does nothing".
      logEvent('info', 'MESSAGR_PINCH', { began: true })
      began.current = { ...held.current }
    })
    .onUpdate(event => {
      settle({
        scale: began.current.scale * event.scale,
        x: held.current.x,
        y: held.current.y,
      })
    })
    .onEnd(() => {
      logEvent('info', 'MESSAGR_PINCH', { ended: held.current.scale })
      if (held.current.scale <= LEAST) toFit()
    })

  // ONE FINGER, AND ONLY ONCE THERE IS SOMETHING TO DRAG. At fit the pager
  // must keep the swipe, which is what `enabled` says -- a pan handler that
  // claimed every drag would page nowhere.
  const drag = Gesture.Pan()
    .enabled(zoomed)
    .onStart(() => {
      began.current = { ...held.current }
    })
    .onUpdate(event => {
      settle({
        scale: held.current.scale,
        x: began.current.x + event.translationX,
        y: began.current.y + event.translationY,
      })
    })

  return (
    <GestureDetector gesture={Gesture.Simultaneous(pinch, drag)}>
      <View testID={testID} style={[styles.frame, { width, height }]}>
        <Animated.View
          style={[
            styles.content,
            {
              transform: [
                { translateX: panX },
                { translateY: panY },
                { scale: scale },
              ],
            },
          ]}>
          {children}
        </Animated.View>
      </View>
    </GestureDetector>
  )
}

const styles = StyleSheet.create({
  frame: { overflow: 'hidden', justifyContent: 'center' },
  content: { width: '100%' },
})
