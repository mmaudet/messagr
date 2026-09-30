import { createElement, Fragment, isValidElement, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { t } from '../copy'
import type { TimelineEntry } from '../timeline/mergeTimeline'
import { Conversation } from './Conversation'

/**
 * The conversation, walked rather than rendered, for the reason
 * `ConversationList.spec.ts` gives: nothing in this workspace renders React
 * Native off a device, and what a screen hands the platform is observable
 * without one.
 */

// The hooks, stood in for the same reason `ConversationList.spec.ts` stands
// them in: the walk calls components as functions, outside any renderer, and
// the screen holds which message has the whole catalogue open.
vi.mock('react', async importOriginal => ({
  ...(await importOriginal<typeof import('react')>()),
  useEffect: () => undefined,
  useRef: (current: unknown) => ({ current }),
  useState: (initial: unknown) => [initial, () => undefined],
}))

// The package itself is Flow source, which this workspace's transform cannot
// read: stood in, as every screen spec here does. What the photograph and the
// catalogue import is here too, since the screen imports them.
vi.mock('react-native', () => ({
  Image: 'Image',
  Modal: 'Modal',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { absoluteFill: {}, create: (styles: object) => styles },
  Text: 'Text',
  View: 'View',
  useWindowDimensions: () => ({ width: 390, height: 844 }),
}))

vi.mock('react-native-svg', () => ({
  default: 'Svg',
  Circle: 'Circle',
  Path: 'Path',
  Rect: 'Rect',
}))

const HER = '@her:example.invalid'
const ME = '@me:example.invalid'
const AT = Date.UTC(2026, 8, 30, 9, 0, 0)

function message(
  eventId: string,
  over: Partial<TimelineEntry> = {},
): TimelineEntry {
  return {
    eventId,
    claimedSender: HER,
    sentAt: AT,
    body: 'lisible',
    msgtype: 'm.text',
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

/** Every string this screen puts in front of somebody. */
function words(drawn: readonly Drawn[]): string[] {
  const said: string[] = []
  for (const node of everything(drawn)) {
    const children = node.props.children
    if (typeof children === 'string') said.push(children)
  }
  return said
}

/** The column a message is drawn in: what holds its bubble. */
function columnOf(drawn: readonly Drawn[], eventId: string): Drawn {
  for (const node of everything(drawn)) {
    if (node.children.some(child => child.props.testID === `bubble-${eventId}`))
      return node
  }
  throw new Error(`no bubble for ${eventId}`)
}

function conversation(entries: readonly TimelineEntry[]): Drawn[] {
  return draw(
    createElement(Conversation, {
      entries,
      selfUserId: ME,
      sending: 'idle',
      kept: null,
      now: AT + 60_000,
      otherParty: HER,
    }),
  )
}

describe('a message that is not encrypted (#461)', () => {
  it('says so under its bubble, and its words stay readable', () => {
    const drawn = conversation([
      message('$a', { sentAt: AT - 1000 }),
      message('$p', { body: 'en clair', unencrypted: true }),
    ])

    expect(withId(drawn, 'body-$p')?.props.children).toBe('en clair')
    expect(withId(drawn, 'unencrypted-$p')?.props.children).toBe(
      t('conversation_unencrypted'),
    )

    // UNDER THE BUBBLE: after it in the message's own column, and not
    // inside it, where it would read as part of what was written.
    const column = columnOf(drawn, '$p')
    const order = column.children.map(child => child.props.testID)
    expect(order.indexOf('unencrypted-$p')).toBeGreaterThan(
      order.indexOf('bubble-$p'),
    )
    const bubble = column.children[order.indexOf('bubble-$p')] as Drawn
    expect(words([bubble])).toEqual(['en clair'])
  })

  it('is never said under a message that arrived encrypted', () => {
    // Decrypted, unreadable here, removed for everyone, and this account's
    // own: each arrived encrypted, and none of them carries the mention.
    const drawn = conversation([
      message('$a'),
      message('$b', { body: null, reason: 'no session' }),
      message('$gone', { body: null, removed: true }),
      message('$mine', { claimedSender: ME }),
    ])

    for (const eventId of ['$a', '$b', '$gone', '$mine']) {
      expect(withId(drawn, `bubble-${eventId}`)).toBeDefined()
      expect(withId(drawn, `unencrypted-${eventId}`)).toBeUndefined()
    }
    expect(words(drawn)).not.toContain(t('conversation_unencrypted'))
  })

  it('is said under that message only, among the others', () => {
    const drawn = conversation([
      message('$a', { sentAt: AT - 2000 }),
      message('$p', { sentAt: AT - 1000, unencrypted: true }),
      message('$b', { sentAt: AT }),
    ])

    expect(
      words(drawn).filter(said => said === t('conversation_unencrypted')),
    ).toHaveLength(1)
    expect(
      withId(columnOf(drawn, '$p').children, 'unencrypted-$p'),
    ).toBeDefined()
  })
})
