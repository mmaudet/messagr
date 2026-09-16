import { createElement, Fragment, isValidElement, type ReactNode } from 'react'
import * as ReactNamespace from 'react'
import { describe, expect, it, vi } from 'vitest'

import { t } from '../copy'
import type { BackupStanding } from '../runtime/backupStanding'
import { BackupSettings } from './BackupSettings'

/**
 * The Sauvegarde screen, drawn without a device.
 *
 * Walked rather than rendered, for the reason `CallScreen.spec.ts` gives at
 * length: nothing in this workspace renders React Native off a device, and
 * what a screen hands the platform is observable without one. Every component
 * is a function, so each is called with its props, and what is left at the
 * bottom -- a `View`, a `Pressable` -- is what the device would receive.
 *
 * Drawn once, so the hooks are what they are on a first render: this screen
 * holds no state of its own any more, which is itself a decision recorded in
 * the component.
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

// THE GLOBAL THIS WORKSPACE'S JSX COMPILES AGAINST. The React Native
// TypeScript config asks for the classic transform, so a `.tsx` becomes
// `React.createElement(...)` reading a free `React` -- and `NotchedButton`,
// which this screen draws four of, does not import it: on a device Babel's
// automatic runtime supplies it, and here nothing does. The mocked module,
// so a button drawn through it holds the same hooks as everything else.
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

/** What the device receives under `testID`, or nothing. */
function hostOf(drawn: readonly Drawn[], testID: string): Drawn | undefined {
  for (const node of everything(drawn)) {
    if (typeof node.type === 'string' && node.props.testID === testID) {
      return node
    }
  }
  return undefined
}

/** Every sentence the screen put on the device, in the order it drew them. */
function sentences(drawn: readonly Drawn[]): string[] {
  const said: string[] = []
  for (const node of everything(drawn)) {
    if (node.type !== 'Text') continue
    const child = node.props.children
    if (typeof child === 'string') said.push(child)
  }
  return said
}

/**
 * Every action's label, in the order the screen drew them.
 *
 * `accessibilityLabel` is what `NotchedButton` puts on the control it hands
 * the device, so this is the actions and not the back arrow, which is a
 * `Pressable` this screen draws itself.
 */
function buttons(drawn: readonly Drawn[]): string[] {
  const labels: string[] = []
  for (const node of everything(drawn)) {
    if (node.type !== 'Pressable') continue
    const label = node.props.accessibilityLabel
    if (typeof label === 'string') labels.push(label)
  }
  return labels
}

const nothing = () => undefined

function screen(
  standing: BackupStanding,
  over: Partial<Parameters<typeof BackupSettings>[0]> = {},
): Drawn[] {
  return draw(
    createElement(BackupSettings, {
      standing,
      onBack: nothing,
      onRetry: nothing,
      onEnable: nothing,
      onReplace: nothing,
      onRestore: nothing,
      confirming: false,
      onConfirming: nothing,
      failed: false,
      working: null,
      replaceFailedAt: null,
      ...over,
    }),
  )
}

