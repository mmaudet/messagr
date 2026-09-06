/**
 * The arithmetic of a pinch, away from the component that feels it.
 *
 * React Native reports raw touches and nothing else: no pinch, no scale, no
 * focal point. Those are computed, and computing them inside a
 * `PanResponder` callback would put the one part of this that can be wrong
 * in the one place nothing can test. So the callbacks read touches and call
 * these; the sums are here with their own spec.
 *
 * # Why not a gesture library
 *
 * `react-native-gesture-handler` (with `react-native-reanimated` behind it,
 * which is what makes it smooth) would do this on the UI thread and do it
 * better. It is two native modules, a Babel plugin, a version matched to
 * React Native's, a root wrapper, and a regenerated CocoaPods graph -- and
 * the iOS job has already fallen over pod churn twice. That is a real cost
 * for one screen's gesture.
 *
 * This runs on the JavaScript thread and will not be as smooth as the UI
 * thread would be. If a device says that is not good enough, *that* is the
 * argument for the dependency, and it is a much better one than "a library
 * exists".
 */

/** Fit. A photograph is never smaller than the screen it is shown on. */
export const LEAST = 1

/**
 * Four times.
 *
 * Beyond this a photograph off a phone camera is showing its own pixels,
 * which is not zooming in on anything -- and a bound is what stops a pinch
 * from ending somewhere a person cannot get back from.
 */
export const MOST = 4

/** A touch, as much of one as any of this needs. */
export interface Touch {
  readonly pageX: number
  readonly pageY: number
}

/**
 * The distance between two fingers.
 *
 * Zero when there are not two, which the caller reads as "not a pinch" --
 * and never as a divisor, because a ratio against zero is where a scale
 * becomes `Infinity` and a photograph disappears.
 */
export function spanOf(touches: readonly Touch[]): number {
  if (touches.length < 2) return 0
  const [first, second] = touches
  if (first === undefined || second === undefined) return 0
  return Math.hypot(second.pageX - first.pageX, second.pageY - first.pageY)
}

/** The point between two fingers: what a pinch zooms towards. */
export function middleOf(touches: readonly Touch[]): { x: number; y: number } {
  const [first, second] = touches
  if (first === undefined) return { x: 0, y: 0 }
  if (second === undefined) return { x: first.pageX, y: first.pageY }
  return {
    x: (first.pageX + second.pageX) / 2,
    y: (first.pageY + second.pageY) / 2,
  }
}

/**
 * Where the pinch has got to, bounded.
 *
 * `began` is the span the fingers started at and `now` is where they are, so
 * the ratio is how much further apart they have moved -- multiplied by
 * whatever the scale already was, because a second pinch continues the first
 * rather than starting over.
 */
export function scaleFor(began: number, now: number, from: number): number {
  if (began <= 0) return from
  return within(from * (now / began), LEAST, MOST)
}

/**
 * How far a photograph may be dragged before its edge comes inside the frame.
 *
 * At fit there is nothing to drag: a scale of 1 gives a bound of 0, which is
 * why panning is dead until somebody zooms in. Above it, the overflow is
 * shared between the two sides.
 */
export function panBound(size: number, scale: number): number {
  return Math.max(0, (size * scale - size) / 2)
}

/** Keep a value inside a range. */
export function within(value: number, least: number, most: number): number {
  return Math.min(Math.max(value, least), most)
}

/**
 * Whether this scale counts as zoomed in.
 *
 * Asked so the pager knows to stop paging: a drag on a photograph that fills
 * more than the screen is a drag on the photograph, and a swipe to the next
 * one is what it must not be. The comparison is loose because a scale
 * arrives from a division and lands on 1.0000000000000002 often enough.
 */
export function isZoomed(scale: number): boolean {
  return scale > LEAST + 0.01
}
