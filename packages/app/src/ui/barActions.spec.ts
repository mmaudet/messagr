import { describe, expect, it } from 'vitest'

import { floors, space } from '../design/tokens'
import { barOf, placeActions, type BarAction } from './barActions'

/** The room `places` actions take, each at the touch-target floor. */
function roomFor(places: number): number {
  return places * floors.touchTargetMin + (places - 1) * space.s
}

/** Somebody else's words: what the bar offers on them. */
const THEIR_WORDS: readonly BarAction[] = [
  'copy',
  'forward',
  'favourite',
  'report',
  'block',
  'remove',
]

describe('the selection bar’s actions, and « Plus » (#472)', () => {
  it('draws every action on the bar when they fit, each at the touch-target floor', () => {
    expect(placeActions(THEIR_WORDS, roomFor(6))).toEqual({
      onBar: THEIR_WORDS,
      inMore: [],
    })
  })

  it('moves « Signaler » and « Bloquer l’expéditeur » into « Plus » first', () => {
    // One place short: « Plus » takes a place of its own, so two go in.
    expect(placeActions(THEIR_WORDS, roomFor(5))).toEqual({
      onBar: ['copy', 'forward', 'favourite', 'remove'],
      inMore: ['report', 'block'],
    })
  })

  it('then the next least frequent, until the rest fit beside « Plus »', () => {
    // A photograph of somebody else, once it can be reported (#471).
    const photograph: readonly BarAction[] = [
      'copy',
      'forward',
      'favourite',
      'keep',
      'report',
      'block',
      'remove',
    ]
    expect(placeActions(photograph, roomFor(5))).toEqual({
      onBar: ['copy', 'forward', 'favourite', 'remove'],
      inMore: ['keep', 'report', 'block'],
    })
    expect(placeActions(THEIR_WORDS, roomFor(4))).toEqual({
      onBar: ['copy', 'forward', 'remove'],
      inMore: ['favourite', 'report', 'block'],
    })
  })

  it('keeps the bin on the bar, whatever the room', () => {
    // Always there: removing applies to anything selected.
    expect(placeActions(['copy', 'forward', 'remove'], roomFor(2))).toEqual({
      onBar: ['remove'],
      inMore: ['copy', 'forward'],
    })
  })

  it('offers in « Plus » only what the selection offers, absent and never greyed', () => {
    // My own words: nothing to report, nobody to block.
    const mine: readonly BarAction[] = [
      'copy',
      'forward',
      'favourite',
      'remove',
    ]
    expect(placeActions(mine, roomFor(4))).toEqual({ onBar: mine, inMore: [] })
    // In the bar's own order.
    expect(placeActions(mine, roomFor(3)).inMore).toEqual([
      'forward',
      'favourite',
    ])
  })
})

describe('what the bar draws, from the room it measured (#472, #498)', () => {
  /** What somebody else's words offer: everything but keeping. */
  const offers: Readonly<Record<BarAction, boolean>> = {
    copy: true,
    forward: true,
    favourite: true,
    keep: false,
    report: true,
    block: true,
    remove: true,
  }

  it('draws no action before it has measured its room: what fits is never guessed', () => {
    expect(barOf(offers, null)).toBeNull()
  })

  it('draws, once measured, the actions the selection offers, in the bar’s order, the bin last', () => {
    expect(barOf(offers, roomFor(6))).toEqual({
      drawn: ['copy', 'forward', 'favourite', 'report', 'block', 'remove'],
      inMore: [],
    })
  })

  it('draws « Plus » before the bin when some went into it, and lists them there', () => {
    expect(barOf(offers, roomFor(5))).toEqual({
      drawn: ['copy', 'forward', 'favourite', 'more', 'remove'],
      inMore: ['report', 'block'],
    })
  })

  it('measures again: a room grown or shrunk draws again', () => {
    // A telephone turned, or a window resized: the bar is laid out again.
    expect(barOf(offers, roomFor(4))?.drawn).toEqual([
      'copy',
      'forward',
      'more',
      'remove',
    ])
    expect(barOf(offers, roomFor(8))?.drawn).toEqual([
      'copy',
      'forward',
      'favourite',
      'report',
      'block',
      'remove',
    ])
  })

  it('draws nothing the selection does not offer, on the bar or in « Plus »', () => {
    // Absent, never greyed: my own words have nobody to report or block.
    const mine = { ...offers, report: false, block: false }

    expect(barOf(mine, roomFor(3))).toEqual({
      drawn: ['copy', 'more', 'remove'],
      inMore: ['forward', 'favourite'],
    })
  })
})
