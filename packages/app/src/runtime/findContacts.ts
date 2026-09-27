/**
 * Looking for one's contacts (#400, #392, ADR 0014): which contacts of the
 * address book are already on Messagr, shown under the name of their card.
 *
 * Only a findable account looks for its contacts, and only when the person
 * asks: nothing here runs by itself. The screens ask the system for the
 * address book first; this module takes it from there.
 *
 * # THE NUMBERS LEAVE THE TELEPHONE MASKED, NEVER IN CLEAR
 *
 * Each number is written in international form, then blinded on the
 * telephone by the crypto bridge's client of RFC 9497's oblivious
 * pseudorandom function. The service evaluates the blinded elements with its
 * key, and answers each batch with one proof that it used the published key,
 * which the bridge checks before it unblinds anything. What comes out is each
 * number's mask, the same the service keeps for a proven number. The names
 * never leave the telephone at all.
 *
 * # THE COMPARISON IS MADE HERE, AND NOTHING SENT DEPENDS ON IT
 *
 * The directory comes down whole, the same for everyone, and the masks are
 * compared with it on the telephone. The requests are the same whether a
 * contact is found or not: the keys, the batches, and the directory. The
 * service never learns who is in the address book, nor whether a contact was
 * found.
 *
 * # LOOKING AGAIN COSTS ONLY THE NEW NUMBERS (#402)
 *
 * What looking found is kept in a page of the notebook: for each number gone
 * through, its mask, the key it was made under and the reference it led to.
 * The next look masks only the numbers the page does not hold under the
 * current key, and still downloads the whole directory, since what it asks
 * for must not depend on what it found.
 *
 * # WHAT IS INJECTED
 *
 * The reading of the address book, the masking, the transport to the service,
 * the page of the notebook, and the telephone's region, for numbers written
 * without their country code. The tests stand them in and record every
 * request.
 */
import {
  isSupportedCountry,
  parsePhoneNumberFromString,
  type CountryCode,
} from 'libphonenumber-js/min'

import type { AddressBookAccess } from './addressBook'
import { bytesOf } from './base64'
import {
  isFindable,
  parsed,
  type Answer,
  type DiscoveryReading,
} from './discovery'
import { base64Of } from './receiveImage'

/** An entry of the address book, as the system gives it. */
export interface Contact {
  readonly name: string
  /** As written in the card: national or international, with its spaces. */
  readonly numbers: readonly string[]
}

/**
 * A batch blinded by the crypto bridge (`blindOprf`): the blinded elements
 * are the only part meant for the service, and the bridge keeps the rest.
 */
export interface Blinding {
  readonly blindedElements: readonly Uint8Array[]
}

/** The client half of the OPRF, from the crypto bridge (#395). */
export interface Masking {
  readonly blind: (inputs: readonly Uint8Array[]) => Promise<Blinding>
  /**
   * Checks the answer's batch proof against `publicKey`, then unblinds; or
   * says the answer did not come from that key (`bridgeMasking.ts`). The
   * batch proof is RFC 9497's, the service's proof about a batch it masked,
   * and nothing to do with the proof of a number.
   */
  readonly finalize: (
    blinding: Blinding,
    evaluationElements: readonly Uint8Array[],
    batchProof: Uint8Array,
    publicKey: Uint8Array,
  ) => Promise<Uint8Array[] | 'not-the-published-key'>
}

/** The routes of the service a findable account looks for its contacts with. */
export interface FindingService {
  /** `GET /discovery/keys`. */
  readonly keys: () => Promise<Answer>
  /** `POST /discovery/masks`. */
  readonly maskBatch: (body: string) => Promise<Answer>
  /** `GET /discovery/directory`. */
  readonly directory: () => Promise<Answer>
}

export interface FindingDeps {
  readonly readAddressBook: () => Promise<readonly Contact[]>
  readonly masking: Masking
  readonly service: FindingService
  /**
   * The telephone's region, ISO 3166-1 alpha-2, such as `FR`, for a number
   * written without its country code; `undefined` when the telephone names
   * none, and such a number is then left aside rather than guessed at. Read
   * when the person looks, not when the application starts.
   */
  readonly region: () => string | undefined
  /** What the looks before this one found (#402). */
  readonly results: DiscoveryResults
  /**
   * The number this account proved, in international form, as this device
   * keeps it (#398); `null` when none is kept. Left out of the address book:
   * the person's own card would find the person, and « Inviter » would lead
   * to themselves (#404).
   */
  readonly ownNumber: () => string | null
}

