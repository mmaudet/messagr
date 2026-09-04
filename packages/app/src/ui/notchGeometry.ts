import { notch } from '../design/tokens'

/**
 * The brand's geometry: a 45-degree cut at the top-right corner.
 *
 * The prototype states it as a CSS clip path, which React Native does not
 * have:
 *
 *     polygon(0 0, calc(100% - 11px) 0, 100% 11px, 100% 100%, 0 100%)
 *
 * So the shape is drawn rather than clipped. Drawn rather than faked, too:
 * the alternative was to paint a triangle in the background colour over the
 * corner, which is indistinguishable on a flat surface and wrong on every
 * other one -- and it would make the component demand a background from its
 * callers. This module is the translation, kept apart from the component so
 * that the geometry can be checked by reading a test against the original
 * polygon instead of by looking at a screen.
 */

/**
 * The height at which `notch.button.size` is the leg of the cut.
 *
 * Measured rather than chosen. Across the prototype's buttons the leg holds
 * at about a third of the height -- 11 on 33, 14 on 43, 16 on 45, 12 on 35 --
 * and 48 is the height at which the token's 16 is that third. It also sits
 * above the 44pt touch-target floor, so a primary action at its natural size
 * gets the cut the design drew.
 */
const REFERENCE_HEIGHT = 48

/**
 * The cut scales with the component rather than being fixed, so a button at
 * any size carries the same proportion. A fixed leg looks deliberate at one
 * height and like a mistake at every other.
 */
export function notchLegFor(height: number): number {
  return Math.max(0, (height * notch.button.size) / REFERENCE_HEIGHT)
}

/**
 * `width` and `height` in points, `leg` the length of each equal side of the
 * cut. Equal, because a cut whose sides differ is not at 45 degrees and is
 * not this shape.
 */
export function notchedRectPath(
  width: number,
  height: number,
  leg: number,
): string {
  // A notch deeper than the box is a different shape, not a deeper notch.
  const cut = Math.max(0, Math.min(leg, width, height))
  const round = (value: number) => Number.parseFloat(value.toFixed(2))

  const points = [
    [0, 0],
    [round(width - cut), 0],
    [round(width), round(cut)],
    [round(width), round(height)],
    [0, round(height)],
  ]

  return `${points
    .map(
      ([x, y], index) => `${index === 0 ? 'M' : 'L'}${String(x)} ${String(y)}`,
    )
    .join(' ')} Z`
}
