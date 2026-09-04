import { describe, expect, it } from 'vitest'

import { notchLegFor, notchedRectPath } from './notchGeometry'

describe('notchedRectPath', () => {
  it('draws the prototype polygon, corner for corner', () => {
    // The prototype expresses this shape as a CSS clip path:
    //
    //   polygon(0 0, calc(100% - 11px) 0, 100% 11px, 100% 100%, 0 100%)
    //
    // React Native has no clip path, so the shape is drawn instead. Writing
    // the assertion against the original polygon is what makes the
    // translation checkable by reading rather than by eye -- and eye is the
    // one instrument not available here.
    expect(notchedRectPath(120, 33, 11)).toBe(
      'M0 0 L109 0 L120 11 L120 33 L0 33 Z',
    )
  })

  it('cuts at 45 degrees, which is the whole point of the shape', () => {
    // Equal legs or it is not a 45-degree cut. Asserted as a property rather
    // than on one example, because a path that drifted off 45 would still
    // look like a notch in a screenshot.
    for (const [width, height, leg] of [
      [200, 48, 16],
      [90, 44, 14],
      [320, 60, 20],
    ]) {
      const points = notchedRectPath(width, height, leg)
        .replace(/[MLZ]/g, '')
        .trim()
        .split(/\s+/)
        .map(Number)
      const [, , cutStartX, cutStartY, cutEndX, cutEndY] = points
      expect(width - (cutStartX ?? 0)).toBe(leg)
      expect(cutStartY).toBe(0)
      expect(cutEndX).toBe(width)
      expect(cutEndY).toBe(leg)
    }
  })

  it('refuses to cut more than there is to cut', () => {
    // A notch as deep as the button is not a notch, it is a different shape.
    // Clamping keeps a small button a button rather than a triangle.
    expect(notchedRectPath(20, 20, 40)).toBe('M0 0 L0 0 L20 20 L20 20 L0 20 Z')
  })

  it('draws a plain rectangle when there is no notch', () => {
    expect(notchedRectPath(100, 40, 0)).toBe(
      'M0 0 L100 0 L100 0 L100 40 L0 40 Z',
    )
  })
})

describe('notchLegFor', () => {
  it('gives the token leg at the reference height', () => {
    // notch.button.size is 16, and the reference height is 48: measured
    // across the prototype's buttons, the leg holds at about a third of the
    // height (11/33, 14/43, 16/45, 12/35). 48 is where 16 is that third, and
    // it sits above the 44pt touch-target floor.
    expect(notchLegFor(48)).toBe(16)
  })

  it('scales with the height, so the cut holds at every size', () => {
    expect(notchLegFor(24)).toBe(8)
    expect(notchLegFor(96)).toBe(32)
  })

  it('never returns a leg deeper than the height', () => {
    expect(notchLegFor(0)).toBe(0)
  })
})
