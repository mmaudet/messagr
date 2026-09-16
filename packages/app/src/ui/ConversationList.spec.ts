import { createElement, Fragment, isValidElement, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { t } from '../copy'
import type { ConversationSummary } from '../runtime/conversationList'
import { ConversationList } from './ConversationList'

/**
 * The list, walked rather than rendered, for the reason `BackupOffer.spec.ts`
 * gives: nothing in this workspace renders React Native off a device, and what
 * a screen hands the platform is observable without one.
 *
 * What is asserted here is the half of #280 a person actually sees. That a
 * touch made too early is kept and replayed is `waitingToOpen.spec.ts`; that
 * the row *says* so while it waits is this.
 */

// The package itself is Flow source, which this workspace's transform cannot
// read -- `import typeof` is a syntax error to it. Every screen spec here
// stands the platform in rather than loading it.
vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  StyleSheet: { create: (styles: object) => styles },
  Text: 'Text',
  View: 'View',
}))

const NOW = Date.UTC(2026, 8, 16, 10, 0, 0)

function conversation(
  over: Partial<ConversationSummary> = {},
): ConversationSummary {
  return {
    scope: '!a:example.invalid',
    other: '@someone:example.invalid',
    others: 1,
    preview: 'Bonjour',
    lastAt: NOW - 60_000,
    unread: 0,
    ...over,
  }
}

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

/** Every string this list puts in front of somebody. */
function words(drawn: readonly Drawn[]): string[] {
  const said: string[] = []
  for (const node of everything(drawn)) {
    const children = node.props.children
    if (typeof children === 'string') said.push(children)
  }
  return said
}

function list(
  over: Partial<Parameters<typeof ConversationList>[0]> = {},
): Drawn[] {
  return draw(
    createElement(ConversationList, {
      summaries: [conversation()],
      names: new Map<string, string>(),
      onOpen: () => undefined,
      now: NOW,
      ...over,
    }),
  )
}

describe('a row whose conversation is waiting on the launch (#280)', () => {
  it('says the conversation is opening, in place of what was last said in it', () => {
    // The measurement in #280: three touches inside the window, and « aucune
    // ligne MESSAGR_BACKUP_TRIGGER ni MESSAGR_OPEN_CONVERSATION_FAILED sur les
    // trois lancements ». Nothing happened and nothing said so. The row is
    // where it has to be said, because the row is what was touched.
    const drawn = list({ opening: '!a:example.invalid' })

    expect(words(drawn)).toContain(t('list_opening'))
    expect(words(drawn)).not.toContain('Bonjour')
    expect(withId(drawn, 'conversation-opening')).toBeDefined()
  })

  it('marks the row busy, so a screen reader says it too', () => {
    const row = withId(
      list({ opening: '!a:example.invalid' }),
      'first-conversation',
    )

    expect(row?.props.accessibilityState).toEqual({ busy: true })
  })

  it('says nothing of the sort on the rows that were not touched', () => {
    const drawn = list({
      summaries: [
        conversation(),
        conversation({ scope: '!b:example.invalid', preview: 'Bonsoir' }),
      ],
      opening: '!b:example.invalid',
    })

    const first = withId(drawn, 'first-conversation')
    expect(words([first as Drawn])).toContain('Bonjour')
    expect(words([first as Drawn])).not.toContain(t('list_opening'))
  })

  it('draws the ordinary row when nothing is waiting', () => {
    // The state a list is in almost all the time, asserted so that the line
    // above cannot quietly become the only one there is.
    const drawn = list()

    expect(words(drawn)).toContain('Bonjour')
    expect(withId(drawn, 'conversation-opening')).toBeUndefined()
    expect(
      withId(drawn, 'first-conversation')?.props.accessibilityState,
    ).toEqual({ busy: false })
  })

  it('opens the conversation of the row that is touched', () => {
    // The row hands its own scope over and decides nothing else: what becomes
    // of a touch too early for the launch belongs to `waitingToOpen.ts`.
    const touched: string[] = []
    const drawn = list({
      onOpen: scope => {
        touched.push(scope)
      },
    })

    const row = withId(drawn, 'first-conversation')
    ;(row?.props.onPress as () => void)()

    expect(touched).toEqual(['!a:example.invalid'])
  })
})
