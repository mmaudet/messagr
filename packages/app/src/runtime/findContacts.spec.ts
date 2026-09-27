import { describe, expect, it } from 'vitest'

import { whereTheNumberGoes } from './discovery'
import {
  findContacts,
  findContactsEntry,
  findingJourney,
  regionOf,
  type Absent,
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

/** What the service holds as the mask of `number` under a key. */
const maskUnder = (number: string, key: number) =>
  b64(bytes(`mask(${number})#${key}`))
const maskOf = (number: string) => maskUnder(number, KEY)

/** The public key the service publishes for a key number. */
const publicKeyOf = (key: number) =>
  key === KEY ? PUBLIC_KEY : b64(bytes(`public-${key}`))

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
      // The key a batch was masked under is the one its proof is checked
      // against, as the real proof is: a batch masked under one key and
      // checked against another does not verify (#409).
      const under = Number(/#(\d+)$/.exec(text(evaluated[0]!))?.[1])
      if (!verifies || b64(publicKey) !== publicKeyOf(under)) {
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
  /** The envelope key each reference's proof published (#405), if any. */
  envelopeKeys: Record<string, string> = {},
  /**
   * The keys in service, oldest first, and the numbers proven under each
   * (#409); `KEY` alone, with `proven` under it, when not said.
   */
  served: { readonly [key: number]: Record<string, string> } = {
    [KEY]: proven,
  },
  /** The keys the service says were retired at once (#409). */
  retired: readonly number[] = [],
) {
  const asked: Asked[] = []
  let left = limit
  const service = {
    keys: async () => {
      asked.push({ route: 'keys' })
      return {
        status: 200,
        body: JSON.stringify({
          keys: Object.keys(served)
            .map(Number)
            .sort((a, b) => a - b)
            .map(key => ({ key_number: key, public_key: publicKeyOf(key) })),
          retired,
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
          entries: Object.entries(served).flatMap(([key, under]) =>
            Object.entries(under).map(([number, reference]) => ({
              key_number: Number(key),
              mask: maskUnder(number, Number(key)),
              reference,
              ...(envelopeKeys[reference] === undefined
                ? {}
                : { envelope_key: envelopeKeys[reference] }),
            })),
          ),
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
  /** The name of each card found, by number (#407). */
  const names = new Map<string, string>()
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
      for (const number of [...names.keys()]) {
        if (!numbers.includes(number)) names.delete(number)
      }
      return true
    },
    keyNumbersHeld: async () => [
      ...new Set(
        [...page.keys()].map(id => Number(id.slice(0, id.indexOf('/')))),
      ),
    ],
    forgetKeysBut: async keyNumbers => {
      for (const id of [...page.keys()]) {
        if (!keyNumbers.includes(Number(id.slice(0, id.indexOf('/'))))) {
          page.delete(id)
        }
      }
      return true
    },
    keepNames: async named => {
      for (const [number, name] of named) names.set(number, name)
      return true
    },
    nameOf: async reference => {
      for (const [id, kept] of page) {
        const name = names.get(id.slice(id.indexOf('/') + 1))
        if (kept.reference === reference && name !== undefined) return name
      }
      return null
    },
    forgetAll: async () => {
      page.clear()
      names.clear()
      return true
    },
  }
  return { results, page, names }
}

function deps(
  contacts: readonly Contact[],
  proven: Record<string, string>,
  options: {
    verifies?: boolean
    refuse?: number
    limit?: number
    rows?: readonly Row[]
    envelopeKeys?: Record<string, string>
    /**
     * The keys in service and what is proven under each (#409); `proven`
     * under `KEY` alone when not said, and ignored when said.
     */
    served?: { readonly [key: number]: Record<string, string> }
    /** The keys the service says were retired at once (#409). */
    retired?: readonly number[]
  } = {},
) {
  const { masking, calls } = theMasking(options.verifies)
  const { service, asked } = theService(
    proven,
    options.refuse,
    options.limit,
    options.envelopeKeys,
    options.served,
    options.retired,
  )
  const { results, page, names } = thePage(options.rows)
  const all: FindingDeps = {
    readAddressBook: async () => contacts,
    masking,
    service,
    region: () => 'FR',
    results,
    ownNumber: () => null,
  }
  return { deps: all, asked, calls, page, names }
}

const PAUL: Contact = { name: 'Paul', numbers: ['06 12 34 56 78'] }
const ANNE: Contact = { name: 'Anne', numbers: ['+44 7911 123456'] }
const ZOE: Contact = { name: 'Zoé', numbers: ['+33 6 98 76 54 32'] }

/** Each of those three not on Messagr, with the number an SMS goes to (#408). */
const ABSENT: ReadonlyMap<Contact, Absent> = new Map([
  [PAUL, { contact: PAUL, number: '+33612345678' }],
  [ANNE, { contact: ANNE, number: '+447911123456' }],
  [ZOE, { contact: ZOE, number: '+33698765432' }],
])
const absent = (...contacts: Contact[]) => contacts.map(one => ABSENT.get(one)!)

const PAUL_NUMBER = '+33612345678'
const ZOE_NUMBER = '+33698765432'
const ANNE_NUMBER = '+447911123456'

/**
 * A look's requests, by route, key and size: what the matches must never
 * change (#392).
 */
const shape = (asked: readonly Asked[]) =>
  asked.map(a =>
    a.body
      ? `${a.route}:${a.body.key_number}:${a.body.blinded.length}`
      : a.route,
  )

/** The numbers a look sent to be masked, as the double blinded them. */
const sentNumbers = (asked: readonly Asked[]) =>
  asked
    .filter(a => a.route === 'maskBatch')
    .flatMap(a => a.body!.blinded.map(e => text(unb64(e))))

/** A row of the page: a number, and what its mask under a key led to. */
const row = (
  number: string,
  reference: string | null,
  keyNumber = KEY,
): Row => [keyNumber, number, { mask: maskUnder(number, keyNumber), reference }]

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
        {
          contact: ANNE,
          reference: 'ref-anne',
          holderChanged: false,
          envelopeKey: null,
        },
        {
          contact: PAUL,
          reference: 'ref-paul',
          holderChanged: false,
          envelopeKey: null,
        },
      ],
      others: absent(ZOE),
      waiting: null,
    })
  })

  it('gives each contact found the envelope key its proof published, when it did (#405)', async () => {
    const { deps: d } = deps(
      [PAUL, ANNE],
      { '+33612345678': 'ref-paul', '+447911123456': 'ref-anne' },
      { envelopeKeys: { 'ref-paul': 'key-of-paul' } },
    )

    const found = await findContacts(d)

    expect(found).toMatchObject({
      found: true,
      matches: [
        { contact: ANNE, reference: 'ref-anne', envelopeKey: null },
        { contact: PAUL, reference: 'ref-paul', envelopeKey: 'key-of-paul' },
      ],
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

  it('gives each contact not on Messagr the number an SMS goes to: the first of its card that is one, in international form (#408)', async () => {
    const zoe: Contact = {
      name: 'Zoé',
      numbers: ['pas un numéro', '06 98 76 54 32', '+44 7911 123456'],
    }
    const nobody: Contact = { name: 'Sans numéro', numbers: ['12'] }
    const { deps: d } = deps([zoe, nobody], {})

    const found = await findContacts(d)

    // None for a card that holds no number: then only « Autre moyen ».
    expect(found.found && found.others).toEqual([
      { contact: nobody, number: null },
      { contact: zoe, number: '+33698765432' },
    ])
  })

  it('never offers an SMS to the number this account proved, but to the next one of the card (#408)', async () => {
    const both: Contact = {
      name: 'Moi et bureau',
      numbers: ['06 12 34 56 78', '06 98 76 54 32'],
    }
    const { deps: d } = deps([both], {})

    const found = await findContacts({ ...d, ownNumber: () => '+33612345678' })

    expect(found.found && found.others).toEqual([
      { contact: both, number: '+33698765432' },
    ])
  })

  it('asks nothing of the service for an address book without a number', async () => {
    const { deps: d, asked } = deps([{ name: 'Sans numéro', numbers: [] }], {})

    expect(await findContacts(d)).toEqual({
      found: true,
      matches: [],
      others: [{ contact: { name: 'Sans numéro', numbers: [] }, number: null }],
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
    choice: () => Promise<void> = async () => undefined,
  ) {
    const book = [...contacts]
    const { deps: d, asked } = deps(book, proven)
    const shown: FindingStage[] = []
    const asks = { system: 0, choice: 0, reads: 0 }
    const j = findingJourney(
      {
        ...d,
        readAddressBook: async () => {
          asks.reads += 1
          return book
        },
        askForTheAddressBook: async () => {
          asks.system += 1
          return access
        },
        shareMoreCards: async () => {
          asks.choice += 1
          await choice()
          book.push(...added)
          return added.length
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
      matches: [
        {
          contact: PAUL,
          reference: 'ref-paul',
          holderChanged: false,
          envelopeKey: null,
        },
      ],
      others: absent(ZOE),
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
      matches: [
        {
          contact: ZOE,
          reference: 'ref-zoe',
          holderChanged: false,
          envelopeKey: null,
        },
      ],
      others: absent(PAUL),
      limited: true,
    })
  })

  it('shows the results as they were when no card was added, and asks nothing', async () => {
    const { j, shown, asked, asks } = journey('some', [PAUL], {})
    j.open()
    await j.go()
    const results = shown.at(-1)
    const before = asked.length

    await j.shareMore()

    expect(asks.choice).toBe(1)
    expect(shown.slice(-2)).toEqual([{ stage: 'looking' }, results])
    expect(asked).toHaveLength(before)
    expect(asks.reads).toBe(1)
  })

  it('shows the results as they were when the choice cannot open', async () => {
    const { deps: d } = deps([PAUL], {})
    const shown: FindingStage[] = []
    const j = findingJourney(
      {
        ...d,
        askForTheAddressBook: async () => 'some',
        shareMoreCards: async () => {
          throw new Error('no picker')
        },
      },
      stage => shown.push(stage),
    )
    j.open()
    await j.go()
    const results = shown.at(-1)

    await j.shareMore()

    expect(shown.at(-1)).toBe(results)
  })

  it('drops what the choice answers after its screen was left', async () => {
    let closeTheChoice = () => {}
    const { j, shown, asked } = journey(
      'some',
      [PAUL],
      {},
      [ZOE],
      () =>
        new Promise<void>(done => {
          closeTheChoice = done
        }),
    )
    j.open()
    await j.go()
    const before = asked.length

    const sharing = j.shareMore()
    j.close()
    closeTheChoice()
    await sharing

    expect(shown.at(-1)).toEqual({ stage: 'shut' })
    expect(asked).toHaveLength(before)
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
    const { j, shown, asked, asks } = journey('none', [PAUL], {})

    j.open()
    await j.go()

    expect(shown.at(-1)).toEqual({ stage: 'refused', why: 'no-access' })
    expect(asks.reads).toBe(0)
    expect(asked).toEqual([])
  })

  it('says why nothing was found when looking stopped', async () => {
    const { deps: d } = deps([PAUL], {}, { verifies: false })
    const shown: FindingStage[] = []
    const j = findingJourney(
      {
        ...d,
        askForTheAddressBook: async () => 'all',
        shareMoreCards: async () => 0,
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

  it('leaves out the number this account proved: the person does not find themselves', async () => {
    const me: Contact = { name: 'Moi', numbers: ['06 12 34 56 78'] }
    const { deps: d, asked } = deps([me, ZOE], {
      '+33612345678': 'ref-me',
      '+33698765432': 'ref-zoe',
    })

    const found = await findContacts({ ...d, ownNumber: () => '+33612345678' })

    expect(
      asked
        .filter(a => a.route === 'maskBatch')
        .flatMap(a => a.body!.blinded.map(e => text(unb64(e)))),
    ).toEqual(['blinded(+33698765432)'])
    expect(found.found && found.matches.map(m => m.contact)).toEqual([ZOE])
    // Nor is an SMS offered to the person's own number.
    expect(found.found && found.others).toEqual([{ contact: me, number: null }])
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
        shareMoreCards: async () => 0,
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
        shareMoreCards: async () => 0,
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
      matches: [
        {
          contact: PAUL,
          reference: 'ref-paul',
          holderChanged: false,
          envelopeKey: null,
        },
      ],
      others: absent(ANNE, ZOE),
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
      others: absent(PAUL, ZOE),
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
      matches: [
        {
          contact: PAUL,
          reference: 'ref-paul',
          holderChanged: false,
          envelopeKey: null,
        },
      ],
      others: absent(ANNE, ZOE),
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
      {
        contact: PAUL,
        reference: 'ref-paul',
        holderChanged: false,
        envelopeKey: null,
      },
    ])
  })

  it('masks again a number kept under a key that left, carries what it first led to, and forgets that row (#409)', async () => {
    const before = row(PAUL_NUMBER, 'ref-old-key', KEY - 1)
    const { deps: d, asked, page } = deps([PAUL], {}, { rows: [before] })

    await findContacts(d)

    expect(sentNumbers(asked)).toEqual([`blinded(${PAUL_NUMBER})`])
    // The first account the number led to, under the key that left at the
    // end of a planned change, is the one the key in service keeps.
    expect(page.get(`${KEY}/${PAUL_NUMBER}`)).toEqual({
      mask: maskOf(PAUL_NUMBER),
      reference: 'ref-old-key',
    })
    // And a key that no longer serves masks nothing any more.
    expect(page.get(`${KEY - 1}/${PAUL_NUMBER}`)).toBeUndefined()
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
      {
        contact: PAUL,
        reference: 'ref-new',
        holderChanged: true,
        envelopeKey: null,
      },
    ])
    expect(page.get(`${KEY}/${PAUL_NUMBER}`)?.reference).toBe('ref-first')
  })

  it('forgets the page, card names included, when the address book holds no number any more (#407)', async () => {
    const {
      deps: d,
      page,
      names,
    } = deps(
      [{ name: 'Paul', numbers: ['not a number'] }],
      {},
      { rows: [row(PAUL_NUMBER, 'ref-paul')] },
    )
    names.set(PAUL_NUMBER, 'Paul')

    await findContacts(d)

    expect(page.size).toBe(0)
    expect(names.size).toBe(0)
  })

  it('keeps the name of each card found, and none for a number that changed hands (#407)', async () => {
    const { deps: d, names } = deps(
      [PAUL, ANNE],
      { [PAUL_NUMBER]: 'ref-new', '+447911123456': 'ref-anne' },
      { rows: [row(PAUL_NUMBER, 'ref-first')] },
    )

    await findContacts(d)

    expect(names).toEqual(new Map([['+447911123456', 'Anne']]))
    expect(await d.results.nameOf('ref-anne')).toBe('Anne')
    expect(await d.results.nameOf('ref-new')).toBeNull()
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
      {
        contact: PAUL,
        reference: 'ref-paul',
        holderChanged: false,
        envelopeKey: null,
      },
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

    expect(found.found && found.others).toEqual(absent(PAUL))
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
      {
        contact: both,
        reference: 'ref-same',
        holderChanged: false,
        envelopeKey: null,
      },
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
      matches: [
        {
          contact: PAUL,
          reference: 'ref-paul',
          holderChanged: false,
          envelopeKey: null,
        },
      ],
      others: absent(ANNE, ZOE),
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
      keyNumbersHeld: async () => {
        throw new Error('the notebook is unreadable')
      },
      forgetKeysBut: async () => {
        throw new Error('the notebook is read-only')
      },
      keepNames: async () => {
        throw new Error('the notebook is read-only')
      },
      nameOf: async () => {
        throw new Error('the notebook is unreadable')
      },
      forgetAll: async () => {
        throw new Error('the notebook is read-only')
      },
    }

    const found = await findContacts({ ...d, results: broken })

    expect(sentNumbers(asked)).toEqual([`blinded(${PAUL_NUMBER})`])
    expect(found.found && found.matches).toEqual([
      {
        contact: PAUL,
        reference: 'ref-paul',
        holderChanged: false,
        envelopeKey: null,
      },
    ])
  })
})

describe('while two keys serve (#409)', () => {
  const OLD = KEY
  const NEW = KEY + 1
  /** What is proven under each key, the old one first. */
  const serving = (
    old: Record<string, string>,
    fresh: Record<string, string>,
  ): Record<number, Record<string, string>> => ({ [OLD]: old, [NEW]: fresh })

  it('finds an account that has not renewed under the old key, and one that has under the new', async () => {
    const { deps: d, asked } = deps(
      [PAUL, ANNE, ZOE],
      {},
      {
        served: serving(
          { [PAUL_NUMBER]: 'ref-paul' },
          { [ANNE_NUMBER]: 'ref-anne' },
        ),
      },
    )

    const found = await findContacts(d)

    expect(found.found && found.matches.map(m => m.reference)).toEqual([
      'ref-anne',
      'ref-paul',
    ])
    // Each number masked under each key, the new one first, and the
    // directory once.
    expect(shape(asked)).toEqual([
      'keys',
      `maskBatch:${NEW}:3`,
      `maskBatch:${OLD}:3`,
      'directory',
    ])
  })

  it('masks under the new key what the page holds under the old one only, once', async () => {
    const served = serving({ [PAUL_NUMBER]: 'ref-paul' }, {})
    const first = deps(
      [PAUL, ZOE],
      {},
      {
        served,
        rows: [row(PAUL_NUMBER, 'ref-paul', OLD), row(ZOE_NUMBER, null, OLD)],
      },
    )

    await findContacts(first.deps)

    expect(shape(first.asked)).toEqual([
      'keys',
      `maskBatch:${NEW}:2`,
      'directory',
    ])
    const again = deps(
      [PAUL, ZOE],
      {},
      {
        served,
        rows: [...first.page].map(([id, kept]) => {
          const [key, number] = id.split('/')
          return [Number(key), number!, kept] as Row
        }),
      },
    )
    await findContacts(again.deps)
    expect(shape(again.asked)).toEqual(['keys', 'directory'])
  })

  it('reads an account renewed under the new key as the same, by the reference it kept', async () => {
    const { deps: d, page } = deps(
      [PAUL],
      {},
      {
        served: serving({}, { [PAUL_NUMBER]: 'ref-paul' }),
        rows: [row(PAUL_NUMBER, 'ref-paul', OLD)],
      },
    )

    const found = await findContacts(d)

    expect(found.found && found.matches).toEqual([
      {
        contact: PAUL,
        reference: 'ref-paul',
        holderChanged: false,
        envelopeKey: null,
      },
    ])
    expect(page.get(`${NEW}/${PAUL_NUMBER}`)?.reference).toBe('ref-paul')
  })

  it('says a number changed hands when the account under the new key is not the one under the old', async () => {
    const {
      deps: d,
      page,
      names,
    } = deps(
      [PAUL],
      {},
      {
        served: serving({}, { [PAUL_NUMBER]: 'ref-someone-else' }),
        rows: [row(PAUL_NUMBER, 'ref-paul', OLD)],
      },
    )

    const found = await findContacts(d)

    expect(found.found && found.matches[0]?.holderChanged).toBe(true)
    // The first reference the number led to is kept under the new key too,
    // so the next look says it again, and the card gives the new account
    // no name.
    expect(page.get(`${NEW}/${PAUL_NUMBER}`)?.reference).toBe('ref-paul')
    expect(names.get(PAUL_NUMBER)).toBeUndefined()
  })

  it('forgets what the page holds under a key no longer served', async () => {
    const { deps: d, page } = deps(
      [PAUL],
      {},
      {
        served: { [NEW]: { [PAUL_NUMBER]: 'ref-paul' } },
        rows: [row(PAUL_NUMBER, 'ref-paul', OLD)],
      },
    )

    await findContacts(d)

    expect([...page.keys()]).toEqual([`${NEW}/${PAUL_NUMBER}`])
  })

  it('says a number changed hands when the page held no account for it under the new key, and one under the old', async () => {
    // A first look while Paul had not renewed kept, under the new key, a
    // mask that led nowhere; the number now leads to somebody else there.
    const { deps: d, names } = deps(
      [PAUL],
      {},
      {
        served: serving({}, { [PAUL_NUMBER]: 'ref-stranger' }),
        rows: [row(PAUL_NUMBER, 'ref-paul', OLD), row(PAUL_NUMBER, null, NEW)],
      },
    )

    const found = await findContacts(d)

    expect(found.found && found.matches[0]?.holderChanged).toBe(true)
    expect(names.get(PAUL_NUMBER)).toBeUndefined()
  })

  it('carries onto the key in service the first reference of a key that left normally, then forgets that key', async () => {
    // No look during the twenty-eight days: the old key is gone from the
    // service, and the page still knows who the number led to under it.
    const {
      deps: d,
      page,
      names,
    } = deps(
      [PAUL],
      {},
      {
        served: { [NEW]: { [PAUL_NUMBER]: 'ref-stranger' } },
        rows: [row(PAUL_NUMBER, 'ref-paul', OLD)],
      },
    )

    const found = await findContacts(d)

    expect(found.found && found.matches[0]?.holderChanged).toBe(true)
    expect(names.get(PAUL_NUMBER)).toBeUndefined()
    expect([...page.keys()]).toEqual([`${NEW}/${PAUL_NUMBER}`])
    expect(page.get(`${NEW}/${PAUL_NUMBER}`)?.reference).toBe('ref-paul')
  })

  it('forgets without carrying what it held under a key retired at once', async () => {
    // The accounts a retirement stopped prove again under a new reference:
    // compared with the old one, every one of them would read as a number
    // that changed hands.
    const {
      deps: d,
      page,
      names,
    } = deps(
      [PAUL],
      {},
      {
        served: { [NEW]: { [PAUL_NUMBER]: 'ref-paul-again' } },
        retired: [OLD],
        rows: [row(PAUL_NUMBER, 'ref-paul', OLD)],
      },
    )

    const found = await findContacts(d)

    expect(found.found && found.matches[0]).toMatchObject({
      reference: 'ref-paul-again',
      holderChanged: false,
    })
    expect(names.get(PAUL_NUMBER)).toBe('Paul')
    expect([...page.keys()]).toEqual([`${NEW}/${PAUL_NUMBER}`])
  })

  it('keeps what it held under a key that left normally while numbers wait for the limit', async () => {
    // Carried only for the numbers masked under the key in service: the
    // others keep their first reference until a later look.
    const { deps: d, page } = deps(
      [PAUL, ZOE],
      {},
      {
        served: { [NEW]: {} },
        limit: 1,
        rows: [
          row(PAUL_NUMBER, 'ref-paul', OLD),
          row(ZOE_NUMBER, 'ref-zoe', OLD),
        ],
      },
    )

    const found = await findContacts(d)

    expect(found.found && found.waiting?.count).toBe(1)
    expect(page.get(`${OLD}/${PAUL_NUMBER}`)?.reference).toBe('ref-paul')
    expect(page.get(`${OLD}/${ZOE_NUMBER}`)?.reference).toBe('ref-zoe')
  })

  it('stops masking at the limit under one key, and counts as waiting whoever is not compared under both', async () => {
    const { deps: d, asked } = deps(
      [PAUL, ZOE, ANNE],
      {},
      {
        served: serving({}, {}),
        limit: 2,
      },
    )

    const found = await findContacts(d)

    expect(shape(asked)).toEqual([
      'keys',
      `maskBatch:${NEW}:3`,
      `maskBatch:${NEW}:2`,
      'directory',
    ])
    expect(found.found && found.waiting).toEqual({
      count: 3,
      freesAt: FREES_AT * 1000,
    })
  })

  it('sends the same requests under two keys for an address book that finds somebody and one that finds nobody', async () => {
    const finds = deps(
      [PAUL, ZOE],
      {},
      {
        served: serving(
          { [PAUL_NUMBER]: 'ref-paul' },
          { [ZOE_NUMBER]: 'ref-zoe' },
        ),
      },
    )
    const findsNobody = deps(
      [PAUL, ZOE],
      {},
      {
        served: serving({}, {}),
      },
    )

    await findContacts(finds.deps)
    await findContacts(findsNobody.deps)

    expect(shape(finds.asked)).toEqual(shape(findsNobody.asked))
    expect(shape(finds.asked)).toEqual([
      'keys',
      `maskBatch:${NEW}:2`,
      `maskBatch:${OLD}:2`,
      'directory',
    ])
  })
})
