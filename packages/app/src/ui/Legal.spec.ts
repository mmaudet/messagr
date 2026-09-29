import { createElement, Fragment, isValidElement, type ReactNode } from 'react'
import * as ReactNamespace from 'react'
import { describe, expect, it, vi } from 'vitest'

import { setCatalogue } from '../copy'
import { LANGUAGES } from '../copy/languages'
import { Legal } from './Legal'

/**
 * The legal screen's line about the full terms, drawn without a device.
 *
 * Walked rather than rendered, for the reason `BackupOffer.spec.ts` gives.
 *
 * #466: the terms are published in French, which is authoritative, and in
 * English. The line names the page a reader of this language is sent to, the
 * one the first screen's link opens: the French page in French, the English
 * page in every other language.
 */

vi.mock('react', async importOriginal => ({
  ...(await importOriginal<typeof import('react')>()),
  useEffect: () => undefined,
  useRef: (current: unknown) => ({ current }),
  useState: (initial: unknown) => [initial, () => undefined],
}))

vi.mock('react-native', () => ({
  Linking: { openURL: () => Promise.resolve() },
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

/** What the line about the full terms says, in the language chosen. */
function termsLine(): string {
  const drawn = draw(createElement(Legal, { onBack: () => undefined }))
  for (const node of everything(drawn)) {
    if (node.props.testID === 'legal-terms') return String(node.props.children)
  }
  throw new Error('the legal screen draws no line about the full terms')
}

describe('the full terms, named on the legal screen (#466)', () => {
  it.each(LANGUAGES.map(language => language.code))(
    'names the page a reader of %s is sent to',
    language => {
      try {
        setCatalogue(language)
        const line = termsLine()
        // Written out rather than recomputed: the two addresses the site
        // serves, and which one each language gets.
        if (language === 'fr') {
          expect(line).toContain('messagr.eu/conditions-generales')
          expect(line).not.toContain('messagr.eu/conditions-generales/en')
        } else {
          expect(line).toContain('messagr.eu/conditions-generales/en')
        }
      } finally {
        setCatalogue('fr')
      }
    },
  )
})
