import { createElement, Fragment, isValidElement, type ReactNode } from 'react'
import * as ReactNamespace from 'react'
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

// The hooks, stood in for the same reason `Invited.spec.ts` stands them in:
// the walk below calls components as functions, outside any renderer, and the
// empty state carries one that holds a draft (`PasteLink`, #367).
vi.mock('react', async importOriginal => ({
  ...(await importOriginal<typeof import('react')>()),
  useEffect: () => undefined,
  useRef: (current: unknown) => ({ current }),
  useState: (initial: unknown) => [initial, () => undefined],
}))

// The package itself is Flow source, which this workspace's transform cannot
// read -- `import typeof` is a syntax error to it. Every screen spec here
// stands the platform in rather than loading it.
vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  StyleSheet: { absoluteFill: {}, create: (styles: object) => styles },
  Text: 'Text',
  TextInput: 'TextInput',
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

describe('somewhere to paste the link, before the entry (#367)', () => {
  // #308 has no issue at all on an iPhone: an invitation opened from another
  // messenger's built-in browser never reaches Messagr, and the page's own
  // button is a link to its own domain, which iOS does not hand over. The
  // person can see the invitation, has the application installed, and cannot
  // get in. The field is the way out, and it belongs on the one screen that
  // says « ouvrez le lien qu'on vous a envoyé », immediately under it.

  it('offers the field under the sentence that says to open the link', () => {
    const drawn = list({
      summaries: [],
      notInYet: true,
      onPasteLink: () => undefined,
    })

    expect(words(drawn)).toContain(t('list_not_in_yet'))
    expect(withId(drawn, 'paste-link')).toBeDefined()
  })

  it('offers it nowhere else', () => {
    // The list or the way in, never both: somebody with conversations is in,
    // and a field asking for an invitation on their list would be the
    // application forgetting who it is talking to.
    expect(
      withId(
        list({ notInYet: true, onPasteLink: () => undefined }),
        'paste-link',
      ),
    ).toBeUndefined()
    expect(
      withId(
        list({ summaries: [], notInYet: false, onPasteLink: () => undefined }),
        'paste-link',
      ),
    ).toBeUndefined()
  })

  it('offers nothing where nothing can spend what is pasted', () => {
    // Drawn only when an entry is wired to it. A field handing its link to
    // nobody is a gesture with no answer, which is the defect this ticket is
    // about rather than a smaller version of it.
    expect(
      withId(list({ summaries: [], notInYet: true }), 'paste-link'),
    ).toBeUndefined()
  })

  it('carries what became of the last link it handed over', () => {
    const drawn = list({
      summaries: [],
      notInYet: true,
      onPasteLink: () => undefined,
      pasting: 'refused',
    })

    expect(withId(drawn, 'paste-link-refused')).toBeDefined()
  })
})