/** What looking found for one number under one key (#402). */
export interface Remembered {
  /** Base64, as the service lists it. */
  readonly mask: string
  /**
   * The reference the mask first led to under that key, and kept even when
   * it leads to another since; `null` while it has led to none.
   */
  readonly reference: string | null
}

/**
 * The page of the notebook that keeps what looking found (#402). By number
 * here; in the notebook, by a fingerprint only this device can make, so the
 * page holds no number. A page degrades rather than failing, as every page
 * of the notebook does; a look guards against one that throws all the same.
 */
export interface DiscoveryResults {
  /** What is kept under this key for those of these numbers it holds. */
  readonly recall: (
    keyNumber: number,
    numbers: readonly string[],
  ) => Promise<ReadonlyMap<string, Remembered>>
  /** Keeps what these numbers led to under this key. Whether it held. */
  readonly keep: (
    keyNumber: number,
    remembered: ReadonlyMap<string, Remembered>,
  ) => Promise<boolean>
  /**
   * Forgets every number but these, under every key: the address book as it
   * stands. Whether it held.
   */
  readonly forgetAllBut: (numbers: readonly string[]) => Promise<boolean>
  /**
   * Keeps, for each of these numbers found, the name of its card (#407).
   * Whether it held.
   */
  readonly keepNames: (named: ReadonlyMap<string, string>) => Promise<boolean>
  /**
   * The name of the card whose number first led to `reference`, or `null`:
   * what tells an invitation from somebody in the address book, without
   * reading it again (#407).
   */
  readonly nameOf: (reference: string) => Promise<string | null>
  /**
   * Forgets everything the page holds, its key included: the number was
   * withdrawn (#407, the owner's decision of 27 September 2026). Whether it
   * held.
   */
  readonly forgetAll: () => Promise<boolean>
}

/** A contact whose number a findable account proved, and that account. */
export interface Match {
  readonly contact: Contact
  /** What the service knows the account by, and nobody else can link to it. */
  readonly reference: string
  /**
   * The number led to another reference before, under the same key (#402):
   * this account inherits nothing of it, and the row says the number changed
   * hands. The device cannot tell another person from the same one proving
   * again more than thirty days after its proof ended, once the service has
   * forgotten it (#398): either way the reference is new, and a month is how
   * soon a number given up can change hands (#392, Q36).
   */
  readonly holderChanged: boolean
  /**
   * The envelope key the account's device published with its proof, base64
   * (#405): what an inviter seals its name for. `null` when it published
   * none, and then the invitation goes without a name.
   */
  readonly envelopeKey: string | null
}

/**
 * A contact not on Messagr, or not findable, and the number an invitation by
 * SMS goes to (#408): the first of its card's numbers that is one, in
 * international form, and never the number this account proved. `null` when
 * the card holds none, and then only « Autre moyen » is offered.
 */
export interface Absent {
  readonly contact: Contact
  readonly number: string | null
}

export type Findings =
  | {
      readonly found: true
      /** By name. */
      readonly matches: readonly Match[]
      /** The contacts not on Messagr, or not findable, by name. */
      readonly others: readonly Absent[]
      /**
       * What the limit on masking left for later (#401); `null` when every
       * number was masked.
       */
      readonly waiting: Waiting | null
    }
  | { readonly found: false; readonly refusal: FindingRefusal }

/** What the limit on masking left for later (#401). */
export interface Waiting {
  /** How many contacts hold a number not masked yet. */
  readonly count: number
  /**
   * When the service masks more numbers, in milliseconds since the epoch: not
   * necessarily all of them.
   */
  readonly freesAt: number
}

/** A batch over the limit of #401, as the service refuses it. */
interface Limit {
  /** How many numbers of the batch are still allowed. */
  readonly remaining: number
  /** When more are, in milliseconds since the epoch. */
  readonly freesAt: number
}

/**
 * Why the contacts could not be looked for:
 * - `not-findable`: this account has no current proof, and proves its
 *   number first;
 * - `not-the-published-key`: an answer did not come from the published key.
 *   Nothing is shown, and the screen says so;
 * - `off`: this service does not serve discovery;
 * - `unreachable`: the service could not be reached, or answered something
 *   else than it should.
 */
