import { createElement, Fragment, isValidElement, type ReactNode } from 'react'
import * as ReactNamespace from 'react'
import { describe, expect, it, vi } from 'vitest'

import { LANGUAGES, type Language } from '../copy/languages'
import { FirstLaunch } from './FirstLaunch'

/**
 * The first screen's link to the terms, drawn without a device.
 *
 * Walked rather than rendered, for the reason `BackupOffer.spec.ts` gives:
 * nothing in this workspace renders React Native off a device, and what a
 * screen hands the platform is observable without one. Here what it hands the
 * platform is an address, through `Linking`.
 *
 * #466: the terms are published in French, which is authoritative, and in
 * English at their own address. Somebody who chose another language than
 * French ticks a box about terms they must be able to read, so the link
 * opens the English page for every language but French.
 */

const opened = vi.hoisted(() => [] as string[])

vi.mock('react', async importOriginal => ({
  ...(await importOriginal<typeof import('react')>()),
  useEffect: () => undefined,
  useRef: (current: unknown) => ({ current }),
  useState: (initial: unknown) => [initial, () => undefined],
}))

vi.mock('react-native', () => ({
  Linking: {
    openURL: (address: string) => {
      opened.push(address)
      return Promise.resolve()
    },
  },
  Modal: 'Modal',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StatusBar: 'StatusBar',
  StyleSheet: { absoluteFill: {}, create: (styles: object) => styles },
  Text: 'Text',
  View: 'View',
}))

vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'SafeAreaView',
}))

vi.mock('react-native-svg', () => ({
  default: 'Svg',
  Path: 'Path',
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

function find(drawn: readonly Drawn[], testID: string): Drawn {
  for (const node of everything(drawn)) {
    if (node.props.testID === testID) return node
  }
  throw new Error(`nothing drawn carries testID ${testID}`)
}

const nothing = () => undefined

function screen(language: Language): Drawn[] {
  return draw(
    createElement(FirstLaunch, {
      language,
      onBegin: nothing,
      onLanguage: nothing,
      onLanguageSettled: nothing,
    }),
  )
}

/** Where the terms are published, as the site serves them. */
const FRENCH = 'https://messagr.eu/conditions-generales/'
const ENGLISH = 'https://messagr.eu/conditions-generales/en/'

describe('the link to the terms, on the first screen (#466)', () => {
  it('opens the French terms, which are authoritative, in French', () => {
    opened.length = 0
    const link = find(screen('fr'), 'promise-terms-link')

    ;(link.props.onPress as () => void)()

    expect(opened).toEqual([FRENCH])
  })

  it.each(
    LANGUAGES.map(language => language.code).filter(code => code !== 'fr'),
  )('opens the English translation in %s', language => {
    // Not French because the device is set to it: the terms exist in two
    // languages, and English is the one a person reading this screen in
    // German or Uzbek is likelier to read than French.
    opened.length = 0
    const link = find(screen(language), 'promise-terms-link')

    ;(link.props.onPress as () => void)()

    expect(opened).toEqual([ENGLISH])
  })
})
