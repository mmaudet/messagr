import { describe, expect, it } from 'vitest'

import {
  codeIsSpent,
  listNotice,
  proofJourney,
  readDiscovery,
  readingAfter,
  whereTheNumberGoes,
  type DiscoveryReading,
  type DiscoveryService,
  type OpenCountry,
  type ProofStage,
} from './discovery'
import type { KeyPair } from './hpke'
import { base64Of } from './receiveImage'

/**
 * The discovery module, as far as proving one's number (#397), driven through
 * doubles that record every request: the seam #392 agreed for the
 * application. What the service answers is written here as the service
 * writes it (`services/invitations/src/handlers/discovery.rs`), and what the
 * screens are told is read back from the stages the journey shows.
 */

type Route = 'state' | 'startProof' | 'finishProof' | 'withdraw'

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
    withdraw: () => answer('withdraw'),
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

const NOT_FINDABLE: Extract<DiscoveryReading, { read: true }> = {
  read: true,
  on: true,
  findableUntil: null,
  ended: null,
  countries: COUNTRIES,
}

const DAY = 86_400_000

/** The envelope key pair every proof in these tests publishes (#405). */
const PAIR: KeyPair = {
  secretKey: new Uint8Array(32).fill(1),
  publicKey: new Uint8Array(32).fill(7),
}

/**
 * An envelope keyring that hands out `PAIR`, or nothing when its keystore
 * refuses, and records the proofs said to have held.
 */
function envelopeKeys(refuses = false) {
  const keptPairs: KeyPair[] = []
  return {
    envelope: {
      toPublish: async () => (refuses ? null : PAIR),
      published: async (pair: KeyPair) => {
        keptPairs.push(pair)
      },
    },
    keptPairs,
  }
}

function journeyWith(
  answers: Partial<Record<Route, (Answer | Error)[]>>,
  keystoreRefuses = false,
) {
  const { service, asked } = theService(answers)
  const shown: ProofStage[] = []
  const kept: (string | null)[] = []
  const forgotten: true[] = []
  const { envelope, keptPairs } = envelopeKeys(keystoreRefuses)
  const journey = proofJourney(
    {
      service,
      now: () => NOW,
      language: () => 'fr',
      envelope,
      keepNumber: async number => {
        kept.push(number)
      },
      forgetWhatWasFound: async () => {
        forgotten.push(true)
      },
    },
    stage => shown.push(stage),
  )
  const last = () => shown[shown.length - 1]
  return { journey, asked, shown, last, kept, keptPairs, forgotten }
}

