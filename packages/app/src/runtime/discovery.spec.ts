import { describe, expect, it } from 'vitest'

import {
  codeIsSpent,
  proofJourney,
  readDiscovery,
  whereTheNumberGoes,
  type DiscoveryReading,
  type DiscoveryService,
  type OpenCountry,
  type ProofStage,
} from './discovery'

/**
 * The discovery module, as far as proving one's number (#397), driven through
 * doubles that record every request: the seam #392 agreed for the
 * application. What the service answers is written here as the service
 * writes it (`services/invitations/src/handlers/discovery.rs`), and what the
 * screens are told is read back from the stages the journey shows.
 */

type Route = 'state' | 'startProof' | 'finishProof'

interface Answer {
  readonly status: number
  readonly body: string
}

const COUNTRIES: readonly OpenCountry[] = [
  { code: 'FR', prefix: '33', provider: 'OVHcloud' },
  { code: 'GB', prefix: '44', provider: 'OVHcloud' },
  { code: 'CH', prefix: '41', provider: 'OVHcloud' },
]

const NOW = 1_790_000_000_000

/** The service, reduced to what it answers and what it was asked. */
function theService(answers: Partial<Record<Route, (Answer | Error)[]>>) {
  const asked: { route: Route; body?: unknown }[] = []
  const answer = async (route: Route, body?: string): Promise<Answer> => {
    asked.push(
      body === undefined ? { route } : { route, body: JSON.parse(body) },
    )
    const next = answers[route]?.shift()
    if (next === undefined) throw new Error(`nothing to answer ${route}`)
    if (next instanceof Error) throw next
    return next
  }
  const service: DiscoveryService = {
    state: () => answer('state'),
    startProof: body => answer('startProof', body),
    finishProof: body => answer('finishProof', body),
  }
  return { service, asked }
}

const ok = (body: unknown): Answer => ({
  status: 200,
  body: JSON.stringify(body),
})

const refused = (
  status: number,
  errcode: string,
  more: object = {},
): Answer => ({
  status,
  body: JSON.stringify({ errcode, error: 'said by the service', ...more }),
})

const NOT_FINDABLE: DiscoveryReading = {
  read: true,
  on: true,
  findableUntil: null,
  countries: COUNTRIES,
}

function journeyWith(answers: Partial<Record<Route, (Answer | Error)[]>>) {
  const { service, asked } = theService(answers)
  const shown: ProofStage[] = []
  const journey = proofJourney(
    { service, now: () => NOW, language: () => 'fr' },
    stage => shown.push(stage),
  )
  const last = () => shown[shown.length - 1]
  return { journey, asked, shown, last }
}

describe('reading the state of discovery', () => {
  it('says whether it is served, whether this account is findable, and where', async () => {
    const { service, asked } = theService({
      state: [
        ok({
          on: true,
          findable_until: 1_792_419_200,
          countries: [{ code: 'FR', prefix: '33', provider: 'OVHcloud' }],
        }),
      ],
    })

    const reading = await readDiscovery({ service, now: () => NOW })

    expect(asked).toEqual([{ route: 'state' }])
    expect(reading).toEqual({
      read: true,
      on: true,
      findableUntil: 1_792_419_200_000,
      countries: [{ code: 'FR', prefix: '33', provider: 'OVHcloud' }],
    })
  })

  it('is no reading at all when the service cannot be read', async () => {
    for (const answer of [
      new Error('offline'),
      refused(401, 'M_UNAUTHORIZED'),
      { status: 200, body: 'not json' },
      ok({ on: 'yes', findable_until: null, countries: [] }),
    ]) {
      const { service } = theService({ state: [answer] })
      expect(await readDiscovery({ service, now: () => NOW })).toEqual({
        read: false,
      })
    }
  })
})

