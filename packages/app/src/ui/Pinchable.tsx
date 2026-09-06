import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Animated, PanResponder, StyleSheet, View } from 'react-native'

import {
  isZoomed,
  LEAST,
  middleOf,
  panBound,
  scaleFor,
  spanOf,
  within,
} from './pinch'

/**
 * Two fingers, on whatever is inside it.
 *
 * Built for the full-screen photograph, which is the one place in this
 * product where a person needs to see more than the screen shows. The
 * arithmetic is in `pinch.ts` with its own spec; what is left here is the
 * part only a device can judge.
 *
 * # It tells the pager to stop
 *
 * A zoomed photograph and a pager want the same drag. `onZoomed` is how the
 * viewer above knows to stop paging: while somebody is inside a photograph,
 * a drag moves the photograph. Letting both have it would mean a swipe
 * sometimes moved the picture and sometimes changed it, which is the kind of
 * control a person stops trusting.
 *
 * # It springs back rather than staying wrong
 *
 * Let go while pinched below fit and it returns to fit; drag past an edge
 * and it comes back to the edge. Nothing here can be left in a state a
 * person cannot get out of, which is the same reason `MOST` exists.
 *
 * # The zoom is centred, not focal
 *
 * A pinch here grows the photograph about its middle; it does not keep the
 * point between the fingers still. Focal-point zoom is nicer and is a matrix
 * this does not carry -- reaching a corner is a pinch and then a drag rather
 * than one gesture. Written down as a known limit rather than left for
 * somebody to discover.
 *
 * # `useNativeDriver` is false, and it has to be
 *
 * The transform is driven from touch events, so the values are set from
 * JavaScript on every move -- a native-driven `Animated.Value` cannot be
 * `setValue`d from there. It is the honest cost of not taking the
 * gesture-handler dependency, written down where somebody measuring a
 * dropped frame will find it.
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
  const began = useRef({ span: 0, scale: 1, x: 0, y: 0, dx: 0, dy: 0 })
  const [zoomed, setZoomed] = useState(false)

  function settle(next: { scale: number; x: number; y: number }) {
    const bound = {
      x: panBound(width, next.scale),
      y: panBound(height, next.scale),
    }
    const put = {
      scale: next.scale,
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

  // IN AN EFFECT, NOT IN THE RENDER.
  //
  // This was `if (!active && ...) toFit()` in the component body, which calls
  // `setZoomed` here and `onZoomed` on the pager above -- a state update on
  // another component during this one's render, which React refuses outright.
  // It would have thrown the first time somebody paged away from a photograph
  // they had zoomed into, which is the one gesture this prop exists for.
  useEffect(() => {
    if (!active && held.current.scale !== LEAST) toFit()
    // `toFit` is rebuilt every render and depends on nothing that changes
    // what it does; listing it would run this on every render instead of on
    // the one thing it is about.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  const responder = useMemo(
    () =>
      PanResponder.create({
        // CAPTURE, NOT BUBBLE. The pager above is a ScrollView, and it takes
        // a drag before a child ever sees one. Claiming a second finger on
        // the way down is what lets a pinch begin at all; a single finger is
        // left alone unless there is a zoom to drag, so an unzoomed
        // photograph still swipes to the next.
        onStartShouldSetPanResponderCapture: event =>
          event.nativeEvent.touches.length === 2,
        onMoveShouldSetPanResponderCapture: event =>
          event.nativeEvent.touches.length === 2 ||
          isZoomed(held.current.scale),

        onPanResponderGrant: event => {
          const touches = event.nativeEvent.touches
          began.current = {
            span: spanOf(touches),
            scale: held.current.scale,
            ...middleOf(touches),
            dx: 0,
            dy: 0,
          }
        },

        onPanResponderMove: (event, gesture) => {
          const touches = event.nativeEvent.touches
          if (touches.length >= 2) {
            const span = spanOf(touches)
            const middle = middleOf(touches)
            // The fingers may also travel while they spread, and a pinch
            // that ignored that would slide out from under them.
            settle({
              scale: scaleFor(began.current.span, span, began.current.scale),
              x: held.current.x + (middle.x - began.current.x),
              y: held.current.y + (middle.y - began.current.y),
            })
            began.current = { ...began.current, span, ...middle }
            return
          }
          if (isZoomed(held.current.scale)) {
            // THE INCREMENT, NOT THE TOTAL. `dx` is the whole distance
            // travelled since the gesture began, so adding it to a position
            // that already contains it accelerates away on every frame --
            // the photograph shoots off the screen. What moves it is the
            // difference since the last report.
            settle({
              scale: held.current.scale,
              x: held.current.x + (gesture.dx - began.current.dx),
              y: held.current.y + (gesture.dy - began.current.dy),
            })
            began.current = { ...began.current, dx: gesture.dx, dy: gesture.dy }
          }
        },

        onPanResponderRelease: () => {
          if (held.current.scale <= LEAST) toFit()
          else settle(held.current)
        },
        onPanResponderTerminationRequest: () => false,
      }),
    // Built once. It reads everything changeable through refs on purpose:
    // rebuilding a responder mid-gesture is how a pinch loses its fingers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [width, height],
  )

  return (
    <View
      testID={testID}
      style={[styles.frame, { width, height }]}
      {...responder.panHandlers}>
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
  )
}

const styles = StyleSheet.create({
  frame: { overflow: 'hidden', justifyContent: 'center' },
  content: { width: '100%' },
})