describe('the five states of Réglages › Sauvegarde (#323)', () => {
  it('says the messages are backed up only when the account holds this device’s version', () => {
    const drawn = screen({ standing: 'sending', backedUp: 13, total: 13 })

    expect(sentences(drawn)).toContain(t('backup_settings_on'))
    // The count, with the provenance the porter validated: it is what left
    // THIS device, and it never claimed to be the server's again.
    expect(sentences(drawn)).toContain(t('backup_settings_count %1$d', 13))
    expect(buttons(drawn)).toEqual([t('backup_settings_replace')])
  })

  it('says another backup replaced this one, and offers the two ways out', () => {
    const drawn = screen({ standing: 'superseded' })

    expect(sentences(drawn)).toContain(t('backup_settings_superseded'))
    // Never « sauvegardés » here: the bridge says enabled and the homeserver
    // refuses every upload, which is the state #323 was raised for.
    expect(sentences(drawn)).not.toContain(t('backup_settings_on'))
    expect(buttons(drawn)).toEqual([
      t('backup_settings_enter_current'),
      t('backup_settings_new'),
    ])
  })

  it('says a backup exists that this device does not feed', () => {
    const drawn = screen({ standing: 'dormant' })

    expect(sentences(drawn)).toContain(t('backup_settings_dormant'))
    // Not « vos messages ne sont pas sauvegardés » either: there is one, and
    // the key opens it.
    expect(sentences(drawn)).not.toContain(t('backup_settings_off'))
    expect(buttons(drawn)).toEqual([
      t('backup_settings_enter_key'),
      t('backup_settings_new'),
    ])
  })

  it('says there is no backup, and offers to make one', () => {
    const drawn = screen({ standing: 'none' })

    expect(sentences(drawn)).toContain(t('backup_settings_off'))
    expect(buttons(drawn)).toEqual([t('backup_settings_enable')])
  })

  it('says the server did not answer, that nothing changed here, and offers to ask again', () => {
    const drawn = screen({ standing: 'unchecked' })

    expect(hostOf(drawn, 'backup-settings-unchecked')).toBeDefined()
    expect(sentences(drawn)).toContain(t('backup_settings_unchecked'))
    expect(sentences(drawn)).toContain(t('backup_settings_unchecked_why'))
    expect(buttons(drawn)).toEqual([t('backup_settings_retry')])
  })

  it('keeps the device’s own failure apart from the server’s', () => {
    // Two sentences that must not be rounded to one: this one is about the
    // telephone, and it sends somebody looking somewhere else.
    const drawn = screen({ standing: 'unreadable' })

    expect(sentences(drawn)).toContain(t('backup_settings_unreadable'))
    expect(sentences(drawn)).not.toContain(t('backup_settings_unchecked'))
    expect(hostOf(drawn, 'backup-settings-retry')).toBeDefined()
  })

  it('draws the screen, and only a waiting line, before anything has answered', () => {
    const drawn = screen({ standing: 'waiting' })

    expect(hostOf(drawn, 'backup-settings')).toBeDefined()
    expect(sentences(drawn)).toContain(t('backup_settings_reading'))
    expect(buttons(drawn)).toEqual([])
  })
})

describe('what the actions on this screen lead to', () => {
  it('takes « Créer une nouvelle sauvegarde » through the consequences of a replacement', () => {
    // The porter's own note on #323: it is the replacement's screen, which
    // already exists. Making a new backup retires the one on the account, so
    // the key somebody may be holding stops opening anything -- that is
    // named before it is done, from every state that offers it.
    for (const standing of ['superseded', 'dormant'] as const) {
      const drawn = screen({ standing }, { confirming: true })

      expect(hostOf(drawn, 'backup-replace-consequences')).toBeDefined()
      expect(buttons(drawn)).toContain(t('backup_replace_confirm'))
    }
  })

  it('says where a replacement stopped, above every state it can land in', () => {
    // #284: the reading taken after a failure lands in any branch, so the
    // sentence is above them all. It has to be said from the two states this
    // screen gained as well, because a replacement can be started from them.
    for (const standing of [
      { standing: 'sending', backedUp: 0, total: 0 } as const,
      { standing: 'superseded' } as const,
      { standing: 'dormant' } as const,
    ]) {
      const drawn = screen(standing, { replaceFailedAt: 'publishing' })

      expect(hostOf(drawn, 'backup-settings-replace-failed')).toBeDefined()
      expect(sentences(drawn)).toContain(t('backup_replace_failed'))
    }
  })

  it('holds every button inert while a gesture on the backup runs', () => {
    // #284, and it now has to hold in the two states this screen gained: a
    // second replacement publishes a second version from here just as well.
    for (const standing of [
      { standing: 'superseded' } as const,
      { standing: 'dormant' } as const,
      { standing: 'none' } as const,
    ]) {
      const drawn = screen(standing, { working: 'accept' })
      const live = [...everything(drawn)].filter(
        node =>
          node.type === 'Pressable' &&
          typeof node.props.testID === 'string' &&
          node.props.testID.startsWith('backup-settings-') &&
          node.props.testID !== 'backup-settings-back' &&
          node.props.disabled !== true,
      )

      expect(live).toEqual([])
    }
  })
})
