import { createElement, Fragment, isValidElement, type ReactNode } from 'react'
import * as ReactNamespace from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { t } from '../copy'
import type { Contact, FindingStage } from '../runtime/findContacts'
import { FindContacts } from './FindContacts'
import { dayOf } from './whenLabel'

/**
 * « Retrouver mes contacts », walked rather than rendered, for the reason
 * `BackupOffer.spec.ts` gives.
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

function withId(drawn: readonly Drawn[], testID: string): Drawn | undefined {
  for (const node of everything(drawn)) {
    if (node.props.testID === testID) return node
  }
  return undefined
}

function textIn(node: Drawn | undefined): string {
  if (node === undefined) return ''
  const own = typeof node.props.children === 'string' ? node.props.children : ''
  return [own, ...node.children.map(textIn)].join('')
}

function all(drawn: readonly Drawn[], testID: string): Drawn[] {
  return [...everything(drawn)].filter(node => node.props.testID === testID)
}

const said = { continued: 0, closed: 0 }

function show(stage: Exclude<FindingStage, { readonly stage: 'shut' }>) {
  return draw(
    createElement(FindContacts, {
      stage,
      onContinue: () => (said.continued += 1),
      onClose: () => (said.closed += 1),
    }),
  )
}

const press = (node: Drawn | undefined) =>
  (node?.props.onPress as (() => void) | undefined)?.()

const contact = (name: string): Contact => ({ name, numbers: [] })

beforeEach(() => {
  said.continued = 0
  said.closed = 0
})

describe('« Retrouver mes contacts »', () => {
  it('reminds in one line, with « Continuer » as its only button', () => {
    const drawn = show({ stage: 'reminder' })

    const reminder = withId(drawn, 'find-contacts-reminder')
    expect(textIn(reminder)).toContain(t('find_reminder'))
    // A button is drawn as its component and the `Pressable` inside it, both
    // under one test id: what counts is how many ids answer a press.
    const buttons = new Set(
      [...everything(reminder ? [reminder] : [])]
        .filter(node => typeof node.props.onPress === 'function')
        .map(node => node.props.testID),
    )
    expect([...buttons]).toEqual(['find-contacts-continue'])
    press(withId(drawn, 'find-contacts-continue'))
    expect(said.continued).toBe(1)
  })

  it('shows the contacts on Messagr first, under the name of their card, then the others', () => {
    const drawn = show({
      stage: 'found',
      matches: [
        { contact: contact('Anne'), reference: 'r-anne', holderChanged: false },
        { contact: contact('Paul'), reference: 'r-paul', holderChanged: false },
      ],
      others: [contact('Zoé')],
      waiting: null,
    })

    expect(all(drawn, 'find-contacts-match').map(textIn)).toEqual([
      'Anne',
      'Paul',
    ])
    expect(all(drawn, 'find-contacts-other').map(textIn)).toEqual(['Zoé'])
    const found = textIn(withId(drawn, 'find-contacts-found'))
    expect(found.indexOf('Paul')).toBeLessThan(found.indexOf('Zoé'))
    expect(found).not.toContain('r-anne')
  })

  it('says a number changed hands under the name of its card', () => {
    const drawn = show({
      stage: 'found',
      matches: [
        { contact: contact('Anne'), reference: 'r-anne', holderChanged: true },
        { contact: contact('Paul'), reference: 'r-paul', holderChanged: false },
      ],
      others: [],
      waiting: null,
    })

    expect(all(drawn, 'find-contacts-holder-changed').map(textIn)).toEqual([
      t('find_holder_changed'),
    ])
    const found = textIn(withId(drawn, 'find-contacts-found'))
    const line = found.indexOf(t('find_holder_changed'))
    expect(line).toBeGreaterThan(found.indexOf('Anne'))
    expect(line).toBeLessThan(found.indexOf('Paul'))
  })

  it('puts no gesture on a contact', () => {
    const drawn = show({
      stage: 'found',
      matches: [
        { contact: contact('Anne'), reference: 'r-anne', holderChanged: false },
      ],
      others: [contact('Zoé')],
      waiting: null,
    })

    for (const row of [
      ...all(drawn, 'find-contacts-match'),
      ...all(drawn, 'find-contacts-other'),
    ]) {
      expect(row.props.onPress).toBeUndefined()
    }
  })

  it('says so when no contact is on Messagr', () => {
    const drawn = show({
      stage: 'found',
      matches: [],
      others: [contact('Zoé')],
      waiting: null,
    })

    expect(textIn(withId(drawn, 'find-contacts-nobody'))).toBe(t('find_nobody'))
  })

  it('says how many contacts the limit left for later, and from when', () => {
    const freesAt = new Date(2026, 9, 26, 12).getTime()
    const drawn = show({
      stage: 'found',
      matches: [],
      others: [contact('Zoé')],
      waiting: { count: 12, freesAt },
    })

    expect(textIn(withId(drawn, 'find-contacts-waiting'))).toBe(
      t('find_waiting %1$@ %2$@', '12', dayOf(freesAt)),
    )
    expect(
      withId(
        show({ stage: 'found', matches: [], others: [], waiting: null }),
        'find-contacts-waiting',
      ),
    ).toBeUndefined()
  })

  it('says nobody is on Messagr only when every number was compared', () => {
    const waiting = { count: 12, freesAt: new Date(2026, 9, 26, 12).getTime() }
    const noneYet = show({
      stage: 'found',
      matches: [],
      others: [contact('Zoé')],
      waiting,
    })

    expect(withId(noneYet, 'find-contacts-nobody')).toBeUndefined()
    expect(textIn(withId(noneYet, 'find-contacts-found'))).not.toContain(
      t('find_on_messagr'),
    )
    const some = show({
      stage: 'found',
      matches: [
        { contact: contact('Anne'), reference: 'r-anne', holderChanged: false },
      ],
      others: [],
      waiting,
    })
    expect(textIn(withId(some, 'find-contacts-found'))).toContain(
      t('find_on_messagr'),
    )
    expect(all(some, 'find-contacts-match').map(textIn)).toEqual(['Anne'])
  })

  it('says why nothing is shown, and leads back', () => {
    for (const [why, key] of [
      ['no-access', 'find_no_access'],
      ['not-the-published-key', 'find_not_the_published_key'],
      ['unreachable', 'find_unreachable'],
      ['off', 'find_off'],
      ['not-findable', 'find_not_findable'],
    ] as const) {
      const drawn = show({ stage: 'refused', why })
      expect(textIn(withId(drawn, 'find-contacts-refused'))).toBe(t(key))
    }
    press(
      withId(
        show({ stage: 'refused', why: 'unreachable' }),
        'find-contacts-done',
      ),
    )
    expect(said.closed).toBe(1)
  })
})
