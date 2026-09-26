import { describe, expect, it } from 'vitest'

import { whereTheNumberGoes } from './discovery'
import {
  findContacts,
  findContactsEntry,
  findingJourney,
  regionOf,
  type Blinding,
  type Contact,
  type DiscoveryResults,
  type FindingDeps,
  type FindingStage,
  type Masking,
  type Remembered,
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

/** When the limit of #401 frees, as the service says it: in seconds. */
const FREES_AT = 1_792_592_000

/** The service: its keys, its evaluation, and a directory of these numbers. */
function theService(
  proven: Record<string, string>,
  refuse?: number,
  limit = Infinity,
) {
  const asked: Asked[] = []
  let left = limit
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
      if (request.blinded.length > left) {
        return {
          status: 429,
          body: JSON.stringify({
            errcode: 'MESSAGR_MASKING_QUOTA',
            remaining: left,
            frees_at: FREES_AT,
          }),
        }
      }
      left -= request.blinded.length
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

/** A row of the page (#402): a number, and what it led to under a key. */
type Row = readonly [keyNumber: number, number: string, remembered: Remembered]

/**
 * The page of the notebook (#402), as a map by key and number: what the
 * store keeps, where it keeps it by a fingerprint instead.
 */
function thePage(rows: readonly Row[] = []) {
  const page = new Map(rows.map(([k, n, r]) => [`${k}/${n}`, r] as const))
  const results: DiscoveryResults = {
    recall: async (keyNumber, numbers) =>
      new Map(
        numbers.flatMap(number => {
          const kept = page.get(`${keyNumber}/${number}`)
          return kept === undefined ? [] : [[number, kept] as const]
        }),
      ),
    keep: async (keyNumber, kept) => {
      for (const [number, one] of kept) page.set(`${keyNumber}/${number}`, one)
      return true
    },
    forgetAllBut: async numbers => {
      for (const id of [...page.keys()]) {
        if (!numbers.includes(id.slice(id.indexOf('/') + 1))) page.delete(id)
      }
      return true
    },
  }
  return { results, page }
}

function deps(
  contacts: readonly Contact[],
  proven: Record<string, string>,
  options: {
    verifies?: boolean
    refuse?: number
    limit?: number
    rows?: readonly Row[]
  } = {},
) {
  const { masking, calls } = theMasking(options.verifies)
  const { service, asked } = theService(proven, options.refuse, options.limit)
  const { results, page } = thePage(options.rows)
  const all: FindingDeps = {
    readAddressBook: async () => contacts,
    masking,
    service,
    region: () => 'FR',
    results,
  }
  return { deps: all, asked, calls, page }
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
        { contact: ANNE, reference: 'ref-anne', holderChanged: false },
        { contact: PAUL, reference: 'ref-paul', holderChanged: false },
      ],
      others: [ZOE],
      waiting: null,
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
      waiting: null,
    })
    expect(asked).toEqual([])
  })
})