describe('reading the state of discovery', () => {
  it('says whether it is served, whether this account is findable, and where', async () => {
    const { service, asked } = theService({
      state: [
        ok({
          on: true,
          findable_until: 1_792_419_200,
          ended: null,
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
      ended: null,
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

    journey.open(NOT_FINDABLE, null)
    journey.close()

    expect(shown.map(s => s.stage)).toEqual(['consent', 'shut'])
    expect(asked).toEqual([])
  })

  it('goes consent, number, code, proven, in that order', async () => {
    const { journey, asked, shown, last, keptPairs } = journeyWith({
      startProof: [ok({ provider: 'OVHcloud', expires_in: 600 })],
      finishProof: [ok({ findable_until: 1_792_419_200 })],
    })

    journey.open(NOT_FINDABLE, null)
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
    // WITH THE CODE, AN ENVELOPE KEY (#405), and the proof said to have held
    // with it.
    expect(asked[1]).toEqual({
      route: 'finishProof',
      body: { code: '123456', envelope_key: base64Of(PAIR.publicKey) },
    })
    expect(keptPairs).toEqual([PAIR])
    expect(last()).toEqual({
      stage: 'proven',
      findableUntil: 1_792_419_200_000,
      number: '+33612345678',
      refused: null,
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

    journey.open(
      { ...NOT_FINDABLE, findableUntil: 1_792_419_200_000 },
      '+33612345678',
    )

    expect(last()).toEqual({
      stage: 'proven',
      findableUntil: 1_792_419_200_000,
      number: '+33612345678',
      refused: null,
    })
    expect(asked).toEqual([])
  })

  it('asks for the calling code of a number typed without one, without asking the service', async () => {
    const { journey, asked, last } = journeyWith({})
    journey.open(NOT_FINDABLE, null)
    journey.consent()

    await journey.send('06 12 34 56 78')

    expect(asked).toEqual([])
    expect(last()).toMatchObject({
      stage: 'number',
      refused: { why: 'no-country-code' },
    })
  })

  it('refuses a number of a country not open without asking the service', async () => {
    const { journey, asked, last } = journeyWith({})
    journey.open(NOT_FINDABLE, null)
    journey.consent()

    await journey.send('+39 312 345 6789')

    expect(asked).toEqual([])
    expect(last()).toMatchObject({
      stage: 'number',
      refused: { why: 'closed' },
    })
  })

  it('says a wrong code leaves attempts, and asks for another code after the last', async () => {
    const { journey, last, keptPairs } = journeyWith({
      startProof: [ok({ provider: 'OVHcloud', expires_in: 600 })],
      finishProof: [
        refused(400, 'MESSAGR_CODE_WRONG', { attempts_left: 4 }),
        refused(400, 'MESSAGR_CODE_WRONG', { attempts_left: 0 }),
      ],
    })
    journey.open(NOT_FINDABLE, null)
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
    // A REFUSED CODE PUBLISHES NO KEY: the one the directory lists stays
    // the one this device opens names with (#405).
    expect(keptPairs).toEqual([])
  })

  it('sends no envelope key when the keystore will not keep one (#405)', async () => {
    const { journey, asked, last } = journeyWith(
      {
        startProof: [ok({ provider: 'OVHcloud', expires_in: 600 })],
        finishProof: [ok({ findable_until: 1_792_419_200 })],
      },
      true,
    )
    journey.open(NOT_FINDABLE, null)
    journey.consent()
    await journey.send('+33612345678')

    await journey.prove('123456')

    expect(asked[1]).toEqual({ route: 'finishProof', body: { code: '123456' } })
    expect(last()).toMatchObject({ stage: 'proven' })
  })

  it('says the proof held to the keyring even when the journey was closed meanwhile (#405)', async () => {
    let answer: ((a: Answer) => void) | null = null
    const { envelope, keptPairs } = envelopeKeys()
    const journey = proofJourney(
      {
        service: {
          state: () => Promise.reject(new Error('not asked')),
          startProof: async () => ok({ provider: 'OVHcloud', expires_in: 600 }),
          finishProof: () =>
            new Promise(resolve => {
              answer = resolve
            }),
          withdraw: () => Promise.reject(new Error('not asked')),
        },
        now: () => NOW,
        language: () => 'fr',
        envelope,
        keepNumber: async () => undefined,
        forgetWhatWasFound: async () => undefined,
      },
      () => undefined,
    )
    journey.open(NOT_FINDABLE, null)
    journey.consent()
    await journey.send('+33612345678')

    const proving = journey.prove('123456')
    // Closed while the code is with the service, then the service answers.
    while (answer === null) await Promise.resolve()
    journey.close()
    ;(answer as (a: Answer) => void)(ok({ findable_until: 1_792_419_200 }))
    await proving

    expect(keptPairs).toEqual([PAIR])
  })

  it('goes back to the number, kept, for another code', async () => {
    const { journey, asked, last } = journeyWith({
      startProof: [ok({ provider: 'OVHcloud', expires_in: 600 })],
      finishProof: [refused(410, 'MESSAGR_CODE_EXPIRED')],
    })
    journey.open(NOT_FINDABLE, null)
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
      [refused(503, 'MESSAGR_SMS_NOT_SENT'), { why: 'not-sent' }],
      [refused(503, 'MESSAGR_DISCOVERY_OFF'), { why: 'off' }],
      [refused(422, 'MESSAGR_COUNTRY_CLOSED'), { why: 'closed' }],
      [refused(503, 'MESSAGR_SMS_LATER'), { why: 'later' }],
      [
        refused(429, 'MESSAGR_TOO_MANY_CODES', { retry_at: 1_790_086_400 }),
        { why: 'too-many', retryAt: 1_790_086_400_000 },
      ],
      [new Error('offline'), { why: 'unreachable' }],
    ] as const) {
      const { journey, last } = journeyWith({ startProof: [answer] })
      journey.open(NOT_FINDABLE, null)
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
    journey.open(NOT_FINDABLE, null)
    journey.consent()

    await journey.send('+33 6 12 34 56 78')

    expect(last()).toMatchObject({
      stage: 'number',
      number: '+33 6 12 34 56 78',
      refused: { why: 'not-sent' },
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
          withdraw: () => Promise.reject(new Error('not asked')),
        },
        now: () => NOW,
        language: () => 'fr',
        envelope: envelopeKeys().envelope,
        keepNumber: async () => undefined,
        forgetWhatWasFound: async () => undefined,
      },
      stage => shown.push(stage),
    )
    journey.open(NOT_FINDABLE, null)
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
    journey.open(NOT_FINDABLE, null)
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

describe('keeping the proof, or ending it (#398)', () => {
  const FINDABLE = { ...NOT_FINDABLE, findableUntil: NOW + 10 * DAY }

  it('keeps the proven number on the telephone, to show it and renew it', async () => {
    const { journey, kept } = journeyWith({
      startProof: [ok({ provider: 'OVHcloud', expires_in: 600 })],
      finishProof: [ok({ findable_until: 1_792_419_200 })],
    })
    journey.open(NOT_FINDABLE, null)
    journey.consent()
    await journey.send('+33 6 12 34 56 78')
    await journey.prove('123456')

    expect(kept).toEqual(['+33612345678'])
  })

  it('renews without the consent or the number screen: the SMS goes to the number kept', async () => {
    const { journey, asked, shown } = journeyWith({
      startProof: [ok({ provider: 'OVHcloud', expires_in: 600 })],
    })

    await journey.renew(FINDABLE, '+33612345678')

    expect(shown.map(s => s.stage)).toEqual(['sending', 'code'])
    expect(asked).toEqual([
      {
        route: 'startProof',
        body: { number: '+33612345678', language: 'fr' },
      },
    ])
  })

  it('asks for the number when none was kept', async () => {
    const { journey, asked, last } = journeyWith({})
    await journey.renew(FINDABLE, null)
    expect(last()).toMatchObject({ stage: 'consent' })
    expect(asked).toEqual([])
  })

  it('withdraws the number at once, and forgets it on the telephone', async () => {
    const { journey, asked, shown, kept, forgotten } = journeyWith({
      withdraw: [{ status: 204, body: '' }],
    })
    journey.open(FINDABLE, '+33612345678')

    await journey.withdraw()

    expect(asked).toEqual([{ route: 'withdraw' }])
    expect(shown.map(s => s.stage)).toEqual([
      'proven',
      'withdrawing',
      'withdrawn',
    ])
    expect(kept).toEqual([null])
    // AND WHAT LOOKS FOUND, CARD NAMES INCLUDED (#407): no look can run
    // without a proof to forget it later.
    expect(forgotten).toEqual([true])
  })

  it('drops a withdrawal that ends after the journey was closed', async () => {
    let answer: (a: Answer) => void = () => undefined
    const shown: ProofStage[] = []
    const journey = proofJourney(
      {
        service: {
          state: () => Promise.reject(new Error('not asked')),
          startProof: () => Promise.reject(new Error('not asked')),
          finishProof: () => Promise.reject(new Error('not asked')),
          withdraw: () => new Promise(resolve => (answer = resolve)),
        },
        now: () => NOW,
        language: () => 'fr',
        envelope: envelopeKeys().envelope,
        keepNumber: async () => undefined,
        forgetWhatWasFound: async () => undefined,
      },
      stage => shown.push(stage),
    )
    journey.open(
      { ...NOT_FINDABLE, findableUntil: NOW + 10 * DAY },
      '+33612345678',
    )

    const withdrawing = journey.withdraw()
    journey.close()
    answer({ status: 204, body: '' })
    await withdrawing

    expect(shown[shown.length - 1]).toEqual({ stage: 'shut' })
  })

  it('keeps the proof on screen, and says so, when the withdrawal did not go through', async () => {
    const { journey, last, kept } = journeyWith({
      withdraw: [new Error('offline')],
    })
    journey.open(FINDABLE, '+33612345678')

    await journey.withdraw()

    expect(last()).toEqual({
      stage: 'proven',
      findableUntil: NOW + 10 * DAY,
      number: '+33612345678',
      refused: 'unreachable',
    })
    expect(kept).toEqual([])
  })
})

describe('the sentence above the list (#398)', () => {
  const at = (reading: Partial<typeof NOT_FINDABLE>) =>
    listNotice({ ...NOT_FINDABLE, ...reading }, NOW)

  it('proposes renewing from the 21st day of 28, and not before, with the day it ends', () => {
    expect(at({ findableUntil: NOW + 7 * DAY + 1 })).toBe(null)
    expect(at({ findableUntil: NOW + 7 * DAY })).toEqual({
      notice: 'renew',
      until: NOW + 7 * DAY,
    })
    expect(at({ findableUntil: NOW + 1 })).toEqual({
      notice: 'renew',
      until: NOW + 1,
    })
  })

  it('says a proof ran out once its day has passed, even before the service is read again', () => {
    expect(at({ findableUntil: NOW })).toEqual({ notice: 'expired' })
    expect(at({ ended: 'expired' })).toEqual({ notice: 'expired' })
  })

  it('says a number now makes another account findable', () => {
    expect(at({ ended: 'replaced' })).toEqual({ notice: 'replaced' })
  })

  it('says nothing of a number withdrawn, nor when discovery is off or unread', () => {
    expect(at({ ended: 'withdrawn' })).toBe(null)
    expect(at({ on: false, ended: 'expired' })).toBe(null)
    expect(listNotice({ read: false }, NOW)).toBe(null)
  })
})

describe('what a stage of the journey changes in the reading (#398)', () => {
  it('writes a proof just made, and forgets how an earlier one ended', () => {
    const after = readingAfter(
      { ...NOT_FINDABLE, ended: 'replaced' },
      {
        stage: 'proven',
        findableUntil: NOW + 28 * DAY,
        number: null,
        refused: null,
      },
    )
    expect(after).toMatchObject({ findableUntil: NOW + 28 * DAY, ended: null })
  })

  it('writes a number just withdrawn', () => {
    const after = readingAfter(
      { ...NOT_FINDABLE, findableUntil: NOW + DAY },
      { stage: 'withdrawn' },
    )
    expect(after).toMatchObject({ findableUntil: null, ended: 'withdrawn' })
  })

  it('leaves the reading alone for every other stage, and an unread reading unread', () => {
    expect(readingAfter(NOT_FINDABLE, { stage: 'consent' })).toBe(NOT_FINDABLE)
    expect(readingAfter({ read: false }, { stage: 'withdrawn' })).toEqual({
      read: false,
    })
  })
})
