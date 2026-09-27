import { createElement, Fragment, isValidElement, type ReactNode } from 'react'
import * as ReactNamespace from 'react'
import { describe, expect, it, vi } from 'vitest'

import { t } from '../copy'
import { Invite, type InviteStage } from './Invite'
import { dayOf, timeOf } from './whenLabel'

/**
 * The invitation form, walked rather than rendered, for the reason
 * `BackupOffer.spec.ts` gives: what #404 adds to it, a contact found.
 */

vi.mock('react', async importOriginal => ({
  ...(await importOriginal<typeof import('react')>()),
  useEffect: () => undefined,
  useRef: (current: unknown) => ({ current }),
  useState: (initial: unknown) => [initial, () => undefined],
}))

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  Share: { share: async () => undefined },
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

function show(stage: InviteStage, onInvite = vi.fn()) {
  return draw(
    createElement(Invite, {
      stage,
      onInvite,
      onClose: () => undefined,
      admission: null,
    }),
  )
}

const PAUL = {
  name: 'Paul Martin',
  reference: 'ref-paul',
  envelopeKey: 'key-of-paul',
}
/** A contact whose device published no envelope key (#405). */
const ZOE = { name: 'Zoé', reference: 'ref-zoe', envelopeKey: null }

describe('inviting a contact found (#404)', () => {
  it('opens « Qui invitez-vous ? » with the name of the card', () => {
    const drawn = show({ stage: 'resting', to: PAUL })

    expect(withId(drawn, 'invite-name')?.props.value).toBe('Paul Martin')
  })

  it('asks how one presents oneself, a name that travels sealed (#405)', () => {
    const forContact = show({ stage: 'resting', to: PAUL })
    const forLink = show({ stage: 'resting' })

    expect(withId(forContact, 'invite-declared')).toBeDefined()
    expect(textIn(withId(forContact, 'invite-declared-hint'))).toBe(
      t('invite_declared_sealed_hint'),
    )
    expect(textIn(withId(forLink, 'invite-declared-hint'))).toBe(
      t('invite_declared_hint'),
    )
    expect(withId(forLink, 'invite-name')?.props.value).toBe('')
  })

  it('asks for no declared name for a contact whose device has nothing to seal it for', () => {
    const drawn = show({ stage: 'resting', to: ZOE })

    expect(withId(drawn, 'invite-declared')).toBeUndefined()
    expect(withId(drawn, 'invite-declared-hint')).toBeUndefined()
  })

  it('hands the name typed over, and the declared name, empty every time', () => {
    const onInvite = vi.fn()
    const drawn = show({ stage: 'resting', to: PAUL }, onInvite)

    expect(withId(drawn, 'invite-declared')?.props.value).toBe('')
    ;(withId(drawn, 'invite')?.props.onPress as () => void)()

    expect(onInvite).toHaveBeenCalledWith('Paul Martin', null)
  })

  it('says the invitation waits in Messagr until its deadline, and the conversation in the list', () => {
    const expiresAt = new Date(2026, 9, 4, 12).getTime()

    const named = show({ stage: 'sent', name: 'Paul', expiresAt })
    const unnamed = show({ stage: 'sent', name: null, expiresAt })

    expect(textIn(withId(named, 'invite-sent'))).toBe(
      t('invite_sent %1$@ %2$@', 'Paul', dayOf(expiresAt)),
    )
    expect(textIn(withId(unnamed, 'invite-sent'))).toBe(
      t('invite_sent_unnamed %1$@', dayOf(expiresAt)),
    )
    expect(withId(named, 'invite-link')).toBeUndefined()
    expect(withId(named, 'invite-close')).toBeDefined()
  })

  it('says, in a sentence of its own, why the service would not take it', () => {
    for (const [refusal, key] of [
      ['own-reference', 'invite_refused_own'],
      ['unknown-reference', 'invite_refused_gone'],
      ['not-findable', 'invite_refused_not_findable'],
      ['pending', 'invite_refused_pending'],
    ] as const) {
      const drawn = show({ stage: 'failed', reason: 'refused', refusal })
      expect(textIn(withId(drawn, 'invite-failed'))).toBe(t(key))
    }
    expect(
      textIn(
        withId(show({ stage: 'failed', reason: 'down' }), 'invite-failed'),
      ),
    ).toBe(t('invite_failed'))
  })

  it('says until when a limit holds, on the day and at the hour of the telephone (#406)', () => {
    const retryAt = new Date(2026, 9, 12, 2, 0).getTime()

    for (const [why, key] of [
      ['recently', 'invite_refused_recently %1$@ %2$@'],
      ['quota', 'invite_refused_quota %1$@ %2$@'],
    ] as const) {
      const drawn = show({
        stage: 'failed',
        reason: 'refused',
        refusal: { why, retryAt },
      })
      expect(textIn(withId(drawn, 'invite-failed'))).toBe(
        t(key, dayOf(retryAt), timeOf(retryAt)),
      )
    }
  })
})
