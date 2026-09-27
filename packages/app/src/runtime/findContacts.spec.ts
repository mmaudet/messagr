import { describe, expect, it } from 'vitest'

import { whereTheNumberGoes } from './discovery'
import {
  findContacts,
  findContactsEntry,
  findingJourney,
  regionOf,
  type Blinding,
  type Contact,
  type FindingDeps,
  type FindingStage,
  type Masking,
} from './findContacts'

/**
 * Looking for one's contacts (#400), driven through doubles that record every
 * request: the address book, the masking, and the service, as #392 agreed for
 * the application.
 *
 * The masking double is not the OPRF, and needs not be: what the tests check
 * is what the module sends and what it concludes. So blinding here wraps each
 * input in a marker that says « blinded », the service's evaluation appends
 * its key, and unblinding removes the marker. A mask is then a function of
 * the number and the key only, as the real one is, and the directory the
 * service lists is built with the same function from the proven numbers.
 */

const KEY = 7
const PUBLIC_KEY = 'cHVibGlj'

const bytes = (text: string) => Uint8Array.from(text, c => c.charCodeAt(0))
const text = (b: Uint8Array) => String.fromCharCode(...b)
const b64 = (b: Uint8Array) => btoa(text(b))
const unb64 = (s: string) => bytes(atob(s))

/** What the service holds as the mask of `number` under the key. */
const maskOf = (number: string) => b64(bytes(`mask(${number})#${KEY}`))

function theMasking(verifies = true) {
  const calls: { finalized: number; blinded: string[] } = {
    finalized: 0,
    blinded: [],
  }
  const masking: Masking = {
    blind: async inputs => {
      const blindedElements = inputs.map(input =>
        bytes(`blinded(${text(input)})`),
      )
      calls.blinded.push(...blindedElements.map(b64))
      return { blindedElements }
    },
    finalize: async (blinding: Blinding, evaluated, _proof, publicKey) => {
      calls.finalized += 1
      if (!verifies || b64(publicKey) !== PUBLIC_KEY) {
        return 'not-the-published-key'
      }
      expect(evaluated).toHaveLength(blinding.blindedElements.length)
      return evaluated.map(e =>
        bytes(text(e).replace(/^evaluated\(blinded\((.*)\)\)/, 'mask($1)')),
      )
    },
  }
  return { masking, calls }
}

interface Asked {
  readonly route: 'keys' | 'maskBatch' | 'directory'
  readonly body?: { key_number: number; blinded: string[] }
}

/** The service: its keys, its evaluation, and a directory of these numbers. */
function theService(proven: Record<string, string>, refuse?: number) {
  const asked: Asked[] = []
  const service = {
    keys: async () => {
      asked.push({ route: 'keys' })
      return {
        status: 200,
        body: JSON.stringify({
          keys: [{ key_number: KEY, public_key: PUBLIC_KEY }],
        }),
      }
    },
    maskBatch: async (body: string) => {
      const request = JSON.parse(body) as Asked['body'] & object
      asked.push({ route: 'maskBatch', body: request })
      if (refuse !== undefined) {
        return {
          status: refuse,
          body: JSON.stringify({ errcode: 'MESSAGR_NOT_FINDABLE' }),
        }
      }
      return {
        status: 200,
        body: JSON.stringify({
          key_number: request.key_number,
          evaluated: request.blinded.map(e =>
            b64(bytes(`evaluated(${text(unb64(e))})#${request.key_number}`)),
          ),
          batch_proof: b64(bytes('proof')),
        }),
      }
    },
    directory: async () => {
      asked.push({ route: 'directory' })
      return {
        status: 200,
        body: JSON.stringify({
          entries: Object.entries(proven).map(([number, reference]) => ({
            key_number: KEY,
            mask: maskOf(number),
            reference,
          })),
        }),
      }
    },
  }
  return { service, asked }
}

