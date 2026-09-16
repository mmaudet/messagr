import { createElement, Fragment, isValidElement, type ReactNode } from 'react'
import * as ReactNamespace from 'react'
import { describe, expect, it, vi } from 'vitest'

import { t } from '../copy'
import { BackupOffer } from './BackupOffer'

/**
 * The offer to back the keys up, drawn without a device.
 *
 * Walked rather than rendered, for the reason `CallScreen.spec.ts` gives:
 * nothing in this workspace renders React Native off a device, and what a
 * screen hands the platform is observable without one.
 */

vi.mock('react', async importOriginal => ({
  ...(await importOriginal<typeof import('react')>()),
  useEffect: () => undefined,
  useRef: (current: unknown) => ({ current }),
  useState: (initial: unknown) => [initial, () => undefined],
}))

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { absoluteFill: {}, create: (styles: object) => styles },
  Text: 'Text',
  View: 'View',
}))

vi.mock('react-native-svg', () => ({
  default: 'Svg',
  Circle: 'Circle',
  Path: 'Path',
  Rect: 'Rect',
}))

// As `BackupSettings.spec.ts`: the workspace compiles JSX to
// `React.createElement`, and `NotchedButton` does not import React itself.
vi.stubGlobal('React', ReactNamespace)

interface Drawn {
  readonly type: unknown
  readonly props: Readonly<Record<string, unknown>>
  readonly children: readonly Drawn[]
}

function draw(node: ReactNode): Drawn[] {
  if (Array.isArray(node)) return node.flatMap(draw)
  if (!isValidElement<Record<string, unknown>>(node)) return []
  const { type, props } = node
  if (type === Fragment) return draw(props.children as ReactNode)
  const under =
    typeof type === 'function'
      ? (type as (given: typeof props) => ReactNode)(props)
      : (props.children as ReactNode)
  return [{ type, props, children: draw(under) }]
}

function* everything(drawn: readonly Drawn[]): Generator<Drawn> {
  for (const node of drawn) {
    yield node
    yield* everything(node.children)
  }
}

/**
 * The outermost element the platform itself receives: what this screen IS,
 * rather than the component on the way to it.
 */
function rootHost(drawn: readonly Drawn[]): Drawn | undefined {
  for (const node of everything(drawn)) {
    if (typeof node.type === 'string') return node
  }
  return undefined
}

/** Whether `testID` is anywhere under `within`. */
function has(within: readonly Drawn[], testID: string): boolean {
  for (const node of everything(within)) {
    if (node.props.testID === testID) return true
  }
  return false
}

const nothing = () => undefined

function screen(
  over: Partial<Parameters<typeof BackupOffer>[0]> = {},
): Drawn[] {
  return draw(
    createElement(BackupOffer, {
      onAccept: nothing,
      onRefuse: nothing,
      failed: false,
      working: false,
      ...over,
    }),
  )
}

describe('the offer on the shortest telephone this product supports (#324)', () => {
  it('scrolls, because its content is taller than an iPhone SE', () => {
    // MEASURED FROM THE TOKENS AND THE FRENCH TEXT, NOT ON A DEVICE. On 375
    // by 667 points, inside the overlay's safe area, about 647 remain. The
    // title wraps to two lines, the lead to four, and the three cards take
    // roughly 81, 81 and 119 with their padding; the actions take 137 with
    // their two 46-point buttons and the « plus tard » line. That is a little
    // over 640 before anything goes wrong, and #284 added a failure card of
    // 50 to 70 under the buttons.
    //
    // The old root was a `View` at `flex: 1` outside the application's own
    // ScrollView, so what did not fit was simply not reachable: the refusal
    // and the sentence under it left the screen. German and Dutch are longer
    // again, and a system text size can be doubled.
    const root = rootHost(screen())

    expect(root?.type).toBe('ScrollView')
    expect(root?.props.testID).toBe('backup-offer')
  })

  it('keeps both buttons and the failure card inside what scrolls', () => {
    // The whole screen scrolls rather than its middle: an action pinned
    // outside the scrolling area is an action that can still be pushed off a
    // short screen by a taller label, which is the defect in the first place.
    const root = rootHost(screen({ failed: true }))

    expect(root?.type).toBe('ScrollView')
    expect(has([root as Drawn], 'backup-offer-accept')).toBe(true)
    expect(has([root as Drawn], 'backup-offer-refuse')).toBe(true)
    expect(has([root as Drawn], 'backup-offer-failed')).toBe(true)
  })

  it('still grows to fill a screen taller than its content', () => {
    // A ScrollView lays its content out at its natural height, so a short
    // offer on a tall telephone would sit against the top with the ground
    // ending under it. `flexGrow` is what keeps the page full.
    const root = rootHost(screen())
    const content = root?.props.contentContainerStyle

    expect(content).toMatchObject({ flexGrow: 1 })
  })

  it('says what it has always said, in the order it said it', () => {
    // The control on the change: scrolling must not have moved or dropped a
    // sentence. The three facts are ordered by `BackupOffer`'s own argument
    // -- what it costs to do nothing first, the weakness last.
    const said: string[] = []
    for (const node of everything(screen())) {
      if (node.type !== 'Text') continue
      const child = node.props.children
      if (typeof child === 'string') said.push(child)
    }

    expect(said).toEqual([
      t('backup_offer_title'),
      t('backup_offer_lead'),
      t('backup_offer_loss'),
      t('backup_offer_scope'),
      t('backup_offer_trust'),
      t('backup_offer_accept'),
      t('backup_offer_refuse'),
      t('backup_offer_later'),
    ])
  })
})
