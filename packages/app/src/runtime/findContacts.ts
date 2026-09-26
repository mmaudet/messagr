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
 * # WHAT IS INJECTED
 *
 * The reading of the address book, the masking, the transport to the service,
 * and the telephone's region, for numbers written without their country
 * code. The tests stand them in and record every request.
 */
import {
  isSupportedCountry,
  parsePhoneNumberFromString,
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
}

/** A contact whose number a findable account proved, and that account. */
export interface Match {
  readonly contact: Contact
  /** What the service knows the account by, and nobody else can link to it. */
  readonly reference: string
}

export type Findings =
  | {
      readonly found: true
      /** By name. */
      readonly matches: readonly Match[]
      /** The contacts not on Messagr, or not findable, by name. */
      readonly others: readonly Contact[]
      /**
       * The contacts the limit on masking left for later (#401), and when it
       * frees, in milliseconds; `null` when every number was masked.
       */
      readonly waiting: Waiting | null
    }
  | { readonly found: false; readonly refusal: FindingRefusal }

/**
 * What the limit on masking left for later (#401): how many contacts hold a
 * number not masked yet, and when the service masks again.
 */
export interface Waiting {
  readonly contacts: number
  /** Milliseconds since the epoch. */
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
  const holders = numbersOf(contacts, deps.region())
  if (holders.size === 0) {
    return { found: true, matches: [], others: byName(contacts), waiting: null }
  }

  const key = await currentKey(deps.service)
  if (typeof key === 'string') return { found: false, refusal: key }

  const numbers = [...holders.keys()]
  const masks = new Map<string, string>()
  // THE LIMIT OF #401: a batch over it is refused with how many numbers are
  // still allowed. Those are sent again, the first of the batch, and the
  // rest wait for the window to free. Nothing here depends on a comparison:
  // what is sent follows the address book and the limit, never the matches.
  let freesAt: number | null = null
  for (let at = 0; at < numbers.length && freesAt === null; at += BATCH) {
    const batch = numbers.slice(at, at + BATCH)
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

  // WITH NOTHING MASKED, the directory has nothing to be compared with.
  const listed =
    masks.size === 0
      ? new Map<string, string>()
      : await directoryOf(deps.service, key.keyNumber)
  if (typeof listed === 'string') return { found: false, refusal: listed }

  const matched = new Map<Contact, string>()
  for (const [number, mask] of masks) {
    const reference = listed.get(mask)
    if (reference === undefined) continue
    for (const contact of holders.get(number)!) {
      if (!matched.has(contact)) matched.set(contact, reference)
    }
  }
  const waitingContacts = contacts.filter(
    contact =>
      !matched.has(contact) &&
      [...holders]
        .filter(([, held]) => held.includes(contact))
        .some(([number]) => !masks.has(number)),
  ).length
  return {
    found: true,
    matches: byName([...matched.keys()]).map(contact => ({
      contact,
      reference: matched.get(contact)!,
    })),
    others: byName(contacts.filter(contact => !matched.has(contact))),
    waiting:
      freesAt !== null && waitingContacts > 0
        ? { contacts: waitingContacts, freesAt }
        : null,
  }
}

/**
 * Every number of the address book in international form, each once, with
 * the contacts that hold it. A number that is not one is left out.
 */
function numbersOf(
  contacts: readonly Contact[],
  region: string | undefined,
): Map<string, Contact[]> {
  // A region the library does not know is no region: numbers written without
  // their country code are then left aside, as without one.
  const known =
    region !== undefined && isSupportedCountry(region) ? region : undefined
  const holders = new Map<string, Contact[]>()
  for (const contact of contacts) {
    for (const written of contact.numbers) {
      const number = parsePhoneNumberFromString(written, known)
      if (number === undefined || !number.isValid()) continue
      const held = holders.get(number.number) ?? []
      if (!held.includes(contact)) held.push(contact)
      holders.set(number.number, held)
    }
  }
  return holders
}

interface Key {
  readonly keyNumber: number
  readonly publicKey: Uint8Array
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
  | { readonly masks: string[] }
  | { readonly limit: { readonly remaining: number; readonly freesAt: number } }
  | FindingRefusal
> {
  const blinding = await deps.masking.blind(
    numbers.map(number => Uint8Array.from(number, c => c.charCodeAt(0))),
  )
  const answer = await asked(() =>
    deps.service.maskBatch(
      JSON.stringify({
        key_number: key.keyNumber,
        blinded: blinding.blindedElements.map(base64Of),
      }),
    ),
  )
  if (typeof answer === 'string') return answer
  if (answer.errcode === 'MESSAGR_MASKING_QUOTA') {
    const { remaining, frees_at: freesAt } = answer
    return typeof remaining === 'number' && typeof freesAt === 'number'
      ? { limit: { remaining, freesAt: freesAt * 1000 } }
      : 'unreachable'
  }
  const { evaluated, batch_proof: batchProof } = answer
  if (
    answer.key_number !== key.keyNumber ||
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

/** The directory, as the masks under the key and the reference of each. */
async function directoryOf(
  service: FindingService,
  keyNumber: number,
): Promise<Map<string, string> | FindingRefusal> {
  const answer = await asked(() => service.directory())
  if (typeof answer === 'string') return answer
  if (!Array.isArray(answer.entries)) return 'unreachable'
  const listed = new Map<string, string>()
  for (const entry of answer.entries as Record<string, unknown>[]) {
    if (
      entry.key_number === keyNumber &&
      typeof entry.mask === 'string' &&
      typeof entry.reference === 'string'
    ) {
      listed.set(entry.mask, entry.reference)
    }
  }
  return listed
}

/** A request, and its answer read: its body, or why there is none. */
async function asked(
  request: () => Promise<Answer>,
): Promise<Record<string, unknown> | FindingRefusal> {
  let answer: Answer
  try {
    answer = await request()
  } catch {
    return 'unreachable'
  }
  const body = parsed(answer.body)
  if (answer.status === 200 && body !== null) return body
  // The limit of #401 is not a refusal of the search: its body says how many
  // numbers are still allowed, which `maskBatch` reads.
  if (answer.status === 429 && body?.errcode === 'MESSAGR_MASKING_QUOTA') {
    return body
  }
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
 *   others;
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
      readonly others: readonly Contact[]
      readonly waiting: Waiting | null
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
  return {
    open: () => {
      opening += 1
      move({ stage: 'reminder' })
    },
    go: async () => {
      if (stage.stage !== 'reminder') return
      const mine = opening
      // Leaving the reminder at once, so that a second press finds another
      // stage and does nothing.
      move({ stage: 'looking' })
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
            }
          : { stage: 'refused', why: findings.refusal },
      )
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
