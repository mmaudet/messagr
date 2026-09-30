import { createElement, Fragment, isValidElement, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { t } from '../copy'
import { EVERYTHING_SHOWN, reactionsShown } from '../runtime/notShown'
import type { ShownImage } from '../runtime/receiveImage'
import {
  toTimelineEntries,
  type TimelineMachine,
} from '../timeline/buildTimeline'
import {
  asRemoved,
  mergeTimeline,
  type TimelineEntry,
} from '../timeline/mergeTimeline'
import type { LooseReaction } from '../timeline/reactions'
import { Conversation } from './Conversation'

/**
 * The conversation, walked rather than rendered, for the reason
 * `ConversationList.spec.ts` gives: nothing in this workspace renders React
 * Native off a device, and what a screen hands the platform is observable
 * without one.
 *
 * What it draws is built from events, through `toTimelineEntries`, the way
 * the application builds it: a test handed entries directly would say what
 * the screen does with a mark, and nothing of which messages carry one.
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
const HIM = '@him:example.invalid'
const ME = '@me:example.invalid'
const ROOM = '!room:example.invalid'
const AT = Date.UTC(2026, 8, 30, 9, 0, 0)
const MENTION = t('conversation_unencrypted')

/** An event as it arrives encrypted: what it says is the machine's. */
function sealed(id: string, at: number, sender = HER) {
  return {
    type: 'm.room.encrypted',
    event_id: id,
    sender,
    origin_server_ts: AT + at,
    content: { algorithm: 'm.megolm.v1.aes-sha2', ciphertext: 'x' },
  }
}

/** A message as it was written, never encrypted. */
function inClear(
  id: string,
  at: number,
  content: Record<string, unknown> = { msgtype: 'm.text', body: 'en clair' },
) {
  return {
    type: 'm.room.message',
    event_id: id,
    sender: HER,
    origin_server_ts: AT + at,
    content,
  }
}

/** What the homeserver serves once an event is removed for everyone. */
function removedShell(event: object, kind?: 'message') {
  return {
    ...event,
    content: {},
    unsigned: {
      redacted_because: {
        type: 'm.room.redaction',
        ...(kind === undefined ? {} : { content: { 'eu.messagr.kind': kind } }),
      },
    },
  }
}

const TEXT = (body: string) => ({
  type: 'm.room.message',
  content: { msgtype: 'm.text', body },
})

/**
 * Opens each sealed event to the inner type and content given for it; one
 * given nothing has no key here.
 */
function opening(
  contents: Record<string, { type: string; content: object }> = {},
): TimelineMachine {
  return {
    decryptEvent: async (_scope, rawEvent) => {
      const opened = contents[(rawEvent as { event_id: string }).event_id]
      if (opened === undefined) throw new Error('no session')
      return {
        eventType: opened.type,
        ciphertext: new TextEncoder().encode(JSON.stringify(opened.content)),
      }
    },
  }
}

/** The conversation as the application derives it from the room. */
async function derived(
  events: readonly unknown[],
  machine: TimelineMachine = opening(),
): Promise<{ entries: TimelineEntry[]; reactions: LooseReaction[] }> {
  return toTimelineEntries(
    machine,
    bytes => new TextDecoder().decode(bytes),
    ROOM,
    events,
  )
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

/** What the column of a message holds, in order, by identifier. */
function orderIn(drawn: readonly Drawn[], eventId: string): unknown[] {
  return columnOf(drawn, eventId).children.map(child => child.props.testID)
}

/** A download that never answers: the walk draws before anything arrives. */
const NEVER = () => new Promise<ShownImage>(() => undefined)

function conversation(
  entries: readonly TimelineEntry[],
  reactions: readonly LooseReaction[] = [],
): Drawn[] {
  return draw(
    createElement(Conversation, {
      entries,
      reactions: reactionsShown(reactions, EVERYTHING_SHOWN, ME),
      selfUserId: ME,
      sending: 'idle',
      kept: null,
      now: AT + 60_000,
      otherParty: HER,
      onLoadImage: NEVER,
      onOpenPlate: () => undefined,
    }),
  )
}

describe('a message that is not encrypted (#461)', () => {
  it('says so under its bubble, and its words stay readable', async () => {
    const { entries } = await derived(
      [sealed('$a', 0), inClear('$p', 1000)],
      opening({ $a: TEXT('lisible') }),
    )
    const drawn = conversation(entries)

    expect(withId(drawn, 'body-$p')?.props.children).toBe('en clair')
    expect(withId(drawn, 'unencrypted-$p')?.props.children).toBe(MENTION)

    // UNDER THE BUBBLE: after it in the message's own column, and not
    // inside it, where it would read as part of what was written.
    const order = orderIn(drawn, '$p')
    expect(order.indexOf('unencrypted-$p')).toBeGreaterThan(
      order.indexOf('bubble-$p'),
    )
    const bubble = withId(drawn, 'bubble-$p') as Drawn
    expect(words([bubble])).toEqual(['en clair'])
  })

  it('is never said under a message that arrived encrypted', async () => {
    // Decrypted, unreadable here, removed for everyone, and this account's
    // own: each arrived encrypted, and none of them carries the mention.
    const { entries } = await derived(
      [
        sealed('$a', 0),
        sealed('$b', 1000),
        removedShell(sealed('$gone', 2000), 'message'),
        sealed('$mine', 3000, ME),
      ],
      opening({ $a: TEXT('lisible'), $mine: TEXT('de moi') }),
    )
    const drawn = conversation(entries)

    for (const eventId of ['$a', '$b', '$gone', '$mine']) {
      expect(withId(drawn, `bubble-${eventId}`)).toBeDefined()
      expect(withId(drawn, `unencrypted-${eventId}`)).toBeUndefined()
    }
    expect(words(drawn)).not.toContain(MENTION)
  })

  it('is said under that message only, among the others', async () => {
    const { entries } = await derived(
      [sealed('$a', 0), inClear('$p', 1000), sealed('$b', 2000)],
      opening({ $a: TEXT('avant'), $b: TEXT('après') }),
    )
    const drawn = conversation(entries)

    expect(words(drawn).filter(said => said === MENTION)).toHaveLength(1)
    expect(orderIn(drawn, '$p')).toContain('unencrypted-$p')
  })

  it('is said under a message somebody reacted to, below its reactions', async () => {
    const { entries, reactions } = await derived(
      [inClear('$p', 0), sealed('$r', 1000, HIM)],
      opening({
        $r: {
          type: 'm.reaction',
          content: {
            'm.relates_to': {
              rel_type: 'm.annotation',
              event_id: '$p',
              key: '👍',
            },
          },
        },
      }),
    )
    const drawn = conversation(entries, reactions)

    const order = orderIn(drawn, '$p')
    expect(order.indexOf('reactions-$p')).toBeGreaterThan(
      order.indexOf('bubble-$p'),
    )
    expect(order.indexOf('unencrypted-$p')).toBeGreaterThan(
      order.indexOf('reactions-$p'),
    )
  })

  it('is said under a photograph that arrived unencrypted, and never under a decrypted one', async () => {
    const photograph = (where: Record<string, unknown>) => ({
      msgtype: 'm.image',
      body: 'photo.jpg',
      info: { mimetype: 'image/jpeg', w: 4, h: 3 },
      ...where,
    })
    const { entries } = await derived(
      [
        sealed('$sealed', 0),
        inClear('$open', 1000, photograph({ url: 'mxc://example.invalid/o' })),
      ],
      opening({
        $sealed: {
          type: 'm.room.message',
          content: photograph({
            file: { url: 'mxc://example.invalid/s', v: 'v2' },
          }),
        },
      }),
    )
    const drawn = conversation(entries)

    expect(withId(drawn, 'image-$sealed')).toBeDefined()
    expect(withId(drawn, 'unencrypted-$sealed')).toBeUndefined()
    expect(withId(drawn, 'image-$open')).toBeUndefined()
    expect(withId(drawn, 'unencrypted-$open')?.props.children).toBe(MENTION)
  })
})

describe('a message once removed (#461)', () => {
  /** What the removal line says, and whether the mention is under it. */
  function removalOf(drawn: readonly Drawn[], eventId: string) {
    return {
      line: withId(drawn, `body-${eventId}`)?.props.children,
      mention: withId(drawn, `unencrypted-${eventId}`) !== undefined,
    }
  }
  const LINE = { line: t('conversation_removed'), mention: false }

  it('leaves the removal line and no mention, once the conversation is opened again', async () => {
    const { entries } = await derived([removedShell(inClear('$p', 0))])

    expect(removalOf(conversation(entries), '$p')).toEqual(LINE)
  })

  it('leaves the removal line and no mention, once this device removed it', async () => {
    // The screen's own gesture, drawn the moment the homeserver accepts it,
    // as the application draws it.
    const { entries } = await derived([inClear('$p', 0)])
    const removed = entries.map(entry =>
      entry.eventId === '$p' ? asRemoved(entry) : entry,
    )

    expect(removalOf(conversation(removed), '$p')).toEqual(LINE)
  })

  it('leaves the removal line and no mention, once the other side removed it while it was open', async () => {
    // The room read again on the poll that carried the removal, and merged
    // into what the screen shows.
    const shown = (await derived([inClear('$p', 0)])).entries
    const readAgain = (await derived([removedShell(inClear('$p', 0))])).entries
    const drawn = conversation(mergeTimeline(shown, readAgain))

    expect(removalOf(drawn, '$p')).toEqual(LINE)
    expect(words(drawn)).not.toContain('en clair')
  })

  it('leaves the removal line and no photograph, once this device removed a photograph', async () => {
    const { entries } = await derived(
      [sealed('$img', 0)],
      opening({
        $img: {
          type: 'm.room.message',
          content: {
            msgtype: 'm.image',
            body: 'photo.jpg',
            file: { url: 'mxc://example.invalid/s', v: 'v2' },
            info: { mimetype: 'image/jpeg', w: 4, h: 3 },
          },
        },
      }),
    )
    const drawn = conversation(entries.map(entry => asRemoved(entry)))

    expect(withId(drawn, 'image-$img')).toBeUndefined()
    expect(removalOf(drawn, '$img')).toEqual(LINE)
  })

  it('draws no mention under a removal line, whatever its entry still carries', async () => {
    const { entries } = await derived([inClear('$p', 0)])
    const kept = entries.map(entry => ({
      ...entry,
      body: null,
      removed: true,
    }))

    expect(removalOf(conversation(kept), '$p')).toEqual(LINE)
  })
})