export type FindingRefusal =
  'not-findable' | 'not-the-published-key' | 'off' | 'unreachable'

/**
 * Where « Retrouver mes contacts » leads from a reading of discovery: nowhere
 * while this service does not serve it, to the consent and the proof for an
 * account that is not findable (#392), to the reminder for one that is.
 */
export function findContactsEntry(
  reading: DiscoveryReading,
  now: number,
): 'hidden' | 'prove-first' | 'look' {
  if (!reading.read || !reading.on) return 'hidden'
  return isFindable(reading, now) ? 'look' : 'prove-first'
}

/**
 * The most numbers one request carries: what the service accepts in one
 * batch (`services/invitations/src/handlers/discovery.rs`).
 */
const BATCH = 5_000

export async function findContacts(deps: FindingDeps): Promise<Findings> {
  const contacts = await deps.readAddressBook()
  // A region the library does not know is no region: numbers written without
  // their country code are then left aside, as without one.
  const region = deps.region()
  const known =
    region !== undefined && isSupportedCountry(region) ? region : undefined
  const own = deps.ownNumber()
  const cards = new Map(
    contacts.map(contact => [contact, numbersOfCard(contact, known, own)]),
  )
  const holders = holdersOf(cards)
  /** The contacts not found, by name, each with its first number (#408). */
  const absent = (left: readonly Contact[]): Absent[] =>
    byName(left).map(contact => ({
      contact,
      number: cards.get(contact)?.[0] ?? null,
    }))
  if (holders.size === 0) {
    // NOTHING LEFT TO FIND, AND NOTHING LEFT TO KEEP: the page follows the
    // address book as it stands, the names of its cards included (#407).
    await quietly(() => deps.results.forgetAllBut([]))
    return { found: true, matches: [], others: absent(contacts), waiting: null }
  }

  const key = await currentKey(deps.service)
  if (typeof key === 'string') return { found: false, refusal: key }

  const numbers = [...holders.keys()]
  // WHAT THE LOOKS BEFORE THIS ONE MASKED under the current key is not
  // masked again. A page that will not open recalls nothing, and every number
  // is masked as on the first look.
  const remembered = await recalled(deps.results, key.keyNumber, numbers)
  const masks = new Map<string, string>()
  for (const [number, before] of remembered) masks.set(number, before.mask)
  const fresh = numbers.filter(number => !masks.has(number))
  // THE LIMIT OF #401: a batch over it is refused with how many numbers are
  // still allowed. Those are sent again, the first of the batch, and the
  // rest wait until more are allowed. Nothing here depends on a comparison:
  // what is sent follows the address book, the page and the limit, never the
  // matches.
  let freesAt: number | null = null
  for (let at = 0; at < fresh.length && freesAt === null; at += BATCH) {
    const batch = fresh.slice(at, at + BATCH)
    const masked = await haveMasked(deps, key, batch)
    if (typeof masked === 'string') return { found: false, refusal: masked }
    if ('limit' in masked) {
      freesAt = masked.limit.freesAt
      const allowed = batch.slice(0, masked.limit.remaining)
      if (allowed.length === 0) break
      const retried = await haveMasked(deps, key, allowed)
      if (typeof retried === 'string') return { found: false, refusal: retried }
      // Refused again: another device of this number spent the rest in the
      // meantime, and these wait too.
      if (!('limit' in retried)) {
        allowed.forEach((number, i) => masks.set(number, retried.masks[i]!))
      }
      break
    }
    batch.forEach((number, i) => masks.set(number, masked.masks[i]!))
  }

  // THE DIRECTORY COMES DOWN WHOLE, every time (#392), even when the limit
  // left nothing masked to compare it with.
  const listed = await directoryOf(deps.service, key.keyNumber)
  if (typeof listed === 'string') return { found: false, refusal: listed }

  const matched = new Map<Contact, Match>()
  const toKeep = new Map<string, Remembered>()
  // THE NAME OF EACH CARD FOUND (#407), for an invitation from its account
  // to be told apart without a look: the first card holding the number, and
  // none for a number that changed hands, whose new account is not the one
  // the card was found for.
  const named = new Map<string, string>()
  for (const [number, mask] of masks) {
    const entry = listed.get(mask)
    const reference = entry?.reference ?? null
    const before = remembered.get(number)
    // THE FIRST REFERENCE A NUMBER LED TO IS THE ONE KEPT: another one since
    // is a number that changed hands, and the new account inherits nothing.
    if (
      before === undefined ||
      (before.reference === null && reference !== null)
    ) {
      toKeep.set(number, { mask, reference })
    }
    if (reference === null) continue
    const holderChanged =
      before !== undefined &&
      before.reference !== null &&
      before.reference !== reference
    const holding = holders.get(number)!
    if (!holderChanged && holding[0] !== undefined) {
      named.set(number, holding[0].name)
    }
    for (const contact of holding) {
      // A contact's number that did not change hands wins over one that did.
      const already = matched.get(contact)
      if (already === undefined || (already.holderChanged && !holderChanged)) {
        matched.set(contact, {
          contact,
          reference,
          holderChanged,
          envelopeKey: entry?.envelopeKey ?? null,
        })
      }
    }
  }
  // Kept or not, what was found is shown: a page that will not hold only
  // costs the next look its numbers again. And a number that has left the
  // address book leaves the page.
  await quietly(() => deps.results.keep(key.keyNumber, toKeep))
  await quietly(() => deps.results.keepNames(named))
  await quietly(() => deps.results.forgetAllBut(numbers))
  // The contacts holding a number the limit left unmasked, gathered once for
  // every number rather than once for every contact.
  const unmasked = new Set<Contact>()
  for (const [number, held] of holders) {
    if (!masks.has(number)) held.forEach(contact => unmasked.add(contact))
  }
  const waiting = contacts.filter(
    contact => !matched.has(contact) && unmasked.has(contact),
  ).length
  return {
    found: true,
    matches: byName([...matched.keys()]).map(contact => matched.get(contact)!),
    others: absent(contacts.filter(contact => !matched.has(contact))),
    waiting:
      freesAt !== null && waiting > 0 ? { count: waiting, freesAt } : null,
  }
}

