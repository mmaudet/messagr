import { createElement, Fragment, isValidElement, type ReactNode } from 'react'
import * as ReactNamespace from 'react'
import { describe, expect, it, vi } from 'vitest'

import { t } from '../copy'
import type { TrustReading } from '../runtime/trustReading'
import { Trust } from './Trust'

/**
 * What the screen says of somebody, walked rather than rendered for the
 * reason `BackupOffer.spec.ts` gives. What #407 adds to it: an account known
 * through the address book.
 */

vi.mock('react', async importOriginal => ({
  ...(await importOriginal<typeof import('react')>()),
  useEffect: () => undefined,
  useRef: (current: unknown) => ({ current }),
  useState: (initial: unknown) => [initial, () => undefined],
}))

vi.mock('react-native', () => ({
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

function said(drawn: readonly Drawn[]): string[] {
  const lines: string[] = []
  for (const node of everything(drawn)) {
    if (node.type !== 'Text') continue
    const child = node.props.children
    if (typeof child === 'string') lines.push(child)
  }
  return lines
}

function has(within: readonly Drawn[], testID: string): boolean {
  for (const node of everything(within)) {
    if (node.props.testID === testID) return true
  }
  return false
}

const NOTHING_YET: TrustReading = {
  devices: 1,
  confirmedHere: 0,
  claimedByThem: 0,
  vouchedFor: false,
}

function screen(reading: TrustReading, cardName?: string) {
  return draw(
    createElement(Trust, {
      participant: '@paul:messagr.eu',
      given: 'Paul',
      reading,
      ...(cardName === undefined ? {} : { cardName }),
      onBack: () => undefined,
    }),
  )
}

describe('an account known through the address book (#407)', () => {
  it('says so first when nothing else is known, and what it does not establish', () => {
    const drawn = screen(NOTHING_YET, 'Paul Martin')

    const lines = said(drawn)
    expect(lines).toContain(t('trust_state_book %@', 'Paul Martin'))
    expect(lines).not.toContain(t('trust_state_nothing'))
    expect(lines).toContain(t('trust_book_means'))
    // Said once: the headline says it, so the section does not repeat it.
    expect(
      lines.filter(line => line === t('trust_state_book %@', 'Paul Martin')),
    ).toHaveLength(1)
  })

  it('keeps what a person judged as the headline, and says the address book under it', () => {
    const drawn = screen({ ...NOTHING_YET, vouchedFor: true }, 'Paul Martin')

    const lines = said(drawn)
    const vouched = lines.indexOf(t('trust_state_vouched'))
    const book = lines.indexOf(t('trust_state_book %@', 'Paul Martin'))
    expect(vouched).toBeGreaterThan(-1)
    expect(book).toBeGreaterThan(vouched)
    expect(has(drawn, 'trust-in-book')).toBe(true)
  })

  it('says nothing of the address book for an account not known through it', () => {
    const drawn = screen(NOTHING_YET)

    expect(said(drawn)).toContain(t('trust_state_nothing'))
    expect(has(drawn, 'trust-in-book')).toBe(false)
  })
})
