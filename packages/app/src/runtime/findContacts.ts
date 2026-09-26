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
  parsePhoneNumberFromString,
  type CountryCode,
} from 'libphonenumber-js/min'

import { bytesOf } from './base64'
import type { Answer } from './discovery'
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
   * Checks the batch proof against `publicKey`, then unblinds: rejects with
   * the kind `proof_rejected` when the proof does not verify.
   */
  readonly finalize: (
    blinding: Blinding,
    evaluationElements: readonly Uint8Array[],
    batchProof: Uint8Array,
    publicKey: Uint8Array,
  ) => Promise<Uint8Array[]>
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
   * none, and such a number is then left aside rather than guessed at.
   */
  readonly region: string | undefined
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
    }
  | { readonly found: false; readonly refusal: FindingRefusal }

/**
 * Why the contacts could not be looked for:
 * - `not-findable`: this account has no current proof, and proves its
 *   number first;
 * - `proof-rejected`: an answer did not prove it came from the published
 *   key. Nothing is shown, and the search says so;
 * - `off`: this service does not serve discovery;
 * - `unreachable`: the service could not be reached, or answered something
 *   else than it should.
 */
export type FindingRefusal =
  'not-findable' | 'proof-rejected' | 'off' | 'unreachable'

/**
 * The most numbers one request carries: what the service accepts in one
 * batch (`services/invitations/src/handlers/discovery.rs`).
 */
const BATCH = 5_000

export async function findContacts(deps: FindingDeps): Promise<Findings> {
  const contacts = await deps.readAddressBook()
  const holders = numbersOf(contacts, deps.region)
  if (holders.size === 0) {
    return { found: true, matches: [], others: byName(contacts) }
  }

  const key = await currentKey(deps.service)
  if (typeof key === 'string') return { found: false, refusal: key }

  const numbers = [...holders.keys()]
  const masks = new Map<string, string>()
  for (let at = 0; at < numbers.length; at += BATCH) {
    const batch = numbers.slice(at, at + BATCH)
    const masked = await maskBatch(deps, key, batch)
    if (typeof masked === 'string') return { found: false, refusal: masked }
    batch.forEach((number, i) => masks.set(number, masked[i]!))
  }

  const listed = await directoryOf(deps.service, key.number)
  if (typeof listed === 'string') return { found: false, refusal: listed }

  const matched = new Map<Contact, string>()
  for (const [number, mask] of masks) {
    const reference = listed.get(mask)
    if (reference === undefined) continue
    for (const contact of holders.get(number)!) {
      if (!matched.has(contact)) matched.set(contact, reference)
    }
  }
  return {
    found: true,
    matches: byName([...matched.keys()]).map(contact => ({
      contact,
      reference: matched.get(contact)!,
    })),
    others: byName(contacts.filter(contact => !matched.has(contact))),
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
  const holders = new Map<string, Contact[]>()
  for (const contact of contacts) {
    for (const written of contact.numbers) {
      const number = parsePhoneNumberFromString(
        written,
        region as CountryCode | undefined,
      )
      if (number === undefined || !number.isValid()) continue
      const held = holders.get(number.number) ?? []
      if (!held.includes(contact)) held.push(contact)
      holders.set(number.number, held)
    }
  }
  return holders
}

interface Key {
  readonly number: number
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
  return { number: last.key_number, publicKey: bytesOf(last.public_key) }
}

/** One batch, masked: each number's mask, in base64, in the same order. */
async function maskBatch(
  deps: FindingDeps,
  key: Key,
  numbers: readonly string[],
): Promise<string[] | FindingRefusal> {
  const blinding = await deps.masking.blind(
    numbers.map(number => Uint8Array.from(number, c => c.charCodeAt(0))),
  )
  const answer = await asked(() =>
    deps.service.maskBatch(
      JSON.stringify({
        key_number: key.number,
        blinded: blinding.blindedElements.map(base64Of),
      }),
    ),
  )
  if (typeof answer === 'string') return answer
  const { evaluated, batch_proof: batchProof } = answer
  if (
    answer.key_number !== key.number ||
    !Array.isArray(evaluated) ||
    evaluated.length !== numbers.length ||
    !evaluated.every(e => typeof e === 'string') ||
    typeof batchProof !== 'string'
  ) {
    return 'unreachable'
  }
  try {
    const masks = await deps.masking.finalize(
      blinding,
      (evaluated as string[]).map(bytesOf),
      bytesOf(batchProof),
      key.publicKey,
    )
    return masks.map(base64Of)
  } catch (e) {
    return kindOf(e) === 'proof_rejected' ? 'proof-rejected' : 'unreachable'
  }
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
  if (answer.status === 403 && body?.errcode === 'MESSAGR_NOT_FINDABLE') {
    return 'not-findable'
  }
  if (answer.status === 503 && body?.errcode === 'MESSAGR_DISCOVERY_OFF') {
    return 'off'
  }
  return 'unreachable'
}

function parsed(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text)
    return typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function kindOf(e: unknown): unknown {
  return typeof e === 'object' && e !== null
    ? (e as { kind?: unknown }).kind
    : undefined
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
    }
  | {
      readonly stage: 'refused'
      readonly why: 'no-access' | FindingRefusal
    }

export interface FindingJourney {
  /** « Retrouver mes contacts », for a findable account: the reminder. */
  readonly open: () => void
  /** « Continuer »: the system's question, then the search. */
  readonly go: () => Promise<void>
  /** Every way back. A search still running is dropped. */
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
    readonly askForTheAddressBook: () => Promise<'all' | 'some' | 'none'>
  },
  show: (stage: FindingStage) => void,
): FindingJourney {
  // Which opening an answer belongs to: closing moves it on, and a search
  // that ends after its screen was left shows nothing.
  let opening = 0
  return {
    open: () => {
      opening += 1
      show({ stage: 'reminder' })
    },
    go: async () => {
      const mine = opening
      const access = await deps.askForTheAddressBook()
      if (mine !== opening) return
      if (access === 'none') {
        show({ stage: 'refused', why: 'no-access' })
        return
      }
      show({ stage: 'looking' })
      let findings: Findings
      try {
        findings = await findContacts(deps)
      } catch {
        findings = { found: false, refusal: 'unreachable' }
      }
      if (mine !== opening) return
      show(
        findings.found
          ? {
              stage: 'found',
              matches: findings.matches,
              others: findings.others,
            }
          : { stage: 'refused', why: findings.refusal },
      )
    },
    close: () => {
      opening += 1
      show({ stage: 'shut' })
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