/**
 * Each number of a card that is one, in international form and in the card's
 * order, but the number this account proved: the person does not find
 * themselves, nor invite themselves by SMS (#408).
 */
function numbersOfCard(
  contact: Contact,
  known: CountryCode | undefined,
  own: string | null,
): string[] {
  const numbers: string[] = []
  for (const written of contact.numbers) {
    const number = parsePhoneNumberFromString(written, known)
    if (number === undefined || !number.isValid()) continue
    if (number.number === own) continue
    numbers.push(number.number)
  }
  return numbers
}

/**
 * Every number of the address book in international form, each once, with
 * the contacts that hold it. A number that is not one is left out.
 */
function holdersOf(
  cards: ReadonlyMap<Contact, readonly string[]>,
): Map<string, Contact[]> {
  const holders = new Map<string, Contact[]>()
  for (const [contact, numbers] of cards) {
    for (const number of numbers) {
      const held = holders.get(number) ?? []
      if (!held.includes(contact)) held.push(contact)
      holders.set(number, held)
    }
  }
  return holders
}

interface Key {
  readonly keyNumber: number
  readonly publicKey: Uint8Array
}

/** What the page keeps under this key; nothing when it cannot say. */
async function recalled(
  results: DiscoveryResults,
  keyNumber: number,
  numbers: readonly string[],
): Promise<ReadonlyMap<string, Remembered>> {
  try {
    return await results.recall(keyNumber, numbers)
  } catch {
    return new Map()
  }
}

/**
 * A write to the page, which never fails a look: what was found is shown
 * whether the page kept it or not.
 */
async function quietly(write: () => Promise<boolean>): Promise<void> {
  try {
    await write()
  } catch {
    // The next look writes it again.
  }
}

/** The current key: the last the service lists. */
async function currentKey(
  service: FindingService,
): Promise<Key | FindingRefusal> {
  const answer = await asked(() => service.keys())
  if (typeof answer === 'string') return answer
  const keys = answer.keys
  if (!Array.isArray(keys) || keys.length === 0) return 'unreachable'
  const last = keys[keys.length - 1] as Record<string, unknown>
  if (
    typeof last.key_number !== 'number' ||
    typeof last.public_key !== 'string'
  ) {
    return 'unreachable'
  }
  return { keyNumber: last.key_number, publicKey: bytesOf(last.public_key) }
}

/**
 * One batch blinded, masked by the service, and unblinded: each number's
 * mask, in base64, in the same order; or the limit of #401, when the batch is
 * over it.
 */
