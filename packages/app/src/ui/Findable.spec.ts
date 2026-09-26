import { createElement, Fragment, isValidElement, type ReactNode } from 'react'
import * as ReactNamespace from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { t } from '../copy'
import type {
  OpenCountry,
  ProofStage,
  StartRefusal,
} from '../runtime/discovery'
import { Findable } from './Findable'
import { dayOf, timeOf } from './whenLabel'

/**
 * « Être trouvable », walked rather than rendered, for the reason
 * `BackupOffer.spec.ts` gives. What was typed in a field is stood in, as
 * `PasteLink.spec.ts` does: `typed` is what the field holds.
 */

let typed = ''

vi.mock('react', async importOriginal => ({
  ...(await importOriginal<typeof import('react')>()),
  useEffect: () => undefined,
  useRef: (current: unknown) => ({ current }),
  useState: (initial: unknown) => [
    typeof initial === 'string' ? typed : initial,
    () => undefined,
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

const COUNTRIES: readonly OpenCountry[] = [
  { code: 'FR', prefix: '33', provider: 'OVHcloud' },
]

const said = {
  continued: 0,
  closed: 0,
  sent: [] as string[],
  proved: [] as string[],
  another: 0,
  renewed: 0,
  withdrawn: 0,
}

const NOW = new Date(2026, 9, 1, 12).getTime()
const DAY = 86_400_000

function show(stage: Exclude<ProofStage, { readonly stage: 'shut' }>) {
  return draw(
    createElement(Findable, {
      stage,
      now: NOW,
      onContinue: () => (said.continued += 1),
      onClose: () => (said.closed += 1),
      onSend: typedNumber => said.sent.push(typedNumber),
      onProve: code => said.proved.push(code),
      onAnother: () => (said.another += 1),
      onRenew: () => (said.renewed += 1),
      onWithdraw: () => (said.withdrawn += 1),
    }),
  )
}

beforeEach(() => {
  typed = ''
  said.continued = 0
  said.closed = 0
  said.sent = []
  said.proved = []
  said.another = 0
  said.renewed = 0
  said.withdrawn = 0
})

describe('the consent', () => {
  it('says the five points of #392, in their order', () => {
    const drawn = show({ stage: 'consent' })
    const points = [...everything(drawn)]
      .map(node => node.props.testID)
      .filter(
        (id): id is string => typeof id === 'string' && id.endsWith('_title'),
      )
    expect(points).toEqual([
      'findable-findable_contacts_title',
      'findable-findable_number_point_title',
      'findable-findable_others_title',
      'findable-findable_change_title',
      'findable-findable_withdraw_title',
    ])
    expect(textIn(withId(drawn, 'findable-findable_number_point_title'))).toBe(
      t('findable_number_point_title') + t('findable_number_point'),
    )
  })

  it('offers « Continuer » and « Pas maintenant » with the same weight', () => {
    const drawn = show({ stage: 'consent' })
    const go = withId(drawn, 'findable-continue')
    const notNow = withId(drawn, 'findable-not-now')

    expect(go?.props.label).toBe(t('findable_continue'))
    expect(notNow?.props.label).toBe(t('findable_not_now'))
    expect([go?.props.tone, go?.props.wide]).toEqual([
      notNow?.props.tone,
      notNow?.props.wide,
    ])
  })

  it('goes back to Settings on « Pas maintenant », and does nothing else', () => {
    const notNow = withId(show({ stage: 'consent' }), 'findable-not-now')
    ;(notNow?.props.onPress as () => void)()

    expect(said).toMatchObject({ closed: 1, continued: 0, sent: [] })
  })
})

describe('the number', () => {
  const number = (refused: StartRefusal | null = null) =>
    show({ stage: 'number', countries: COUNTRIES, number: typed, refused })

  it('names who will send the SMS before anything is sent', () => {
    typed = '+33 6 12 34 56 78'
    const drawn = number()

    expect(textIn(withId(drawn, 'findable-number-provider'))).toBe(
      t('findable_number_provider %@', 'OVHcloud'),
    )
    const send = withId(drawn, 'findable-send')
    expect(send?.props.disabled).toBe(false)
    ;(send?.props.onPress as () => void)()
    expect(said.sent).toEqual(['+33 6 12 34 56 78'])
  })

  it('says a country is not open yet, with the sentence of #392, and sends nothing', () => {
    typed = '+39 312 345 6789'
    const drawn = number()

    expect(textIn(withId(drawn, 'findable-number-refused'))).toBe(
      t('findable_number_closed'),
    )
    const send = withId(drawn, 'findable-send')
    expect(send?.props.disabled).toBe(true)
    ;(send?.props.onPress as () => void)()
    expect(said.sent).toEqual([])
  })

  it('asks for the calling code of a number typed without one', () => {
    typed = '06 12 34 56 78'
    expect(textIn(withId(number(), 'findable-number-refused'))).toBe(
      t('findable_number_country_code'),
    )
  })

  it('says why the service sent no code', () => {
    typed = '+33612345678'
    expect(
      textIn(withId(number({ why: 'not-sent' }), 'findable-number-refused')),
    ).toBe(t('findable_not_sent'))
    expect(
      textIn(withId(number({ why: 'later' }), 'findable-number-refused')),
    ).toBe(t('findable_later'))
  })

  it('says when this account may ask for a code again (#399)', () => {
    typed = '+33612345678'
    const at = new Date(2026, 8, 27, 14, 5).getTime()
    expect(
      textIn(
        withId(
          number({ why: 'too-many', retryAt: at }),
          'findable-number-refused',
        ),
      ),
    ).toBe(t('findable_too_many %1$@ %2$@', dayOf(at), timeOf(at)))
    expect(timeOf(at)).toBe(t('when_time %1$d %2$d', 14, '05'))
  })

  it('is a telephone number field, and nothing is asked of the SMS', () => {
    typed = ''
    const field = withId(number(), 'findable-number-field')
    expect(field?.props).toMatchObject({
      keyboardType: 'phone-pad',
      autoComplete: 'tel',
      textContentType: 'telephoneNumber',
    })
  })
})

describe('the code', () => {
  const code = (
    refused: Extract<ProofStage, { stage: 'code' }>['refused'] = null,
  ) => show({ stage: 'code', number: '+33612345678', refused })

  it('declares its field a one-time code on both platforms', () => {
    const field = withId(code(), 'findable-code-field')
    expect(field?.props).toMatchObject({
      autoComplete: 'one-time-code',
      textContentType: 'oneTimeCode',
      keyboardType: 'number-pad',
      maxLength: 6,
    })
  })

  it('says where the code went, and proves with six digits', () => {
    typed = '123456'
    const drawn = code()

    expect(textIn(withId(drawn, 'findable-code'))).toContain('+33612345678')
    const prove = withId(drawn, 'findable-prove')
    expect(prove?.props.disabled).toBe(false)
    ;(prove?.props.onPress as () => void)()
    expect(said.proved).toEqual(['123456'])
  })

  it('says how many attempts a wrong code leaves', () => {
    typed = '000000'
    const drawn = code({ why: 'wrong', attemptsLeft: 3 })
    expect(textIn(withId(drawn, 'findable-code-refused'))).toBe(
      t('findable_code_wrong %d', 3),
    )
    expect(withId(drawn, 'findable-prove')?.props.disabled).toBe(false)
  })

  it('asks for another code once the last attempt is spent, or the code has run out', () => {
    typed = '000000'
    for (const refused of [
      { why: 'wrong', attemptsLeft: 0 },
      { why: 'expired' },
    ] as const) {
      const drawn = code(refused)
      expect(withId(drawn, 'findable-prove')?.props.disabled).toBe(true)
      ;(withId(drawn, 'findable-another')?.props.onPress as () => void)()
    }
    expect(said.another).toBe(2)
  })
})

describe('the proof', () => {
  it('reads « Numéro prouvé », and until when', () => {
    const until = new Date(2026, 9, 24, 12).getTime()
    const drawn = show({
      stage: 'proven',
      findableUntil: until,
      number: null,
      refused: null,
    })

    expect(textIn(withId(drawn, 'findable-proven'))).toContain(
      t('findable_proven_title'),
    )
    expect(textIn(withId(drawn, 'findable-proven-until'))).toBe(
      t('findable_proven_until %@', dayOf(until)),
    )
    expect(dayOf(until)).toBe('24 octobre 2026')
  })
})

describe('keeping the proof, or ending it (#398)', () => {
  const proven = (
    over: Partial<Extract<ProofStage, { stage: 'proven' }>> = {},
  ) =>
    show({
      stage: 'proven',
      findableUntil: NOW + 20 * DAY,
      number: '+33612345678',
      refused: null,
      ...over,
    })

  it('shows the number kept, and offers to renew the proof or withdraw the number', () => {
    const drawn = proven()
    expect(textIn(withId(drawn, 'findable-proven-number'))).toBe('+33612345678')
    ;(withId(drawn, 'findable-renew')?.props.onPress as () => void)()
    ;(withId(drawn, 'findable-withdraw')?.props.onPress as () => void)()
    expect(said).toMatchObject({ renewed: 1, withdrawn: 1 })
    expect(withId(drawn, 'findable-renew')?.props.label).toBe(
      t('findable_renew'),
    )
    expect(withId(drawn, 'findable-withdraw')?.props.label).toBe(
      t('findable_withdraw_number'),
    )
  })

  it('says the proof is to renew from its 21st day', () => {
    const until = NOW + 7 * DAY
    expect(
      textIn(withId(proven({ findableUntil: until }), 'findable-proven-until')),
    ).toBe(t('findable_proven_renew %@', dayOf(until)))
    expect(
      textIn(
        withId(proven({ findableUntil: until + 1 }), 'findable-proven-until'),
      ),
    ).toBe(t('findable_proven_until %@', dayOf(until + 1)))
  })

  it('says when withdrawing the number did not go through', () => {
    expect(
      textIn(
        withId(proven({ refused: 'unreachable' }), 'findable-withdraw-refused'),
      ),
    ).toBe(t('findable_unreachable'))
  })

  it('offers nothing to press while the number is being withdrawn', () => {
    const drawn = show({
      stage: 'withdrawing',
      findableUntil: NOW + 20 * DAY,
      number: '+33612345678',
    })
    expect(withId(drawn, 'findable-withdrawing')).toBeDefined()
    expect(withId(drawn, 'findable-renew')).toBeUndefined()
    expect(withId(drawn, 'findable-withdraw')).toBeUndefined()
  })

  it('says the number is withdrawn, and goes back to Settings', () => {
    const drawn = show({ stage: 'withdrawn' })
    expect(textIn(withId(drawn, 'findable-withdrawn'))).toContain(
      t('findable_withdrawn'),
    )
    ;(withId(drawn, 'findable-done')?.props.onPress as () => void)()
    expect(said.closed).toBe(1)
  })
})
