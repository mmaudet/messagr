import { floors, space } from '../design/tokens'

/**
 * What the selection bar can offer (#192, #468, #472), in the order it draws
 * them: the bin last, where every system dialogue puts the destructive one.
 */
export type BarAction =
  'copy' | 'forward' | 'favourite' | 'keep' | 'report' | 'block' | 'remove'

/** That order, for whoever lists them. */
export const BAR_ORDER: readonly BarAction[] = [
  'copy',
  'forward',
  'favourite',
  'keep',
  'report',
  'block',
  'remove',
]

/**
 * Which go into « Plus » first when the bar is short (#472, #498): « Bloquer
 * l'expéditeur », which the panel of the person offers too; then the least
 * central to a selection, « Garder » and « Favori »; then « Transférer » and
 * « Copier »; « Signaler » last of all.
 *
 * « SIGNALER » STAYS ON THE BAR, on somebody else's message, where it is
 * found without being looked for (decided on 30 September 2026): on a
 * telephone of 393 points, as on one of 360, the bar holds it beside
 * « Plus » and the bin, whatever the count shows.
 *
 * Never the bin: removing applies to anything selected, so it is always on
 * the bar.
 */
const INTO_MORE_FIRST: readonly BarAction[] = [
  'block',
  'keep',
  'favourite',
  'forward',
  'copy',
  'report',
]

/**
 * The actions `offered`, in the bar's order, split between the bar and
 * « Plus » for actions that have `room` points to stand in.
 *
 * EVERY ONE AT THE TOUCH-TARGET FLOOR, `space.s` apart: a glyph of 20 in a
 * target of 44 (`icon.$rule`, `floors.touchTargetMin`), and never less to
 * make them fit. All on the bar when they fit. Otherwise « Plus » takes a
 * place of its own and holds them in the order `INTO_MORE_FIRST` says, until
 * the rest fit beside it; what it holds, it lists in the bar's order. It
 * holds only what the selection offers: absent, never greyed, there as on
 * the bar.
 */
export function placeActions(
  offered: readonly BarAction[],
  room: number,
): {
  readonly onBar: readonly BarAction[]
  readonly inMore: readonly BarAction[]
} {
  const places = Math.floor(
    (room + space.s) / (floors.touchTargetMin + space.s),
  )
  if (offered.length <= places) return { onBar: offered, inMore: [] }
  const moving = new Set<BarAction>()
  for (const action of INTO_MORE_FIRST) {
    if (offered.length - moving.size + 1 <= places) break
    if (offered.includes(action)) moving.add(action)
  }
  return {
    onBar: offered.filter(action => !moving.has(action)),
    inMore: offered.filter(action => moving.has(action)),
  }
}

/**
 * What the bar draws, from what the selection `offers` and the `room` it
 * measured for its actions (#472, #498): NOTHING UNTIL IT HAS MEASURED,
 * since what fits is decided from the room and never guessed; then the
 * actions offered, in the bar's order, « Plus » (`'more'`) after them when
 * some went into it, and the bin last when it is offered; and what « Plus »
 * lists. Measured again, it is drawn again: a telephone turned has another
 * room.
 *
 * It was written inline in `SelectionBar.tsx`, where nothing could test it.
 */
export function barOf(
  offers: Readonly<Record<BarAction, boolean>>,
  room: number | null,
): {
  readonly drawn: readonly (BarAction | 'more')[]
  readonly inMore: readonly BarAction[]
} | null {
  if (room === null) return null
  const { onBar, inMore } = placeActions(
    BAR_ORDER.filter(action => offers[action]),
    room,
  )
  return {
    drawn: [
      ...onBar.filter(action => action !== 'remove'),
      ...(inMore.length > 0 ? ['more' as const] : []),
      ...onBar.filter(action => action === 'remove'),
    ],
    inMore,
  }
}