function deps(
  contacts: readonly Contact[],
  proven: Record<string, string>,
  options: { verifies?: boolean; refuse?: number } = {},
) {
  const { masking, calls } = theMasking(options.verifies)
  const { service, asked } = theService(proven, options.refuse)
  const all: FindingDeps = {
    readAddressBook: async () => contacts,
    masking,
    service,
    region: () => 'FR',
  }
  return { deps: all, asked, calls }
}

const PAUL: Contact = { name: 'Paul', numbers: ['06 12 34 56 78'] }
const ANNE: Contact = { name: 'Anne', numbers: ['+44 7911 123456'] }
const ZOE: Contact = { name: 'Zoé', numbers: ['+33 6 98 76 54 32'] }

describe('looking for contacts', () => {
  it('shows the contacts found under the name of their card, then the others', async () => {
    const { deps: d } = deps([ZOE, PAUL, ANNE], {
      '+33612345678': 'ref-paul',
      '+447911123456': 'ref-anne',
    })

    const found = await findContacts(d)

    expect(found).toEqual({
      found: true,
      matches: [
        { contact: ANNE, reference: 'ref-anne' },
        { contact: PAUL, reference: 'ref-paul' },
      ],
      others: [ZOE],
    })
  })

  it("writes a number in international form with the telephone's region, merges duplicates, and ignores what is not a number", async () => {
    const { deps: d, asked } = deps(
      [
        { name: 'Paul', numbers: ['06 12 34 56 78', '+33612345678'] },
        {
          name: 'Paul bureau',
          numbers: ['0033 6 12 34 56 78', 'pas un numéro'],
        },
        { name: 'Vide', numbers: ['12'] },
      ],
      {},
    )

    await findContacts(d)

    const sent = asked
      .filter(a => a.route === 'maskBatch')
      .flatMap(a => a.body!.blinded.map(e => text(unb64(e))))
    expect(sent).toEqual(['blinded(+33612345678)'])
  })

  it('sends the blinded elements and nothing else: no number, no name', async () => {
    const { deps: d, asked, calls } = deps([PAUL, ANNE, ZOE], {})

    await findContacts(d)

    const sent = asked.flatMap(a => a.body?.blinded ?? [])
    expect(sent).toEqual(calls.blinded)
    const everything = [
      JSON.stringify(asked),
      ...sent.map(e => text(unb64(e))),
    ].join('\n')
    for (const secret of ['Paul', 'Anne', 'Zoé']) {
      expect(everything).not.toContain(secret)
    }
    // What the double blinded is the number itself, so the check above is
    // what stands between a number and the service: every element sent is
    // one the masking made.
    expect(sent.every(e => text(unb64(e)).startsWith('blinded('))).toBe(true)
  })

  it('sends the same requests for an address book that finds somebody and one that finds nobody', async () => {
    const proven = { '+33612345678': 'ref-paul' }
    const findsPaul = deps([PAUL, ZOE], proven)
    const findsNobody = deps([ANNE, ZOE], proven)

    const one = await findContacts(findsPaul.deps)
    const none = await findContacts(findsNobody.deps)

    expect(one.found && one.matches).toHaveLength(1)
    expect(none.found && none.matches).toHaveLength(0)
    const shape = (asked: Asked[]) =>
      asked.map(a =>
        a.body
          ? `${a.route}:${a.body.key_number}:${a.body.blinded.length}`
          : a.route,
      )
    expect(shape(findsPaul.asked)).toEqual(shape(findsNobody.asked))
    expect(shape(findsPaul.asked)).toEqual([
      'keys',
      `maskBatch:${KEY}:2`,
      'directory',
    ])
  })

  it('writes each number of an open country as the proof writes it, or the masks would never meet', async () => {
    // National and international forms of a number of each of eight open
    // countries: what `whereTheNumberGoes` sends for a number typed on the
    // proof screen, and what the address book's number becomes here.
    const written: readonly [string, string, string][] = [
      ['FR', '06 12 34 56 78', '+33 6 12 34 56 78'],
      ['DE', '0151 23456789', '+49 151 23456789'],
      ['ES', '612 34 56 78', '+34 612 34 56 78'],
      ['GB', '07911 123456', '+44 7911 123456'],
      ['CH', '078 123 45 67', '+41 78 123 45 67'],
      ['NL', '06 12345678', '+31 6 12345678'],
      ['BE', '0470 12 34 56', '+32 470 12 34 56'],
      ['AT', '0664 1234567', '+43 664 1234567'],
    ]
    const countries = written.map(([code, , international]) => ({
      code,
      prefix: international.slice(1).split(' ')[0]!,
      provider: 'OVHcloud',
    }))
    for (const [region, national, international] of written) {
      const proved = whereTheNumberGoes(international, countries)
      expect(proved.verdict, international).toBe('open')
      const { deps: d, asked } = deps(
        [{ name: 'Carte', numbers: [national] }],
        {},
      )
      await findContacts({ ...d, region: () => region })
      const sent = asked
        .filter(a => a.route === 'maskBatch')
        .flatMap(a => a.body!.blinded.map(e => text(unb64(e))))
      expect(sent, national).toEqual([
        `blinded(${proved.verdict === 'open' ? proved.number : ''})`,
      ])
    }
  })

  it('stops at an answer that did not come from the published key, and says so', async () => {
    const { deps: d, asked } = deps(
      [PAUL],
      { '+33612345678': 'ref-paul' },
      {
        verifies: false,
      },
    )

    const found = await findContacts(d)

    expect(found).toEqual({ found: false, refusal: 'not-the-published-key' })
    expect(asked.map(a => a.route)).not.toContain('directory')
  })

  it('tells an account that is not findable to prove its number first', async () => {
    const { deps: d } = deps([PAUL], {}, { refuse: 403 })

    expect(await findContacts(d)).toEqual({
      found: false,
      refusal: 'not-findable',
    })
  })

  it('masks five thousand numbers a request at most', async () => {
    const many: Contact[] = Array.from({ length: 5_001 }, (_, i) => ({
      name: `Fiche ${i}`,
      numbers: [`+336${10_000_000 + i}`],
    }))
    const { deps: d, asked } = deps(many, {})

    await findContacts(d)

    expect(
      asked
        .filter(a => a.route === 'maskBatch')
        .map(a => a.body!.blinded.length),
    ).toEqual([5_000, 1])
  })

  it('asks nothing of the service for an address book without a number', async () => {
    const { deps: d, asked } = deps([{ name: 'Sans numéro', numbers: [] }], {})

    expect(await findContacts(d)).toEqual({
      found: true,
      matches: [],
      others: [{ name: 'Sans numéro', numbers: [] }],
    })
    expect(asked).toEqual([])
  })
})

