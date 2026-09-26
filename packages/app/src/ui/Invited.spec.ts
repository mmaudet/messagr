import { createElement, Fragment, isValidElement, type ReactNode } from 'react'
import * as ReactNamespace from 'react'
import { describe, expect, it, vi } from 'vitest'

import { t } from '../copy'
import type { WhatIsKnown } from '../runtime/invitationOnScreen'
import { Invited } from './Invited'

/**
 * The screen that decides an invitation nobody spent a link for.
 *
 * Walked rather than rendered, for the reason `BackupOffer.spec.ts` gives:
 * nothing in this workspace renders React Native off a device, and what a
 * screen hands the platform is observable without one.
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

/** The outermost element the platform itself receives. */
function rootHost(drawn: readonly Drawn[]): Drawn | undefined {
  for (const node of everything(drawn)) {
    if (typeof node.type === 'string') return node
  }
  return undefined
}

function has(within: readonly Drawn[], testID: string): boolean {
  for (const node of everything(within)) {
    if (node.props.testID === testID) return true
  }
  return false
}

function find(within: readonly Drawn[], testID: string): Drawn | undefined {
  for (const node of everything(within)) {
    if (node.props.testID === testID) return node
  }
  return undefined
}

/** Every string this screen hands the platform, in the order it hands it. */
function said(drawn: readonly Drawn[]): string[] {
  const lines: string[] = []
  for (const node of everything(drawn)) {
    if (node.type !== 'Text') continue
    const child = node.props.children
    if (typeof child === 'string') lines.push(child)
  }
  return lines
}

const nothing = () => undefined

const her: WhatIsKnown = {
  source: 'threshold',
  scope: '!a:messagr.eu',
  declared: '',
  who: 'Nadia',
  named: true,
  identifier: '@her:messagr.eu',
  instance: 'messagr.eu',
  elsewhere: false,
}

/** The same screen, opened by a link nobody has spent yet. #329. */
const byLink: WhatIsKnown = {
  source: 'link',
  scope: '',
  declared: 'Nadia',
  who: '',
  named: false,
  identifier: '',
  instance: 'messagr.eu',
  elsewhere: false,
}

function screen(over: Partial<Parameters<typeof Invited>[0]> = {}): Drawn[] {
  return draw(
    createElement(Invited, {
      known: her,
      behind: 0,
      working: null,
      failed: false,
      onJoin: nothing,
      onRefuse: nothing,
      ...over,
    }),
  )
}

describe('the invitation standing on the threshold', () => {
  it('describes the link before either action, in one order', () => {
    // §13.3's first screen: the invitation is described in full BEFORE any
    // decision, and the two actions come last. The control is the order as
    // much as the content -- a fact under a button is a fact read after the
    // decision.
    expect(said(screen())).toEqual([
      t('invited_title'),
      'Nadia',
      '@her:messagr.eu',
      t('invited_lead'),
      t('invited_instance %@', 'messagr.eu'),
      t('invited_terms_unknown'),
      t('invited_nothing_sent'),
      t('invited_join'),
      t('invited_refuse'),
    ])
  })

  it('offers two actions and no third', () => {
    // « Deux actions symétriques : rejoindre, refuser. Pas de "continuer
    // quand même". » The refusal is a button of the same rank rather than a
    // line of text somebody has to hunt for.
    const root = rootHost(screen()) as Drawn
    const pressables = [...everything([root])].filter(
      node => node.type === 'Pressable',
    )
    expect(pressables.map(node => node.props.testID)).toEqual([
      'invited-join',
      'invited-refuse',
    ])
    // Reachable without sight, and reachable by its own words: a refusal
    // announced as anything but a refusal is not of the same rank.
    expect(pressables[1]?.props.accessibilityLabel).toBe(t('invited_refuse'))
    expect(pressables[0]?.props.accessibilityLabel).toBe(t('invited_join'))
  })

  it('scrolls, and keeps both actions inside what scrolls', () => {
    // #324's lesson, and it applies with more force here: an action pinned
    // outside the scrolling area is an action a longer label can push off a
    // short telephone, and this screen is the only way to answer an
    // invitation at all.
    const root = rootHost(screen({ failed: true, behind: 3 }))

    expect(root?.type).toBe('ScrollView')
    expect(root?.props.testID).toBe('invited')
    expect(root?.props.contentContainerStyle).toMatchObject({ flexGrow: 1 })
    expect(has([root as Drawn], 'invited-join')).toBe(true)
    expect(has([root as Drawn], 'invited-refuse')).toBe(true)
    expect(has([root as Drawn], 'invited-failed')).toBe(true)
  })

  it('says which instance the account lives on', () => {
    expect(said(screen())).toContain(t('invited_instance %@', 'messagr.eu'))
  })

  it('says so when that instance is not this account’s own', () => {
    const drawn = screen({
      known: { ...her, instance: 'other.example', elsewhere: true },
    })
    expect(said(drawn)).toContain(
      t('invited_instance_elsewhere %@', 'other.example'),
    )
    expect(said(drawn)).not.toContain(t('invited_instance %@', 'other.example'))
  })

  it('says what it cannot state rather than leaving a hole', () => {
    // Validity and remaining uses belong to the link, and this device never
    // held it: `services/invitations/src/handlers/status.rs` answers only the
    // account that issued the invitation. A screen that simply omitted them
    // would read as an invitation without limits.
    expect(said(screen())).toContain(t('invited_terms_unknown'))
  })

  it('says that nothing has been sent while nobody has answered', () => {
    expect(said(screen())).toContain(t('invited_nothing_sent'))
  })

  it('names nobody when nobody can be named, and still asks', () => {
    const drawn = screen({
      known: {
        source: 'threshold',
        scope: '!a:x',
        declared: '',
        who: '',
        named: false,
        identifier: '',
        instance: null,
        elsewhere: false,
      },
    })
    expect(said(drawn)).toEqual([
      t('invited_title'),
      t('invited_who_unknown'),
      t('invited_terms_unknown'),
      t('invited_nothing_sent'),
      t('invited_join'),
      t('invited_refuse'),
    ])
  })

  it('says how many stand behind this one', () => {
    expect(said(screen({ behind: 2 }))).toContain(t('invited_behind %1$d', 2))
  })

  it('says nothing about a queue when there is none', () => {
    expect(said(screen({ behind: 0 }))).not.toContain(
      t('invited_behind %1$d', 0),
    )
  })

  it('waits under a label that says so, with neither action live', () => {
    // A tap that shows nothing invites another, and a second tap here would
    // send a second join or a refusal over a join.
    const drawn = screen({ working: 'join' })
    expect(find(drawn, 'invited-join')?.props.disabled).toBe(true)
    expect(find(drawn, 'invited-refuse')?.props.disabled).toBe(true)
    expect(said(drawn)).toContain(t('invited_working'))
    expect(said(drawn)).not.toContain(t('invited_join'))
  })

  it('stays up and says so when neither action went through', () => {
    // The invitation is exactly where it was. A screen that closed would
    // leave somebody believing they had answered.
    expect(said(screen({ failed: true }))).toContain(t('invited_failed'))
  })

  it('never says « se présente comme » of a name this device gave', () => {
    // §13.26's formula is for a name its bearer DECLARED. A given name is
    // what this telephone calls somebody; borrowing the formula for it would
    // put the inviter's word on something they never said.
    expect(said(screen())).not.toContain(
      t('conversation_sender_claimed %@', 'Nadia'),
    )
    expect(said(screen())).toContain('Nadia')
  })

  it('announces no agent, because the product has none to announce', () => {
    // §13.3 asks for any agent in the room to be announced here. Nothing in
    // this application creates, inserts or reads an agent yet -- screens 3 to
    // 5 are priority 2 -- so there is no member of that kind for a stripped
    // state to carry. A block saying « aucun agent » would be this screen
    // inventing a guarantee nothing measures.
    for (const line of said(screen())) {
      expect(line.toLowerCase()).not.toContain('agent')
    }
  })
})