describe('where a number goes, said before anything is sent', () => {
  it('names the open country and its provider, whatever the separators', () => {
    for (const typed of [
      '+33612345678',
      '+33 6 12 34 56 78',
      '0033 6.12.34.56.78',
      '+33 (0)6-12-34-56-78',
      '+33 06 12 34 56 78',
    ]) {
      expect(whereTheNumberGoes(typed, COUNTRIES)).toEqual({
        verdict: 'open',
        number: '+33612345678',
        country: COUNTRIES[0],
        complete: true,
      })
    }
  })

  it('says a country is not open as soon as its calling code is known', () => {
    expect(whereTheNumberGoes('+39 312', COUNTRIES)).toEqual({
      verdict: 'closed',
    })
    expect(whereTheNumberGoes('+1 202 555 0123', COUNTRIES)).toEqual({
      verdict: 'closed',
    })
  })

  it('waits while the calling code could still be an open one', () => {
    expect(whereTheNumberGoes('+4', COUNTRIES)).toEqual({
      verdict: 'incomplete',
    })
    expect(whereTheNumberGoes('', COUNTRIES)).toEqual({ verdict: 'incomplete' })
  })

  it('is open but not complete until the number is long enough', () => {
    expect(whereTheNumberGoes('+33 6 12', COUNTRIES)).toMatchObject({
      verdict: 'open',
      complete: false,
    })
  })

  it('asks for the calling code rather than guessing one', () => {
    expect(whereTheNumberGoes('06 12 34 56 78', COUNTRIES)).toEqual({
      verdict: 'no-country-code',
    })
  })

  it('refuses what cannot be a number', () => {
    expect(whereTheNumberGoes('+33 6 12 34 56 7a', COUNTRIES)).toEqual({
      verdict: 'not-a-number',
    })
    expect(whereTheNumberGoes('+0612345678', COUNTRIES)).toEqual({
      verdict: 'not-a-number',
    })
  })
})

