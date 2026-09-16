import { createElement, Fragment, isValidElement, type ReactNode } from 'react'
import * as ReactNamespace from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { t } from '../copy'
import { PasteLink } from './PasteLink'

/**
 * The field somebody pastes an invitation link into, walked rather than
 * rendered, for the reason `BackupOffer.spec.ts` gives: nothing in this
 * workspace renders React Native off a device, and what a screen hands the
 * platform is observable without one.
 *
 * # THE DRAFT IS STOOD IN RATHER THAN TYPED
 *
 * This screen holds exactly one piece of state -- what is in the field -- and
 * the walk below calls the component as a function, outside any renderer. So
 * `useState` is stood in with a value this file sets, which is the same thing
 * a person typing would have produced, and the setter records rather than
 * re-renders.
 */

let typed = ''
const changed: unknown[] = []

vi.mock('react', async importOriginal => ({
  ...(await importOriginal<typeof import('react')>()),
  useEffect: () => undefined,
  useRef: (current: unknown) => ({ current }),
  useState: (initial: unknown) => [
    // The draft, and only the draft: `NotchedButton` holds a size, whose
    // initial value is `null` and which this must not stand in for.
    typeof initial === 'string' ? typed : initial,
    (next: unknown) => {
      changed.push(next)
    },
  ],
}))

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
    const label = node.props.label
    if (typeof label === 'string') said.push(label)
  }
  return said
}

const handed: string[] = []

function field(over: Partial<Parameters<typeof PasteLink>[0]> = {}): Drawn[] {
  return draw(
    createElement(PasteLink, {
      onPaste: (raw: string) => {
        handed.push(raw)
      },
      ...over,
    }),
  )
}

beforeEach(() => {
  typed = ''
  changed.length = 0
  handed.length = 0
})

describe('somewhere to paste an invitation link (#367)', () => {
  it('draws a field and an action', () => {
    const drawn = field()

    expect(withId(drawn, 'paste-link')).toBeDefined()
    expect(withId(drawn, 'paste-link-field')).toBeDefined()
    expect(withId(drawn, 'paste-link-confirm')).toBeDefined()
  })

  it('says what a copied link costs, where it offers to take one', () => {
    // #367 s reserve: an invitation token is a bearer credential, a clipboard
    // is readable by every other application on the telephone, and the link
    // is good for one hour and one use. Said here because here is where the
    // product asks somebody to put one on their clipboard.
    expect(words(field())).toContain(t('list_paste_cost'))
  })

  it('hands over what was pasted, whole, and reads nothing itself', () => {
    // The field hands the string over and decides nothing: what an invitation
    // is is `invitationLink.ts` s to say, and it is said in one place.
    typed = '  https://messagr.eu/i/abc123?utm_source=whatsapp  '
    const drawn = field()

    const press = withId(drawn, 'paste-link-confirm')?.props.onPress
    ;(press as () => void)()

    expect(handed).toEqual([
      '  https://messagr.eu/i/abc123?utm_source=whatsapp  ',
    ])
  })

  it('keeps what is typed into it, and keeps nothing else', () => {
    // The one piece of state this screen holds. Nothing here reaches the
    // clipboard, at either end: the person puts the link in the field.
    const drawn = field()

    const change = withId(drawn, 'paste-link-field')?.props.onChangeText
    ;(change as (next: string) => void)('https://messagr.eu/i/abc123')

    expect(changed).toEqual(['https://messagr.eu/i/abc123'])
  })

  it('hands over on the return key as well as on the action', () => {
    typed = 'https://messagr.eu/i/abc123'
    const drawn = field()

    const submit = withId(drawn, 'paste-link-field')?.props.onSubmitEditing
    ;(submit as () => void)()

    expect(handed).toEqual(['https://messagr.eu/i/abc123'])
  })

  it('hands nothing over from an empty field', () => {
    typed = '   '
    const drawn = field()

    const press = withId(drawn, 'paste-link-confirm')?.props.onPress
    ;(press as () => void)()

    expect(handed).toEqual([])
  })

  it('hands nothing over a second time while the first is being spent', () => {
    // A single-use token, and two claims of it would refuse the second.
    typed = 'https://messagr.eu/i/abc123'
    const drawn = field({ said: 'working' })

    const press = withId(drawn, 'paste-link-confirm')?.props.onPress
    ;(press as () => void)()

    expect(handed).toEqual([])
  })

  it('says it is working while the link is being spent', () => {
    expect(words(field({ said: 'working' }))).toContain(t('list_paste_working'))
  })

  it('leaves the platform none of its helpfulness on the field', () => {
    // A token s case is significant and a keyboard that capitalises the first
    // letter of a pasted link produces one that opens nothing, with nothing
    // on screen to say why. The same reasoning as `RecoveryKeyEntry.tsx`.
    const drawn = field()
    const props = withId(drawn, 'paste-link-field')?.props

    expect(props?.autoCapitalize).toBe('none')
    expect(props?.autoCorrect).toBe(false)
    expect(props?.spellCheck).toBe(false)
  })

  it('does not open the keyboard by itself', () => {
    // The ordinary way in is the link, touched. This field is the way out
    // when that fails, and a keyboard that springs up over the sentence
    // explaining the ordinary way makes the fallback look like the path.
    expect(withId(field(), 'paste-link-field')?.props.autoFocus).toBeFalsy()
  })
})

describe('the three refusals, each in its own words', () => {
  it('says an address that is not an invitation is not one, and that nothing was spent', () => {
    const drawn = field({ said: 'not-a-link' })

    expect(withId(drawn, 'paste-link-not-a-link')).toBeDefined()
    expect(words(drawn)).toContain(t('list_paste_not_a_link'))
  })

  it('sends somebody whose link the service refused to ask for a new one', () => {
    // Unknown, spent, revoked and expired are one answer from the service and
    // one sentence here: `claimInvitation.ts` says why it refuses to tell
    // them apart, and a screen that guessed would rebuild that oracle.
    const drawn = field({ said: 'refused' })

    expect(withId(drawn, 'paste-link-refused')).toBeDefined()
    expect(words(drawn)).toContain(t('list_paste_refused'))
  })

  it('tells somebody whose claim may go through next time to try again', () => {
    const drawn = field({ said: 'retry' })

    expect(withId(drawn, 'paste-link-retry')).toBeDefined()
    expect(words(drawn)).toContain(t('list_paste_retry'))
  })

  it('says none of them before anything has been pasted', () => {
    const drawn = field()

    expect(withId(drawn, 'paste-link-not-a-link')).toBeUndefined()
    expect(withId(drawn, 'paste-link-refused')).toBeUndefined()
    expect(withId(drawn, 'paste-link-retry')).toBeUndefined()
  })
})