describe('the journey of looking for contacts', () => {
  function journey(
    access: 'all' | 'some' | 'none',
    contacts: readonly Contact[],
    proven: Record<string, string>,
  ) {
    const { deps: d, asked } = deps(contacts, proven)
    const shown: FindingStage[] = []
    const asks = { system: 0 }
    const j = findingJourney(
      {
        ...d,
        askForTheAddressBook: async () => {
          asks.system += 1
          return access
        },
      },
      stage => shown.push(stage),
    )
    return { j, shown, asked, asks }
  }

  it('opens on a reminder, and asks the system nothing before « Continuer »', () => {
    const { j, shown, asks } = journey('all', [PAUL], {})

    j.open()

    expect(shown).toEqual([{ stage: 'reminder' }])
    expect(asks.system).toBe(0)
  })

  it('asks the system, looks, and shows what it found', async () => {
    const { j, shown } = journey('all', [PAUL, ZOE], {
      '+33612345678': 'ref-paul',
    })

    j.open()
    await j.go()

    expect(shown.map(s => s.stage)).toEqual(['reminder', 'looking', 'found'])
    expect(shown.at(-1)).toEqual({
      stage: 'found',
      matches: [{ contact: PAUL, reference: 'ref-paul' }],
      others: [ZOE],
    })
  })

  it('looks at the cards the person shared when the system shares some', async () => {
    const { j, shown } = journey('some', [PAUL], { '+33612345678': 'ref-paul' })

    j.open()
    await j.go()

    expect(shown.at(-1)?.stage).toBe('found')
  })

  it('reads nothing and sends nothing when the system refuses', async () => {
    const { j, shown, asked } = journey('none', [PAUL], {})

    j.open()
    await j.go()

    expect(shown.at(-1)).toEqual({ stage: 'refused', why: 'no-access' })
    expect(asked).toEqual([])
  })

  it('says why nothing was found when looking stopped', async () => {
    const { deps: d } = deps([PAUL], {}, { verifies: false })
    const shown: FindingStage[] = []
    const j = findingJourney(
      { ...d, askForTheAddressBook: async () => 'all' },
      stage => shown.push(stage),
    )

    j.open()
    await j.go()

    expect(shown.at(-1)).toEqual({
      stage: 'refused',
      why: 'not-the-published-key',
    })
  })

  it('drops what ends after its screen was left', async () => {
    const { j, shown } = journey('all', [PAUL], {})

    j.open()
    const going = j.go()
    j.close()
    await going

    expect(shown.at(-1)).toEqual({ stage: 'shut' })
  })
})