async function haveMasked(
  deps: FindingDeps,
  key: Key,
  numbers: readonly string[],
): Promise<
  { readonly masks: string[] } | { readonly limit: Limit } | FindingRefusal
> {
  const blinding = await deps.masking.blind(numbers.map(numberBytes))
  let answer: Answer
  try {
    answer = await deps.service.maskBatch(
      JSON.stringify({
        key_number: key.keyNumber,
        blinded: blinding.blindedElements.map(base64Of),
      }),
    )
  } catch {
    return 'unreachable'
  }
  const limit = limitOf(answer)
  if (limit !== null) return limit
  const body = bodyOf(answer)
  if (typeof body === 'string') return body
  const { evaluated, batch_proof: batchProof } = body
  if (
    body.key_number !== key.keyNumber ||
    !Array.isArray(evaluated) ||
    evaluated.length !== numbers.length ||
    !evaluated.every(e => typeof e === 'string') ||
    typeof batchProof !== 'string'
  ) {
    return 'unreachable'
  }
  let masks: Uint8Array[] | 'not-the-published-key'
  try {
    masks = await deps.masking.finalize(
      blinding,
      (evaluated as string[]).map(bytesOf),
      bytesOf(batchProof),
      key.publicKey,
    )
  } catch {
    return 'unreachable'
  }
  return masks === 'not-the-published-key'
    ? masks
    : { masks: masks.map(base64Of) }
}

/**
 * A number in international form as the masking takes it, and the
 * fingerprint of #402: a plus sign and digits, a byte each, which is how the
 * service masks a number it proves.
 */
export function numberBytes(number: string): Uint8Array {
  return Uint8Array.from(number, c => c.charCodeAt(0))
}

/** What the directory lists under a mask. */
interface Listed {
  readonly reference: string
  readonly envelopeKey: string | null
}

/**
 * The directory, as the masks under the key, and the reference and envelope
 * key of each.
 */
async function directoryOf(
  service: FindingService,
  keyNumber: number,
): Promise<Map<string, Listed> | FindingRefusal> {
  const answer = await asked(() => service.directory())
  if (typeof answer === 'string') return answer
  if (!Array.isArray(answer.entries)) return 'unreachable'
  const listed = new Map<string, Listed>()
  for (const entry of answer.entries as Record<string, unknown>[]) {
    if (
      entry.key_number === keyNumber &&
      typeof entry.mask === 'string' &&
      typeof entry.reference === 'string'
    ) {
      listed.set(entry.mask, {
        reference: entry.reference,
        envelopeKey:
          typeof entry.envelope_key === 'string' ? entry.envelope_key : null,
      })
    }
  }
  return listed
}

/** A request, and its answer read: its body, or why there is none. */
async function asked(
  request: () => Promise<Answer>,
): Promise<Record<string, unknown> | FindingRefusal> {
  try {
    return bodyOf(await request())
  } catch {
    return 'unreachable'
  }
}

/**
 * The limit of #401, when the answer to a batch is that it is over it; `null`
 * for any other answer. Not a refusal: looking goes on with what is allowed.
 */
function limitOf(
  answer: Answer,
): { readonly limit: Limit } | 'unreachable' | null {
  if (answer.status !== 429) return null
  const body = parsed(answer.body)
  if (body?.errcode !== 'MESSAGR_MASKING_QUOTA') return null
  const { remaining, frees_at: freesAt } = body
  return typeof remaining === 'number' && typeof freesAt === 'number'
    ? { limit: { remaining, freesAt: freesAt * 1000 } }
    : 'unreachable'
}

/** An answer read: its body, or why there is none. */
function bodyOf(answer: Answer): Record<string, unknown> | FindingRefusal {
  const body = parsed(answer.body)
  if (answer.status === 200 && body !== null) return body
  if (answer.status === 403 && body?.errcode === 'MESSAGR_NOT_FINDABLE') {
    return 'not-findable'
  }
  if (answer.status === 503 && body?.errcode === 'MESSAGR_DISCOVERY_OFF') {
    return 'off'
  }
  return 'unreachable'
}

