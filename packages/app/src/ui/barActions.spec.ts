import { describe, expect, it } from 'vitest'

import { floors, layout, space, type } from '../design/tokens'
import { barOf, placeActions, type BarAction } from './barActions'

/** The room `places` actions take, each at the touch-target floor. */
function roomFor(places: number): number {
  return places * floors.touchTargetMin + (places - 1) * space.s
}

/**
 * The room the actions have on a screen `width` points wide, as
 * `SelectionBar.tsx` lays the bar out: the screen, less a gutter on each
 * side, the ✕ at the touch-target floor, the count, and a gap after each of
 * the two. The count shows `digits` digits of `type.titleMd`, each taken
 * three fifths of its size wide, as the digits of both platforms' system
 * fonts are, to a point or so.
 */
function roomOnAScreen(width: number, digits = 1): number {
  return (
    width -
    2 * layout.screenGutter -
    floors.touchTargetMin -
    2 * space.s -
    digits * type.titleMd.fontSize * 0.6
  )
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

/** A photograph of somebody else, once it can be reported (#471). */
const THEIR_PHOTOGRAPH: readonly BarAction[] = [
  'copy',
  'forward',
  'favourite',
  'keep',
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

  it('moves « Bloquer l’expéditeur » into « Plus » first, then the least central, and keeps « Signaler » on the bar (#498)', () => {
    // One place short: « Plus » takes a place of its own, so two go in.
    // Blocking is also on the panel of the person; « Signaler » is found
    // without being looked for (decided on 30 September 2026).
    expect(placeActions(THEIR_WORDS, roomFor(5))).toEqual({
      onBar: ['copy', 'forward', 'report', 'remove'],
      inMore: ['favourite', 'block'],
    })
  })

  it('then « Garder » and « Favori », then « Transférer » and « Copier », until the rest fit beside « Plus »', () => {
    expect(placeActions(THEIR_PHOTOGRAPH, roomFor(5))).toEqual({
      onBar: ['copy', 'forward', 'report', 'remove'],
      inMore: ['favourite', 'keep', 'block'],
    })
    expect(placeActions(THEIR_WORDS, roomFor(4))).toEqual({
      onBar: ['copy', 'report', 'remove'],
      inMore: ['forward', 'favourite', 'block'],
    })
  })

  it('lets « Signaler » go last of all, once nothing else is left to move', () => {
    expect(placeActions(THEIR_WORDS, roomFor(3))).toEqual({
      onBar: ['report', 'remove'],
      inMore: ['copy', 'forward', 'favourite', 'block'],
    })
    expect(placeActions(THEIR_WORDS, roomFor(2))).toEqual({
      onBar: ['remove'],
      inMore: ['copy', 'forward', 'favourite', 'report', 'block'],
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

describe('on the telephones it is drawn on (#498)', () => {
  it('has five places at 393 points, whatever the count shows, and four at 360 once it shows two digits', () => {
    const places = (room: number) =>
      Math.floor((room + space.s) / (floors.touchTargetMin + space.s))

    expect([1, 2, 3].map(digits => places(roomOnAScreen(393, digits)))).toEqual(
      [5, 5, 5],
    )
    expect([1, 2, 3].map(digits => places(roomOnAScreen(360, digits)))).toEqual(
      [5, 4, 4],
    )
  })

  it('keeps « Signaler » on the bar at 393 points, beside « Plus », which holds « Bloquer l’expéditeur »', () => {
    // An iPhone of 393 points, somebody else's message selected.
    expect(placeActions(THEIR_WORDS, roomOnAScreen(393))).toEqual({
      onBar: ['copy', 'forward', 'report', 'remove'],
      inMore: ['favourite', 'block'],
    })
    expect(placeActions(THEIR_PHOTOGRAPH, roomOnAScreen(393))).toEqual({
      onBar: ['copy', 'forward', 'report', 'remove'],
      inMore: ['favourite', 'keep', 'block'],
    })
  })

  it('keeps it at 360 points too, where « Transférer » goes into « Plus » once ten messages are selected', () => {
    expect(placeActions(THEIR_WORDS, roomOnAScreen(360))).toEqual({
      onBar: ['copy', 'forward', 'report', 'remove'],
      inMore: ['favourite', 'block'],
    })
    expect(placeActions(THEIR_WORDS, roomOnAScreen(360, 2))).toEqual({
      onBar: ['copy', 'report', 'remove'],
      inMore: ['forward', 'favourite', 'block'],
    })
    expect(placeActions(THEIR_PHOTOGRAPH, roomOnAScreen(360, 2))).toEqual({
      onBar: ['copy', 'report', 'remove'],
      inMore: ['forward', 'favourite', 'keep', 'block'],
    })
  })

  it('draws, at either width and whatever the count, « Signaler » and the bin on the bar, each action at 44 points', () => {
    const offers = (offered: readonly BarAction[]) =>
      Object.fromEntries(
        (
          [
            'copy',
            'forward',
            'favourite',
            'keep',
            'report',
            'block',
            'remove',
          ] as const
        ).map(action => [action, offered.includes(action)]),
      ) as Record<BarAction, boolean>

    for (const width of [360, 393]) {
      for (const digits of [1, 2, 3]) {
        const room = roomOnAScreen(width, digits)
        for (const offered of [THEIR_WORDS, THEIR_PHOTOGRAPH]) {
          const drawn = barOf(offers(offered), room)?.drawn ?? []
          expect(drawn).toContain('report')
          expect(drawn).not.toContain('block')
          expect(drawn[drawn.length - 1]).toBe('remove')
          expect(
            drawn.length * floors.touchTargetMin + (drawn.length - 1) * space.s,
          ).toBeLessThanOrEqual(room)
        }
      }
    }
  })

  it('leaves this account’s own words and photograph all on the bar at 393 points', () => {
    const mine: readonly BarAction[] = [
      'copy',
      'forward',
      'favourite',
      'keep',
      'remove',
    ]

    expect(placeActions(mine, roomOnAScreen(393))).toEqual({
      onBar: mine,
      inMore: [],
    })
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
      drawn: ['copy', 'forward', 'report', 'more', 'remove'],
      inMore: ['favourite', 'block'],
    })
  })

  it('draws the bin only when the selection offers it', () => {
    expect(barOf({ ...offers, remove: false }, roomFor(6))).toEqual({
      drawn: ['copy', 'forward', 'favourite', 'report', 'block'],
      inMore: [],
    })
    expect(barOf({ ...offers, remove: false }, roomFor(4))).toEqual({
      drawn: ['copy', 'forward', 'report', 'more'],
      inMore: ['favourite', 'block'],
    })
  })

  it('measures again: a room grown or shrunk draws again', () => {
    // A telephone turned, or a window resized: the bar is laid out again.
    expect(barOf(offers, roomFor(4))?.drawn).toEqual([
      'copy',
      'report',
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
