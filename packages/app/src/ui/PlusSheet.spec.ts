import { createElement, Fragment, isValidElement, type ReactNode } from 'react'
import * as ReactNamespace from 'react'
import { describe, expect, it, vi } from 'vitest'

import { t } from '../copy'
import { PlusSheet } from './PlusSheet'

/**
 * The sheet the green "+" opens (#394).
 *
 * Walked rather than rendered, for the reason `BackupOffer.spec.ts` gives:
 * nothing in this workspace renders React Native off a device, and what a
 * screen hands the platform is observable without one.
 */

vi.mock('react-native', () => ({
  Modal: 'Modal',
  Pressable: 'Pressable',
  StyleSheet: { absoluteFill: {}, create: (styles: object) => styles },
  Text: 'Text',
  View: 'View',
}))

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

function find(within: readonly Drawn[], testID: string): Drawn | undefined {
  for (const node of everything(within)) {
    if (node.props.testID === testID) return node
  }
  return undefined
}

/** Every string this sheet hands the platform, in the order it hands it. */
function said(drawn: readonly Drawn[]): string[] {
  const lines: string[] = []
  for (const node of everything(drawn)) {
    if (node.type !== 'Text') continue
    const child = node.props.children
    if (typeof child === 'string') lines.push(child)
  }
  return lines
}

function sheet(onInvite = vi.fn(), onClose = vi.fn()) {
  return {
    drawn: draw(createElement(PlusSheet, { onInvite, onClose })),
    onInvite,
    onClose,
  }
}

function press(drawn: readonly Drawn[], testID: string) {
  const node = find(drawn, testID)
  expect(node, `${testID} is on the sheet`).toBeDefined()
  ;(node?.props.onPress as () => void)()
}

describe('the sheet the "+" opens', () => {
  it('offers to invite somebody, and nothing else yet', () => {
    const { drawn } = sheet()

    expect(said(drawn)).toContain(t('invite_action'))
    expect(find(drawn, 'plus-invite')).toBeDefined()
  })

  it('leads to the invitation form when "Inviter quelqu’un" is pressed', () => {
    const { drawn, onInvite, onClose } = sheet()

    press(drawn, 'plus-invite')

    expect(onInvite).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes without inviting from the scrim, the close row, or the back gesture', () => {
    for (const way of ['plus-scrim', 'plus-close', 'back'] as const) {
      const { drawn, onInvite, onClose } = sheet()

      if (way === 'back') {
        const modal = find(drawn, 'plus-sheet')
        ;(modal?.props.onRequestClose as () => void)()
      } else {
        press(drawn, way)
      }

      expect(onClose, way).toHaveBeenCalledTimes(1)
      expect(onInvite, way).not.toHaveBeenCalled()
    }
  })
})