describe('the same screen, opened by a link', () => {
  it('names the inviter as claiming a name, never as being one', () => {
    // §13.26, and the formula is the one `Conversation.tsx` already uses: a
    // name travelling in a link is a name its sender WROTE. Nothing has
    // proved who holds the account that issued it -- the account does not
    // even exist on this device's side yet -- so the word is always
    // « se présente comme ».
    expect(said(screen({ known: byLink }))).toEqual([
      t('invited_title'),
      t('conversation_sender_claimed %@', 'Nadia'),
      t('invited_lead'),
      t('invited_instance %@', 'messagr.eu'),
      t('invited_terms_link'),
      t('invited_nothing_spent'),
      t('invited_join'),
      t('invited_refuse'),
    ])
  })

  it('writes no identifier under it, because the link carries none', () => {
    // The account is drawn at the moment the link is spent, and nothing has
    // been spent. An identifier here would have to be invented.
    expect(has(screen({ known: byLink }), 'invited-who')).toBe(false)
    for (const line of said(screen({ known: byLink }))) {
      expect(line).not.toContain('@')
    }
  })

  it('says the link declares nobody, when it declares nobody', () => {
    // A different absence from the threshold's, and it is said differently:
    // there, the conversation does not say who created it. Here, the person
    // who wrote the link chose not to give themselves a name.
    const drawn = screen({ known: { ...byLink, declared: '' } })
    expect(said(drawn)).toEqual([
      t('invited_title'),
      t('invited_who_undeclared'),
      t('invited_instance %@', 'messagr.eu'),
      t('invited_terms_link'),
      t('invited_nothing_spent'),
      t('invited_join'),
      t('invited_refuse'),
    ])
    expect(said(drawn)).not.toContain(t('invited_who_unknown'))
  })

  it('does not claim a link was never opened here, because one was', () => {
    // `invited_terms_unknown` says « aucun lien n'a été ouvert ici », which
    // is exactly false on this path. The fact is the same -- validity and
    // remaining uses are answered only to the account that issued them --
    // and the sentence that carries it is not.
    expect(said(screen({ known: byLink }))).not.toContain(
      t('invited_terms_unknown'),
    )
  })

  it('says the link is not spent, which is the stronger statement', () => {
    expect(said(screen({ known: byLink }))).toContain(
      t('invited_nothing_spent'),
    )
    expect(said(screen({ known: byLink }))).not.toContain(
      t('invited_nothing_sent'),
    )
  })

  it('marks an instance that is not this account’s, here too', () => {
    expect(
      said(
        screen({
          known: { ...byLink, instance: 'other.example', elsewhere: true },
        }),
      ),
    ).toContain(t('invited_instance_elsewhere %@', 'other.example'))
  })

  it('keeps both actions, and waits under a label while a claim runs', () => {
    // A claim is two calls with the issuer's application in between, which
    // can take half a minute. The screen stays and says so.
    const drawn = screen({ known: byLink, working: 'join' })
    expect(find(drawn, 'invited-join')?.props.disabled).toBe(true)
    expect(find(drawn, 'invited-refuse')?.props.disabled).toBe(true)
    expect(said(drawn)).toContain(t('invited_working'))
  })
})