describe('the journey of looking for contacts', () => {
  /**
   * The journey over an address book the system's choice can grow: the cards
   * in `added` are shared when the person asks to share more (#403).
   */
  function journey(
    access: 'all' | 'some' | 'none',
    contacts: readonly Contact[],
    proven: Record<string, string>,
    added: readonly Contact[] = [],
  ) {
    const book = [...contacts]
    const { deps: d, asked } = deps(book, proven)
    const shown: FindingStage[] = []
    const asks = { system: 0, choice: 0 }
    const j = findingJourney(
      {
        ...d,
        askForTheAddressBook: async () => {
          asks.system += 1
          return access
        },
        shareMoreCards: async () => {
          asks.choice += 1
          book.push(...added)
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
      matches: [{ contact: PAUL, reference: 'ref-paul', holderChanged: false }],
      others: [ZOE],
      waiting: null,
      limited: false,
    })
  })

  it('looks at the cards the person shared when the system shares some, and says so', async () => {
    const { j, shown } = journey('some', [PAUL], { '+33612345678': 'ref-paul' })

    j.open()
    await j.go()

    expect(shown.at(-1)).toMatchObject({ stage: 'found', limited: true })
  })

  it('opens the system choice from a limited access, then looks at the cards added', async () => {
    const { j, shown, asks } = journey(
      'some',
      [PAUL],
      { '+33698765432': 'ref-zoe' },
      [ZOE],
    )
    j.open()
    await j.go()

    await j.shareMore()

    expect(asks.choice).toBe(1)
    expect(shown.slice(-2).map(s => s.stage)).toEqual(['looking', 'found'])
    expect(shown.at(-1)).toMatchObject({
      stage: 'found',
      matches: [{ contact: ZOE, reference: 'ref-zoe', holderChanged: false }],
      others: [PAUL],
      limited: true,
    })
  })

  it('opens no choice from a full access, nor before the results', async () => {
    const { j, shown, asks } = journey('all', [PAUL], {})
    j.open()
    await j.shareMore()
    await j.go()
    const before = shown.length

    await j.shareMore()

    expect(asks.choice).toBe(0)
    expect(shown).toHaveLength(before)
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
      {
        ...d,
        askForTheAddressBook: async () => 'all',
        shareMoreCards: async () => undefined,
      },
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
      {
        ...d,
        askForTheAddressBook: async () => 'all',
        shareMoreCards: async () => undefined,
      },
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
        shareMoreCards: async () => undefined,
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

describe('the limit on masking (#401)', () => {
  it('masks what the limit still allows, then says how many contacts wait and until when', async () => {
    const { deps: d, asked } = deps(
      [PAUL, ANNE, ZOE],
      { '+33612345678': 'ref-paul', '+33698765432': 'ref-zoe' },
      { limit: 2 },
    )

    const found = await findContacts(d)

    // Ordered as the address book is: Paul, then Anne, then Zoé.
    expect(
      asked
        .filter(a => a.route === 'maskBatch')
        .map(a => a.body!.blinded.length),
    ).toEqual([3, 2])
    expect(found).toEqual({
      found: true,
      matches: [{ contact: PAUL, reference: 'ref-paul', holderChanged: false }],
      others: [ANNE, ZOE],
      waiting: { count: 1, freesAt: FREES_AT * 1000 },
    })
  })

  it('masks nothing when the limit is spent, and still downloads the whole directory', async () => {
    const { deps: d, asked } = deps(
      [PAUL, ZOE],
      { '+33612345678': 'ref-paul' },
      { limit: 0 },
    )

    const found = await findContacts(d)

    expect(found).toEqual({
      found: true,
      matches: [],
      others: [PAUL, ZOE],
      waiting: { count: 2, freesAt: FREES_AT * 1000 },
    })
    expect(asked.map(a => a.route)).toEqual(['keys', 'maskBatch', 'directory'])
  })

  it('sends the same requests through the limit for an address book that finds somebody and one that finds nobody', async () => {
    const proven = { '+33612345678': 'ref-paul' }
    const LEA: Contact = { name: 'Léa', numbers: ['06 11 22 33 44'] }
    const findsPaul = deps([PAUL, ZOE, ANNE], proven, { limit: 2 })
    const findsNobody = deps([LEA, ZOE, ANNE], proven, { limit: 2 })

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
      `maskBatch:${KEY}:3`,
      `maskBatch:${KEY}:2`,
      'directory',
    ])
  })
})

describe('looking again (#402)', () => {
  const PAUL_NUMBER = '+33612345678'
  const ZOE_NUMBER = '+33698765432'
  const ANNE_NUMBER = '+447911123456'
  const shape = (asked: Asked[]) =>
    asked.map(a =>
      a.body
        ? `${a.route}:${a.body.key_number}:${a.body.blinded.length}`
        : a.route,
    )
  const sentNumbers = (asked: Asked[]) =>
    asked
      .filter(a => a.route === 'maskBatch')
      .flatMap(a => a.body!.blinded.map(e => text(unb64(e))))
  const row = (
    number: string,
    reference: string | null,
    keyNumber = KEY,
  ): Row => [keyNumber, number, { mask: maskOf(number), reference }]

  it('masks only the numbers the page does not hold, and still downloads the whole directory', async () => {
    const proven = { [PAUL_NUMBER]: 'ref-paul' }
    const first = deps([PAUL, ZOE], proven)
    await findContacts(first.deps)
    expect(first.page).toEqual(
      new Map([
        [
          `${KEY}/${PAUL_NUMBER}`,
          { mask: maskOf(PAUL_NUMBER), reference: 'ref-paul' },
        ],
        [`${KEY}/${ZOE_NUMBER}`, { mask: maskOf(ZOE_NUMBER), reference: null }],
      ]),
    )

    const second = deps([PAUL, ZOE, ANNE], proven, {
      rows: [row(PAUL_NUMBER, 'ref-paul'), row(ZOE_NUMBER, null)],
    })
    const found = await findContacts(second.deps)

    expect(shape(second.asked)).toEqual([
      'keys',
      `maskBatch:${KEY}:1`,
      'directory',
    ])
    expect(sentNumbers(second.asked)).toEqual([`blinded(${ANNE_NUMBER})`])
    expect(found).toEqual({
      found: true,
      matches: [{ contact: PAUL, reference: 'ref-paul', holderChanged: false }],
      others: [ANNE, ZOE],
      waiting: null,
    })
  })

  it('masks nothing when the page holds every number, and still downloads the directory', async () => {
    const { deps: d, asked } = deps(
      [PAUL, ZOE],
      { [PAUL_NUMBER]: 'ref-paul' },
      {
        rows: [row(PAUL_NUMBER, 'ref-paul'), row(ZOE_NUMBER, null)],
      },
    )

    const found = await findContacts(d)

    expect(shape(asked)).toEqual(['keys', 'directory'])
    expect(found.found && found.matches).toEqual([
      { contact: PAUL, reference: 'ref-paul', holderChanged: false },
    ])
  })

  it('masks again a number kept under another key, and leaves that row as it was', async () => {
    const before = row(PAUL_NUMBER, 'ref-old-key', KEY - 1)
    const { deps: d, asked, page } = deps([PAUL], {}, { rows: [before] })

    await findContacts(d)

    expect(sentNumbers(asked)).toEqual([`blinded(${PAUL_NUMBER})`])
    expect(page.get(`${KEY}/${PAUL_NUMBER}`)).toEqual({
      mask: maskOf(PAUL_NUMBER),
      reference: null,
    })
    expect(page.get(`${KEY - 1}/${PAUL_NUMBER}`)).toEqual(before[2])
  })

  it('says a number changed hands when it leads to another account than it first did, and keeps the first', async () => {
    const { deps: d, page } = deps(
      [PAUL],
      { [PAUL_NUMBER]: 'ref-new' },
      {
        rows: [row(PAUL_NUMBER, 'ref-first')],
      },
    )

    const found = await findContacts(d)

    expect(found.found && found.matches).toEqual([
      { contact: PAUL, reference: 'ref-new', holderChanged: true },
    ])
    expect(page.get(`${KEY}/${PAUL_NUMBER}`)?.reference).toBe('ref-first')
  })

  it('keeps the reference of a number found for the first time', async () => {
    const { deps: d, page } = deps(
      [PAUL],
      { [PAUL_NUMBER]: 'ref-paul' },
      {
        rows: [row(PAUL_NUMBER, null)],
      },
    )

    const found = await findContacts(d)

    expect(found.found && found.matches).toEqual([
      { contact: PAUL, reference: 'ref-paul', holderChanged: false },
    ])
    expect(page.get(`${KEY}/${PAUL_NUMBER}`)?.reference).toBe('ref-paul')
  })

  it('keeps the first reference of a number no longer found', async () => {
    const { deps: d, page } = deps(
      [PAUL],
      {},
      {
        rows: [row(PAUL_NUMBER, 'ref-paul')],
      },
    )

    const found = await findContacts(d)

    expect(found.found && found.others).toEqual([PAUL])
    expect(page.get(`${KEY}/${PAUL_NUMBER}`)?.reference).toBe('ref-paul')
  })

  it('forgets the numbers that have left the address book', async () => {
    const { deps: d, page } = deps(
      [PAUL],
      {},
      {
        rows: [
          row(PAUL_NUMBER, null),
          row(ZOE_NUMBER, 'ref-zoe'),
          row(ZOE_NUMBER, null, KEY - 1),
        ],
      },
    )

    await findContacts(d)

    expect([...page.keys()]).toEqual([`${KEY}/${PAUL_NUMBER}`])
  })

  it('shows a contact as found rather than changed when one of its numbers did not change hands', async () => {
    const both: Contact = {
      name: 'Paul',
      numbers: ['06 12 34 56 78', '+33 6 98 76 54 32'],
    }
    const { deps: d } = deps(
      [both],
      { [PAUL_NUMBER]: 'ref-new', [ZOE_NUMBER]: 'ref-same' },
      { rows: [row(PAUL_NUMBER, 'ref-first'), row(ZOE_NUMBER, 'ref-same')] },
    )

    const found = await findContacts(d)

    expect(found.found && found.matches).toEqual([
      { contact: both, reference: 'ref-same', holderChanged: false },
    ])
  })

  it('sends the same requests whatever the page says the numbers led to', async () => {
    const leadsToPaul = deps(
      [PAUL, ZOE],
      { [PAUL_NUMBER]: 'ref-paul' },
      {
        rows: [row(PAUL_NUMBER, 'ref-paul')],
      },
    )
    const ledNowhere = deps(
      [PAUL, ZOE],
      {},
      {
        rows: [row(PAUL_NUMBER, null)],
      },
    )

    await findContacts(leadsToPaul.deps)
    await findContacts(ledNowhere.deps)

    expect(shape(leadsToPaul.asked)).toEqual(shape(ledNowhere.asked))
  })

  it('counts only the new numbers against the limit', async () => {
    const { deps: d, asked } = deps(
      [PAUL, ZOE, ANNE],
      { [PAUL_NUMBER]: 'ref-paul' },
      { limit: 1, rows: [row(PAUL_NUMBER, 'ref-paul')] },
    )

    const found = await findContacts(d)

    expect(shape(asked)).toEqual([
      'keys',
      `maskBatch:${KEY}:2`,
      `maskBatch:${KEY}:1`,
      'directory',
    ])
    expect(found).toEqual({
      found: true,
      matches: [{ contact: PAUL, reference: 'ref-paul', holderChanged: false }],
      others: [ANNE, ZOE],
      waiting: { count: 1, freesAt: FREES_AT * 1000 },
    })
  })

  it('looks as the first time when the page will not open, and shows what it found when the page will not keep it', async () => {
    const { deps: d, asked } = deps([PAUL], { [PAUL_NUMBER]: 'ref-paul' })
    const broken: DiscoveryResults = {
      recall: async () => {
        throw new Error('the notebook is unreadable')
      },
      keep: async () => {
        throw new Error('the notebook is read-only')
      },
      forgetAllBut: async () => {
        throw new Error('the notebook is read-only')
      },
    }

    const found = await findContacts({ ...d, results: broken })

    expect(sentNumbers(asked)).toEqual([`blinded(${PAUL_NUMBER})`])
    expect(found.found && found.matches).toEqual([
      { contact: PAUL, reference: 'ref-paul', holderChanged: false },
    ])
  })
})