function byName<T extends Contact>(contacts: readonly T[]): T[] {
  return [...contacts].sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * What the screen of « Retrouver mes contacts » shows.
 *
 * - `reminder`: one line and one button, before the system's own question,
 *   which Apple wants on a screen of its own;
 * - `looking`: masking and comparing;
 * - `found`: the contacts on Messagr under the name of their card, then the
 *   others; `limited` when the system shares some cards only (#403);
 * - `refused`: why nothing is shown, `no-access` when the system refused the
 *   address book.
 */
export type FindingStage =
  | { readonly stage: 'shut' }
  | { readonly stage: 'reminder' }
  | { readonly stage: 'looking' }
  | {
      readonly stage: 'found'
      readonly matches: readonly Match[]
      readonly others: readonly Absent[]
      readonly waiting: Waiting | null
      /**
       * The system shares some cards only, as iOS lets a person choose
       * (#403): what was looked at is those cards.
       */
      readonly limited: boolean
    }
  | {
      readonly stage: 'refused'
      readonly why: 'no-access' | FindingRefusal
    }

export interface FindingJourney {
  /** « Retrouver mes contacts », for a findable account: the reminder. */
  readonly open: () => void
  /**
   * « Continuer », from the reminder only: the system's question, then the
   * masking and the comparison. A second press, or one from any other stage,
   * does nothing, so the address book is never masked twice for one press.
   */
  readonly go: () => Promise<void>
  /**
   * « Partager d'autres contacts », from the results of a limited access only
   * (#403): the system's choice of the cards, then, when cards were added, a
   * look at what is shared now, and when none were, the results as they
   * were. From any other stage it does nothing.
   */
  readonly shareMore: () => Promise<void>
  /** Every way back. What is still running is dropped. */
  readonly close: () => void
}

/**
 * The journey of looking for one's contacts: nothing is read and nothing is
 * sent before the person continues from the reminder, and nothing at all
 * when the system refuses the address book.
 */
export function findingJourney(
  deps: FindingDeps & {
    /** The system's question: see `addressBook.ts`. */
    readonly askForTheAddressBook: () => Promise<AddressBookAccess>
    /**
     * The system's choice of the cards shared (#403), and how many cards were
     * added: `addressBook.ts`.
     */
    readonly shareMoreCards: () => Promise<number>
  },
  show: (stage: FindingStage) => void,
): FindingJourney {
  let stage: FindingStage = { stage: 'shut' }
  const move = (next: FindingStage) => {
    stage = next
    show(next)
  }
  // Which opening an answer belongs to: closing moves it on, and what ends
  // after its screen was left shows nothing.
  let opening = 0
  /** The system's question, then the look, for the opening `mine`. */
  const look = async (mine: number) => {
    let access: AddressBookAccess
    try {
      access = await deps.askForTheAddressBook()
    } catch {
      access = 'none'
    }
    if (mine !== opening) return
    if (access === 'none') {
      move({ stage: 'refused', why: 'no-access' })
      return
    }
    let findings: Findings
    try {
      findings = await findContacts(deps)
    } catch {
      findings = { found: false, refusal: 'unreachable' }
    }
    if (mine !== opening) return
    move(
      findings.found
        ? {
            stage: 'found',
            matches: findings.matches,
            others: findings.others,
            waiting: findings.waiting,
            limited: access === 'some',
          }
        : { stage: 'refused', why: findings.refusal },
    )
  }
  return {
    open: () => {
      opening += 1
      move({ stage: 'reminder' })
    },
    go: async () => {
      if (stage.stage !== 'reminder') return
      // Leaving the reminder at once, so that a second press finds another
      // stage and does nothing.
      move({ stage: 'looking' })
      await look(opening)
    },
    shareMore: async () => {
      if (stage.stage !== 'found' || !stage.limited) return
      const mine = opening
      const results = stage
      // Leaving the results at once, so that a second press finds another
      // stage and does nothing.
      move({ stage: 'looking' })
      let added: number
      try {
        added = await deps.shareMoreCards()
      } catch {
        added = 0
      }
      if (mine !== opening) return
      // NOTHING ADDED, NOTHING TO LOOK AT AGAIN: the results as they were,
      // and no request.
      if (added === 0) {
        move(results)
        return
      }
      await look(mine)
    },
    close: () => {
      opening += 1
      move({ stage: 'shut' })
    },
  }
}

/**
 * The region a locale tag names, such as `FR` in `fr-FR` or `CH` in `de_CH`,
 * or `undefined` when it names none (`deviceLocale.ts` gives the tag).
 */
export function regionOf(locale: string): string | undefined {
  const region = locale
    .split(/[-_]/)
    .slice(1)
    .find(part => /^[A-Za-z]{2}$/.test(part))
  return region?.toUpperCase()
}
