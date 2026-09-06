import { describe, expect, it } from 'vitest'

import {
  isZoomed,
  LEAST,
  middleOf,
  MOST,
  panBound,
  scaleFor,
  spanOf,
  within,
} from './pinch'

describe('spanOf', () => {
  it('measures the distance between two fingers', () => {
    expect(
      spanOf([
        { pageX: 0, pageY: 0 },
        { pageX: 3, pageY: 4 },
      ]),
    ).toBe(5)
  })

  it('is zero for one finger, which is not a pinch', () => {
    expect(spanOf([{ pageX: 10, pageY: 10 }])).toBe(0)
  })

  it('is zero for no fingers, so nothing divides by it', () => {
    expect(spanOf([])).toBe(0)
  })

  it('ignores a third finger rather than refusing the gesture', () => {
    const three = [
      { pageX: 0, pageY: 0 },
      { pageX: 0, pageY: 10 },
      { pageX: 500, pageY: 500 },
    ]
    expect(spanOf(three)).toBe(10)
  })
})

describe('middleOf', () => {
  it('is the point between two fingers', () => {
    expect(
      middleOf([
        { pageX: 0, pageY: 0 },
        { pageX: 10, pageY: 20 },
      ]),
    ).toEqual({ x: 5, y: 10 })
  })

  it('is the finger itself when there is only one', () => {
    expect(middleOf([{ pageX: 7, pageY: 9 }])).toEqual({ x: 7, y: 9 })
  })
})

describe('scaleFor', () => {
  it('grows with the fingers', () => {
    expect(scaleFor(100, 200, 1)).toBe(2)
  })

  it('shrinks with them', () => {
    expect(scaleFor(200, 100, 2)).toBe(1)
  })

  it('continues from where the last pinch left off', () => {
    // A second pinch is not a fresh one: doubling from 2 reaches 4.
    expect(scaleFor(100, 200, 2)).toBe(4)
  })

  it('never goes below fit', () => {
    expect(scaleFor(200, 10, 1)).toBe(LEAST)
  })

  it('stops at the ceiling', () => {
    expect(scaleFor(10, 2000, 1)).toBe(MOST)
  })

  it('keeps the scale it had when the pinch began from nothing', () => {
    // `began` of zero is one finger. Dividing by it would be Infinity, and
    // the photograph would vanish rather than stay put.
    expect(scaleFor(0, 300, 1.5)).toBe(1.5)
  })
})

describe('panBound', () => {
  it('is nothing at fit, so a photograph that fills the frame cannot be dragged', () => {
    expect(panBound(400, 1)).toBe(0)
  })

  it('shares the overflow between the two sides', () => {
    // Twice the size is 400 over; 200 each way.
    expect(panBound(400, 2)).toBe(200)
  })

  it('never goes negative, whatever a scale below fit would give', () => {
    expect(panBound(400, 0.5)).toBe(0)
  })
})

describe('within', () => {
  it('passes a value inside the range through', () => {
    expect(within(5, 0, 10)).toBe(5)
  })

  it('clamps both ends', () => {
    expect(within(-3, 0, 10)).toBe(0)
    expect(within(30, 0, 10)).toBe(10)
  })
})

describe('isZoomed', () => {
  it('is false at fit', () => {
    expect(isZoomed(1)).toBe(false)
  })

  it('tolerates the float a division leaves behind', () => {
    // 1.0000000000000002 is what `from * (now / began)` returns often
    // enough, and treating it as zoomed would kill paging on a plate
    // nobody zoomed.
    expect(isZoomed(1.0000000000000002)).toBe(false)
  })

  it('is true once there is something to pan', () => {
    expect(isZoomed(1.5)).toBe(true)
  })
})