describe('the journey of a proof', () => {
  it('« Pas maintenant » sends nothing and goes back to Settings', () => {
    const { journey, asked, shown } = journeyWith({})

    journey.open(NOT_FINDABLE)
    journey.close()

    expect(shown.map(s => s.stage)).toEqual(['consent', 'shut'])
    expect(asked).toEqual([])
  })

  it('goes consent, number, code, proven, in that order', async () => {
    const { journey, asked, shown, last } = journeyWith({
      startProof: [ok({ provider: 'OVHcloud', expires_in: 600 })],
      finishProof: [ok({ findable_until: 1_792_419_200 })],
    })

    journey.open(NOT_FINDABLE)
    journey.consent()
    expect(asked).toEqual([])

    await journey.send('+33 6 12 34 56 78')
    expect(asked).toEqual([
      {
        route: 'startProof',
        body: { number: '+33612345678', language: 'fr' },
      },
    ])
    expect(last()).toEqual({
      stage: 'code',
      number: '+33612345678',
      refused: null,
    })

    await journey.prove(' 123456 ')
    expect(asked[1]).toEqual({ route: 'finishProof', body: { code: '123456' } })
    expect(last()).toEqual({
      stage: 'proven',
      findableUntil: 1_792_419_200_000,
    })
    expect(shown.map(s => s.stage)).toEqual([
      'consent',
      'number',
      'sending',
      'code',
      'proving',
      'proven',
    ])
  })

  it('opens on the proof, not the consent, for an account already findable', () => {
    const { journey, asked, last } = journeyWith({})

    journey.open({ ...NOT_FINDABLE, findableUntil: 1_792_419_200_000 })

    expect(last()).toEqual({
      stage: 'proven',
      findableUntil: 1_792_419_200_000,
    })
    expect(asked).toEqual([])
  })

  it('asks for the calling code of a number typed without one, without asking the service', async () => {
    const { journey, asked, last } = journeyWith({})
    journey.open(NOT_FINDABLE)
    journey.consent()

    await journey.send('06 12 34 56 78')

    expect(asked).toEqual([])
    expect(last()).toMatchObject({
      stage: 'number',
      refused: 'no-country-code',
    })
  })

  it('refuses a number of a country not open without asking the service', async () => {
    const { journey, asked, last } = journeyWith({})
    journey.open(NOT_FINDABLE)
    journey.consent()

    await journey.send('+39 312 345 6789')

    expect(asked).toEqual([])
    expect(last()).toMatchObject({ stage: 'number', refused: 'closed' })
  })

  it('says a wrong code leaves attempts, and asks for another code after the last', async () => {
    const { journey, last } = journeyWith({
      startProof: [ok({ provider: 'OVHcloud', expires_in: 600 })],
      finishProof: [
        refused(400, 'MESSAGR_CODE_WRONG', { attempts_left: 4 }),
        refused(400, 'MESSAGR_CODE_WRONG', { attempts_left: 0 }),
      ],
    })
    journey.open(NOT_FINDABLE)
    journey.consent()
    await journey.send('+33612345678')

    await journey.prove('000000')
    expect(last()).toMatchObject({
      stage: 'code',
      refused: { why: 'wrong', attemptsLeft: 4 },
    })
    await journey.prove('000000')
    expect(last()).toMatchObject({
      stage: 'code',
      refused: { why: 'wrong', attemptsLeft: 0 },
    })
  })

  it('goes back to the number, kept, for another code', async () => {
    const { journey, asked, last } = journeyWith({
      startProof: [ok({ provider: 'OVHcloud', expires_in: 600 })],
      finishProof: [refused(410, 'MESSAGR_CODE_EXPIRED')],
    })
    journey.open(NOT_FINDABLE)
    journey.consent()
    await journey.send('+33612345678')
    await journey.prove('123456')
    expect(last()).toMatchObject({ stage: 'code', refused: { why: 'expired' } })

    journey.another()

    expect(last()).toEqual({
      stage: 'number',
      countries: COUNTRIES,
      number: '+33612345678',
      refused: null,
    })
    expect(asked).toHaveLength(2)
  })

  it('says why no code was sent, and stays on the number', async () => {
    for (const [answer, why] of [
      [refused(503, 'MESSAGR_SMS_NOT_SENT'), 'not-sent'],
      [refused(503, 'MESSAGR_DISCOVERY_OFF'), 'off'],
      [refused(422, 'MESSAGR_COUNTRY_CLOSED'), 'closed'],
      [new Error('offline'), 'unreachable'],
    ] as const) {
      const { journey, last } = journeyWith({ startProof: [answer] })
      journey.open(NOT_FINDABLE)
      journey.consent()
      await journey.send('+33612345678')
      expect(last()).toEqual({
        stage: 'number',
        countries: COUNTRIES,
        number: '+33612345678',
        refused: why,
      })
    }
  })

  it('gives back the number as it was typed when no code was sent, so the screen can say why', async () => {
    const { journey, last } = journeyWith({
      startProof: [refused(503, 'MESSAGR_SMS_NOT_SENT')],
    })
    journey.open(NOT_FINDABLE)
    journey.consent()

    await journey.send('+33 6 12 34 56 78')

    expect(last()).toMatchObject({
      stage: 'number',
      number: '+33 6 12 34 56 78',
      refused: 'not-sent',
    })
  })

  it('drops an answer that arrives after the journey was closed', async () => {
    let answer: (a: Answer) => void = () => undefined
    const shown: ProofStage[] = []
    const journey = proofJourney(
      {
        service: {
          state: () => Promise.reject(new Error('not asked')),
          startProof: () => new Promise(resolve => (answer = resolve)),
          finishProof: () => Promise.reject(new Error('not asked')),
        },
        now: () => NOW,
        language: () => 'fr',
      },
      stage => shown.push(stage),
    )
    journey.open(NOT_FINDABLE)
    journey.consent()

    const sending = journey.send('+33612345678')
    journey.close()
    answer(ok({ provider: 'OVHcloud', expires_in: 600 }))
    await sending

    expect(shown[shown.length - 1]).toEqual({ stage: 'shut' })
  })

  it('does not send twice while a code is on its way', async () => {
    const { journey, asked } = journeyWith({
      startProof: [ok({ provider: 'OVHcloud', expires_in: 600 })],
    })
    journey.open(NOT_FINDABLE)
    journey.consent()

    await Promise.all([
      journey.send('+33612345678'),
      journey.send('+33612345678'),
    ])

    expect(asked).toHaveLength(1)
  })
})

describe('a code that can prove nothing more', () => {
  it('is one whose last attempt is spent, or that ran out, or whose proof is gone', () => {
    expect(codeIsSpent(null)).toBe(false)
    expect(codeIsSpent({ why: 'wrong', attemptsLeft: 1 })).toBe(false)
    expect(codeIsSpent({ why: 'wrong', attemptsLeft: 0 })).toBe(true)
    expect(codeIsSpent({ why: 'expired' })).toBe(true)
    expect(codeIsSpent({ why: 'no-proof' })).toBe(true)
    // The service did not answer: the same code may still prove the number.
    expect(codeIsSpent({ why: 'unreachable' })).toBe(false)
  })
})