describe("the telephone's region", () => {
  it('is the region of its locale, in either shape a platform writes it', () => {
    expect(regionOf('fr-FR')).toBe('FR')
    expect(regionOf('de_CH')).toBe('CH')
    expect(regionOf('en-gb')).toBe('GB')
    expect(regionOf('zh-Hant-TW')).toBe('TW')
  })

  it('is nothing when the locale names none: no calling code is guessed', () => {
    expect(regionOf('fr')).toBeUndefined()
    expect(regionOf('')).toBeUndefined()
  })

  it('leaves a national number aside when there is no region', async () => {
    const { deps: d, asked } = deps(
      [{ name: 'Paul', numbers: ['06 12 34 56 78', '+33 6 98 76 54 32'] }],
      {},
    )

    await findContacts({ ...d, region: () => undefined })

    expect(
      asked
        .filter(a => a.route === 'maskBatch')
        .flatMap(a => a.body!.blinded.map(e => text(unb64(e)))),
    ).toEqual(['blinded(+33698765432)'])
  })
})

describe('the journey, pressed twice or refused by the system', () => {
  it('masks the address book once for two presses on « Continuer »', async () => {
    const { deps: d, asked } = deps([PAUL, ZOE], {})
    const shown: FindingStage[] = []
    const j = findingJourney(
      { ...d, askForTheAddressBook: async () => 'all' },
      stage => shown.push(stage),
    )

    j.open()
    await Promise.all([j.go(), j.go()])

    expect(asked.filter(a => a.route === 'maskBatch')).toHaveLength(1)
    expect(shown.at(-1)?.stage).toBe('found')
  })

  it('reads a question the system could not ask as a refusal', async () => {
    const { deps: d, asked } = deps([PAUL], {})
    const shown: FindingStage[] = []
    const j = findingJourney(
      {
        ...d,
        askForTheAddressBook: async () => {
          throw new Error('no activity')
        },
      },
      stage => shown.push(stage),
    )

    j.open()
    await j.go()

    expect(shown.at(-1)).toEqual({ stage: 'refused', why: 'no-access' })
    expect(asked).toEqual([])
  })
})

describe('where « Retrouver mes contacts » leads', () => {
  const NOW = 1_790_000_000_000
  const reading = (on: boolean, findableUntil: number | null) =>
    ({
      read: true,
      on,
      findableUntil,
      ended: null,
      countries: [],
    }) as const

  it('nowhere while this service does not serve discovery', () => {
    expect(findContactsEntry({ read: false }, NOW)).toBe('hidden')
    expect(findContactsEntry(reading(false, NOW + 1), NOW)).toBe('hidden')
  })

  it('to the consent and the proof for an account that is not findable', () => {
    expect(findContactsEntry(reading(true, null), NOW)).toBe('prove-first')
    expect(findContactsEntry(reading(true, NOW), NOW)).toBe('prove-first')
  })

  it('to the reminder for a findable account', () => {
    expect(findContactsEntry(reading(true, NOW + 1), NOW)).toBe('look')
  })
})
