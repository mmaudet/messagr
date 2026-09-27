import { createElement, Fragment, isValidElement, type ReactNode } from 'react'
import * as ReactNamespace from 'react'
import { describe, expect, it, vi } from 'vitest'

import { t } from '../copy'
import type { ConversationSummary } from '../runtime/conversationList'
import { ConversationList } from './ConversationList'
import { dayOf } from './whenLabel'

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

describe('the sentence about being findable (#398)', () => {
  const DAY = 86_400_000

  it('proposes renewing, with the day the proof ends and the gesture that does it', () => {
    let pressed = 0
    const drawn = list({
      findableNotice: { notice: 'renew', until: NOW + 3 * DAY },
      onProveAgain: () => (pressed += 1),
    })

    expect(words(drawn)).toContain(
      t('list_findable_renew %@', dayOf(NOW + 3 * DAY)),
    )
    const action = withId(drawn, 'list-findable-action')
    expect(action?.props.label).toBe(t('list_findable_renew_action'))
    ;(action?.props.onPress as () => void)()
    expect(pressed).toBe(1)
  })

  it('says a proof ran out, and offers to prove the number again', () => {
    const drawn = list({
      findableNotice: { notice: 'expired' },
      onProveAgain: () => undefined,
    })
    expect(words(drawn)).toContain(t('list_findable_expired'))
    expect(withId(drawn, 'list-findable-action')?.props.label).toBe(
      t('list_findable_prove_action'),
    )
  })

  it('says the number now makes another account findable, and offers nothing to press', () => {
    const drawn = list({
      findableNotice: { notice: 'replaced' },
      onProveAgain: () => undefined,
    })
    expect(words(drawn)).toContain(t('list_findable_replaced'))
    expect(withId(drawn, 'list-findable-action')).toBeUndefined()
  })

  it('says nothing when there is nothing to say', () => {
    expect(withId(list(), 'list-findable')).toBeUndefined()
  })
})

describe('a conversation an invitation delivered inside Messagr waits in (#404)', () => {
  const waiting = conversation({
    other: null,
    others: 0,
    preview: null,
    lastAt: 0,
    reason: 'nothing has been said yet',
  })
  const sent = (expired: boolean, given: string | null = 'Paul') =>
    new Map([
      [
        waiting.scope,
        {
          invitationId: 'inv-1',
          scope: waiting.scope,
          expiresAt: NOW + 7 * 86_400_000,
          given,
          expired,
        },
      ],
    ])

  it('says whom it waits for, and until when', () => {
    const drawn = list({ summaries: [waiting], sent: sent(false) })

    expect(words(drawn)).toContain('Paul')
    expect(words(drawn)).toContain(
      t('list_sent_waiting %1$@', dayOf(NOW + 7 * 86_400_000)),
    )
    expect(words(drawn)).not.toContain(t('list_nobody_joined'))
  })

  it('then that it expired', () => {
    const drawn = list({ summaries: [waiting], sent: sent(true) })

    expect(words(drawn)).toContain(t('list_sent_expired'))
  })

  it('says nobody joined when no name was typed, as a link does', () => {
    const drawn = list({ summaries: [waiting], sent: sent(false, null) })

    expect(words(drawn)).toContain(t('list_nobody_joined'))
  })

  it('leaves a conversation somebody is in as it is', () => {
    const drawn = list({ summaries: [conversation()], sent: sent(false) })

    expect(words(drawn)).toContain('Bonjour')
    expect(words(drawn)).not.toContain('Paul')
  })
})

describe('invitations delivered inside Messagr, atop the list (#404)', () => {
  const waiting = [
    { id: 'a', expiresAt: NOW + 7 * 86_400_000 },
    { id: 'b', expiresAt: NOW + 3 * 86_400_000 },
  ]

  it('draws each above the conversations, with its deadline, and opens it', () => {
    const opened: string[] = []
    const drawn = list({
      delivered: waiting,
      onOpenDelivered: invitation => opened.push(invitation.id),
    })

    const said = words(drawn)
    expect(said.indexOf(t('list_delivered_invitation'))).toBeLessThan(
      said.indexOf('Bonjour'),
    )
    expect(said).toContain(
      t('list_delivered_until %1$@', dayOf(NOW + 3 * 86_400_000)),
    )
    // One test identifier per invitation, so that each can be pressed.
    ;(withId(drawn, 'list-delivered-b')?.props.onPress as () => void)()
    expect(opened).toEqual(['b'])
    expect(withId(drawn, 'list-delivered-a')).toBeDefined()
  })

  it('draws those accepted until their conversation appears, with nothing to press', () => {
    const drawn = list({
      delivered: waiting,
      joinedDelivered: [{ id: 'c', inviter: '@alice:x' }],
    })

    const row = withId(drawn, 'list-delivered-joined-c')
    expect(row).toBeDefined()
    expect(row?.props.onPress).toBeUndefined()
    const said = words(drawn)
    expect(said).toContain(t('list_delivered_joined'))
    expect(said).toContain(t('list_delivered_joined_waiting'))
    // Nothing says who, as long as the conversation has not come.
    expect(said.join(' ')).not.toContain('alice')
    expect(said.indexOf(t('list_delivered_invitation'))).toBeLessThan(
      said.indexOf(t('list_delivered_joined')),
    )
  })

  it('says why nothing followed an answer given too late', () => {
    for (const [outcome, key] of [
      ['expired', 'list_delivered_expired'],
      ['gone', 'list_delivered_gone'],
    ] as const) {
      const drawn = list({ deliveredOutcome: outcome })
      expect(withId(drawn, 'list-delivered-outcome')?.props.children).toBe(
        t(key),
      )
    }
    expect(withId(list(), 'list-delivered-outcome')).toBeUndefined()
  })

  it('leaves the first conversation its own test identifier', () => {
    const drawn = list({ delivered: waiting })

    expect(withId(drawn, 'first-conversation')).toBeDefined()
    expect(
      [...everything(drawn)].filter(
        node => node.props.testID === 'first-conversation',
      ),
    ).toHaveLength(1)
  })
})
