import type { EnvelopeKeys } from './envelopeKeys'
import { base64Of } from './receiveImage'

/**
 * Address-book discovery, as far as proving one's number and keeping it
 * proved (#397, #398, #392, ADR 0014).
 *
 * The person proves a number by a code the service sends it by SMS, and is
 * then findable for 28 days by the people who already have that number. This
 * module holds that journey: the consent, the number, the code, the proof
 * with its date, its renewal and its withdrawal, and the sentence above the
 * conversation list when a proof is about to end or has ended. The screens
 * draw the stage it shows and hand it what was typed; they decide nothing.
 *
 * # THE NUMBER LEAVES THE TELEPHONE ONCE, AND ONLY FOR THIS
 *
 * One request carries it, the one that asks for the code. Nothing before it
 * does: the consent sends nothing, « Pas maintenant » sends nothing, and a
 * number whose country is not open is refused here, before anything leaves,
 * with the sentence #392 gives it. The service keeps its mask, never the
 * number (`services/invitations/src/handlers/discovery.rs`).
 *
 * # WHAT IS INJECTED
 *
 * The transport to the service, the clock, where the proven number is kept
 * on this telephone (`keepNumber`), and this device's envelope keys, one
 * published with each proof (#405): all this part of discovery needs. The
 * tests stand them in and record every request, which is the seam #392
 * agreed for the application.
 */

/** An answer of the service: its status and its body, read as text. */
export interface Answer {
  readonly status: number
  readonly body: string
}

/**
 * The discovery routes of the invitation service, each authenticated by the
 * account's Matrix token (`servicePoster.ts`).
 */
export interface DiscoveryService {
  /** `GET /discovery/state`. */
  readonly state: () => Promise<Answer>
  /** `POST /discovery/proofs`, with the number and the language of the SMS. */
  readonly startProof: (body: string) => Promise<Answer>
  /** `POST /discovery/proofs/finish`, with the code. */
  readonly finishProof: (body: string) => Promise<Answer>
  /** `DELETE /discovery/number` (#398). */
  readonly withdraw: () => Promise<Answer>
}

export interface DiscoveryDeps {
  readonly service: DiscoveryService
  /** Milliseconds since the epoch. */
  readonly now: () => number
}

/** A country whose numbers can be proved, and who sends their SMS. */
export interface OpenCountry {
  /** ISO 3166-1 alpha-2. */
  readonly code: string
  /** The calling code, without the `+`. */
  readonly prefix: string
  readonly provider: string
}

/**
 * What the service says of discovery for this account.
 *
 * `on` is whether this service holds its masking keys and its SMS provider:
 * without them, nothing about discovery is offered, rather than offered and
 * refused later.
 */
export type DiscoveryReading =
  | { readonly read: false }
  | {
      readonly read: true
      readonly on: boolean
      /** Milliseconds, or `null` for an account that is not findable. */
      readonly findableUntil: number | null
      /**
       * Why an account that was findable is not any more, which the service
       * says for thirty days (#398).
       */
      readonly ended: Ended | null
      readonly countries: readonly OpenCountry[]
    }

/**
 * How being findable ended: the proof ran out, the number was withdrawn,
 * another account proved it since, or the key its number was masked under
 * was retired at once (#409). An ending this list does not know makes the
 * whole reading unread, so a new one reaches the application before the
 * service says it.
 */
const ENDINGS = ['expired', 'withdrawn', 'replaced', 'key-changed'] as const

export type Ended = (typeof ENDINGS)[number]

export async function readDiscovery(
  deps: DiscoveryDeps,
): Promise<DiscoveryReading> {
  let answer: Answer
  try {
    answer = await deps.service.state()
  } catch {
    return { read: false }
  }
  const body = answer.status === 200 ? parsed(answer.body) : null
  if (
    body === null ||
    typeof body.on !== 'boolean' ||
    !(
      body.findable_until === null || typeof body.findable_until === 'number'
    ) ||
    !(
      body.ended === null ||
      (ENDINGS as readonly unknown[]).includes(body.ended)
    ) ||
    !Array.isArray(body.countries) ||
    !body.countries.every(isOpenCountry)
  ) {
    return { read: false }
  }
  return {
    read: true,
    on: body.on,
    findableUntil:
      body.findable_until === null ? null : body.findable_until * 1000,
    ended: body.ended as Ended | null,
    countries: body.countries,
  }
}

/** Seven days before its end, the 21st day of 28: a proof to renew. */
const RENEW_FROM_MS = 7 * 86_400_000

/**
 * The sentence above the conversation list (#398): a proof to renew, with the
 * day it ends; one that ran out; a number that now makes another account
 * findable; a proof a key retired at once ended (#409).
 */
export type ListNotice =
  | { readonly notice: 'renew'; readonly until: number }
  | { readonly notice: 'expired' }
  | { readonly notice: 'replaced' }
  | { readonly notice: 'key-changed' }

/**
 * Which sentence, if any: a proof to renew from its 21st day and at every
 * opening, one that ran out, a number another account proved since, a key
 * retired at once (#409). A number withdrawn is said where it was withdrawn,
 * and nothing is said while discovery is off or unread.
 *
 * A PROOF WHOSE DAY HAS PASSED HAS RUN OUT, whatever the last reading said:
 * the reading is taken once a launch, and a telephone left on across the
 * deadline must not go on proposing to renew a proof that is over.
 */
export function listNotice(
  reading: DiscoveryReading,
  now: number,
): ListNotice | null {
  if (!reading.read || !reading.on) return null
  if (reading.findableUntil !== null) {
    if (reading.findableUntil <= now) return { notice: 'expired' }
    return isDueForRenewal(reading.findableUntil, now)
      ? { notice: 'renew', until: reading.findableUntil }
      : null
  }
  return reading.ended !== null && reading.ended !== 'withdrawn'
    ? { notice: reading.ended }
    : null
}

/** Whether a proof is in its last seven days, from the 21st of 28. */
export function isDueForRenewal(findableUntil: number, now: number): boolean {
  return findableUntil - now <= RENEW_FROM_MS
}

/**
 * The reading as a stage of the journey leaves it: a proof just made, or a
 * number just withdrawn, is written from the journey's own answer rather than
 * read again, since closing the journey must send nothing (#392).
 */
export function readingAfter(
  reading: DiscoveryReading,
  stage: ProofStage,
): DiscoveryReading {
  if (!reading.read) return reading
  switch (stage.stage) {
    case 'proven':
      return { ...reading, findableUntil: stage.findableUntil, ended: null }
    case 'withdrawn':
      return { ...reading, findableUntil: null, ended: 'withdrawn' }
    default:
      return reading
  }
}

/**
 * Where a typed number would go, said on the number screen before anything is
 * sent.
 *
 * The number must carry its calling code, and none is guessed: a region taken
 * from the telephone's settings is not the country of the number somebody
 * types, and a wrong guess would send a code to a stranger.
 */
export type NumberVerdict =
  | { readonly verdict: 'incomplete' }
  | { readonly verdict: 'no-country-code' }
  | { readonly verdict: 'not-a-number' }
  | { readonly verdict: 'closed' }
  | {
      readonly verdict: 'open'
      /** In international form, as the service wants it: `+33612345678`. */
      readonly number: string
      readonly country: OpenCountry
      /** Whether it is long enough to be a whole number. */
      readonly complete: boolean
    }

export function whereTheNumberGoes(
  typed: string,
  countries: readonly OpenCountry[],
): NumberVerdict {
  // « (0) » is how a number written for abroad shows the trunk prefix that
  // is not dialled from abroad: dropped, before the brackets go.
  const bare = typed.replace(/\(0\)/g, '').replace(/[\s.\-()/]/g, '')
  const international = bare.startsWith('00') ? `+${bare.slice(2)}` : bare
  if (international === '' || international === '+') {
    return { verdict: 'incomplete' }
  }
  if (!international.startsWith('+')) {
    return /^\d+$/.test(international)
      ? { verdict: 'no-country-code' }
      : { verdict: 'not-a-number' }
  }
  const digits = international.slice(1)
  if (!/^\d+$/.test(digits) || digits.startsWith('0')) {
    return { verdict: 'not-a-number' }
  }
  // Calling codes are prefix-free, so at most one open country matches, and
  // a country is known to be closed once no open calling code can still.
  const country = countries.find(c => digits.startsWith(c.prefix))
  if (country !== undefined) {
    // A trunk zero typed after the calling code, « +33 06… », is dropped: no
    // open country has a national number that starts with one.
    const national = digits.slice(country.prefix.length).replace(/^0/, '')
    const whole = `${country.prefix}${national}`
    return {
      verdict: 'open',
      number: `+${whole}`,
      country,
      complete: whole.length >= 8 && whole.length <= 15,
    }
  }
  return countries.some(c => c.prefix.startsWith(digits))
    ? { verdict: 'incomplete' }
    : { verdict: 'closed' }
}

/**
 * Why no code left for the number. Too many codes asked for by this account
 * carries when it may ask again (#399); every other refusal says only why.
 */
export type StartRefusal =
  | {
      readonly why:
        | 'closed'
        | 'no-country-code'
        | 'not-a-number'
        | 'off'
        | 'not-sent'
        | 'later'
        | 'unreachable'
    }
  | { readonly why: 'too-many'; readonly retryAt: number }

/**
 * What the number screen says of a number before anything is sent, or
 * nothing while there is nothing to say yet: the same refusal the journey
 * gives if it is sent anyway.
 */
export function numberRefusal(where: NumberVerdict): StartRefusal | null {
  switch (where.verdict) {
    case 'closed':
    case 'no-country-code':
    case 'not-a-number':
      return { why: where.verdict }
    case 'incomplete':
    case 'open':
      return null
  }
}

/** Why a number could not be withdrawn: the service did not answer. */
export type WithdrawRefusal = 'unreachable'

/** Why a code did not prove the number. */
export type FinishRefusal =
  | { readonly why: 'wrong'; readonly attemptsLeft: number }
  | { readonly why: 'expired' | 'no-proof' | 'off' | 'unreachable' }

/**
 * Whether the code in hand can prove nothing more, so that only another one
 * can: its last attempt spent, run out, or its proof gone.
 */
export function codeIsSpent(refused: FinishRefusal | null): boolean {
  if (refused === null) return false
  if (refused.why === 'wrong') return refused.attemptsLeft === 0
  return refused.why === 'expired' || refused.why === 'no-proof'
}

/**
 * Where the journey stands, one stage at a time, so that no two can be true
 * together.
 */
export type ProofStage =
  | { readonly stage: 'shut' }
  | { readonly stage: 'consent' }
  | {
      readonly stage: 'number'
      readonly countries: readonly OpenCountry[]
      /** What the field starts with: empty, or the number asked for before. */
      readonly number: string
      readonly refused: StartRefusal | null
    }
  | {
      readonly stage: 'sending'
      readonly countries: readonly OpenCountry[]
      readonly number: string
    }
  | {
      readonly stage: 'code'
      /** Where the code went, as it was sent. */
      readonly number: string
      readonly refused: FinishRefusal | null
    }
  | { readonly stage: 'proving'; readonly number: string }
  | {
      readonly stage: 'proven'
      readonly findableUntil: number
      /** The number proved, when this telephone kept it. */
      readonly number: string | null
      /** Why withdrawing it did not go through, when it did not. */
      readonly refused: WithdrawRefusal | null
    }
  | {
      readonly stage: 'withdrawing'
      readonly findableUntil: number
      readonly number: string | null
    }
  | { readonly stage: 'withdrawn' }

export interface ProofJourney {
  /**
   * The row « Être trouvable »: the consent for an account that is not
   * findable, the proof and its date for one that is. `number` is the one
   * this telephone kept, if any.
   */
  readonly open: (
    reading: DiscoveryReading & { readonly read: true },
    number: string | null,
  ) => void
  /**
   * « Renouveler la preuve », from the proof or from the sentence above the
   * list: the SMS goes to the number kept, with neither the consent nor the
   * number screen again. Without a kept number, the journey starts over.
   */
  readonly renew: (
    reading: DiscoveryReading & { readonly read: true },
    number: string | null,
  ) => Promise<void>
  /** « Retirer mon numéro »: findable no more, at once (#398). */
  readonly withdraw: () => Promise<void>
  /** « Continuer », from the consent to the number. */
  readonly consent: () => void
  /** « Pas maintenant », and every way back: nothing is sent. */
  readonly close: () => void
  /** Asks for a code by SMS, for the number typed. */
  readonly send: (typed: string) => Promise<void>
  /** Hands the code over. */
  readonly prove: (code: string) => Promise<void>
  /** Back to the number, kept, to ask for another code. */
  readonly another: () => void
}

export function proofJourney(
  deps: DiscoveryDeps & {
    /** The application's language, for the SMS. */
    readonly language: () => string
    /**
     * This device's envelope keys (#405): each proof publishes one with its
     * code, kept before it leaves (`envelopeKeys.ts`).
     */
    readonly envelope: Pick<EnvelopeKeys, 'toPublish' | 'published'>
    /**
     * Keeps the number just proved on this telephone, or forgets it once
     * withdrawn (`null`): what the row shows, and what a renewal sends to.
     */
    readonly keepNumber: (number: string | null) => Promise<void>
    /**
     * Forgets what looking for contacts found on this telephone, card names
     * included, once the number is withdrawn (#407).
     */
    readonly forgetWhatWasFound: () => Promise<void>
  },
  show: (stage: ProofStage) => void,
): ProofJourney {
  let stage: ProofStage = { stage: 'shut' }
  let countries: readonly OpenCountry[] = []
  let kept: string | null = null
  // Which opening of the journey an answer belongs to. Closing or opening
  // again moves it on, and an answer for an earlier one is dropped: a code
  // asked for and abandoned must not reopen a screen somebody left.
  let opening = 0

  const go = (next: ProofStage) => {
    stage = next
    show(next)
  }

  // Asks for a code for a number in international form, from whatever
  // stage asked: the number screen, or a renewal.
  const sendTo = async (number: string, typed: string) => {
    const mine = opening
    go({ stage: 'sending', countries, number })
    const started = await startProof(deps, number, deps.language())
    if (mine !== opening) return
    if (started.started) {
      go({ stage: 'code', number, refused: null })
    } else {
      // AS IT WAS TYPED, not as it was sent: the screen says why nothing
      // came for as long as the field still holds that number.
      go({
        stage: 'number',
        countries,
        number: typed,
        refused: started.refused,
      })
    }
  }

  const begin = (
    reading: DiscoveryReading & { readonly read: true },
    number: string | null,
  ) => {
    opening += 1
    countries = reading.countries
    kept = number
  }

  return {
    open: (reading, number) => {
      begin(reading, number)
      if (isFindable(reading, deps.now())) {
        go({
          stage: 'proven',
          findableUntil: reading.findableUntil,
          number,
          refused: null,
        })
      } else {
        go({ stage: 'consent' })
      }
    },

    renew: async (reading, number) => {
      begin(reading, number)
      if (number === null) {
        go({ stage: 'consent' })
        return
      }
      await sendTo(number, number)
    },

    withdraw: async () => {
      if (stage.stage !== 'proven') return
      const { findableUntil, number } = stage
      const mine = opening
      go({ stage: 'withdrawing', findableUntil, number })
      const withdrawn = await withdrawNumber(deps)
      if (mine !== opening) return
      if (withdrawn) {
        kept = null
        await deps.keepNumber(null)
        await deps.forgetWhatWasFound()
        if (mine !== opening) return
        go({ stage: 'withdrawn' })
      } else {
        go({ stage: 'proven', findableUntil, number, refused: 'unreachable' })
      }
    },

    consent: () => {
      if (stage.stage !== 'consent') return
      go({ stage: 'number', countries, number: kept ?? '', refused: null })
    },

    close: () => {
      opening += 1
      go({ stage: 'shut' })
    },

    send: async typed => {
      if (stage.stage !== 'number') return
      const where = whereTheNumberGoes(typed, countries)
      if (where.verdict !== 'open' || !where.complete) {
        go({
          stage: 'number',
          countries,
          number: typed,
          refused: numberRefusal(where) ?? { why: 'not-a-number' },
        })
        return
      }
      await sendTo(where.number, typed)
    },

    prove: async code => {
      if (stage.stage !== 'code') return
      const { number } = stage
      const mine = opening
      go({ stage: 'proving', number })
      // AN ENVELOPE KEY WITH THE CODE (#405), in the keystore before it
      // leaves: the service publishes it as soon as the proof holds, whether
      // or not this device hears the answer. A keystore that will not keep
      // it sends none, and invitations to this account then carry no name.
      const pair = await deps.envelope.toPublish()
      const finished = await finishProof(
        deps,
        code.trim(),
        pair?.publicKey ?? null,
      )
      // Said to the keyring even for a journey closed meanwhile: the proof
      // held at the service all the same.
      if (finished.proven && pair !== null) {
        await deps.envelope.published(pair)
      }
      if (mine !== opening) return
      if (finished.proven) {
        kept = number
        await deps.keepNumber(number)
        if (mine !== opening) return
        go({
          stage: 'proven',
          findableUntil: finished.findableUntil,
          number,
          refused: null,
        })
      } else {
        go({ stage: 'code', number, refused: finished.refused })
      }
    },

    another: () => {
      if (stage.stage !== 'code') return
      go({ stage: 'number', countries, number: stage.number, refused: null })
    },
  }
}

type Started =
  | { readonly started: true }
  | { readonly started: false; readonly refused: StartRefusal }

async function startProof(
  deps: Pick<DiscoveryDeps, 'service'>,
  number: string,
  language: string,
): Promise<Started> {
  let answer: Answer
  try {
    answer = await deps.service.startProof(JSON.stringify({ number, language }))
  } catch {
    return { started: false, refused: { why: 'unreachable' } }
  }
  if (answer.status === 200) return { started: true }
  const body = parsed(answer.body)
  if (
    body?.errcode === 'MESSAGR_TOO_MANY_CODES' &&
    typeof body.retry_at === 'number'
  ) {
    return {
      started: false,
      refused: { why: 'too-many', retryAt: body.retry_at * 1000 },
    }
  }
  const errcode = errcodeOf(body)
  return {
    started: false,
    refused: START_REFUSED[errcode] ?? { why: 'unreachable' },
  }
}

/**
 * What the service's refusals of a start mean here, but for too many codes,
 * whose refusal carries when to ask again.
 */
const START_REFUSED: Readonly<Record<string, StartRefusal>> = {
  MESSAGR_COUNTRY_CLOSED: { why: 'closed' },
  MESSAGR_NOT_A_NUMBER: { why: 'not-a-number' },
  MESSAGR_DISCOVERY_OFF: { why: 'off' },
  MESSAGR_SMS_NOT_SENT: { why: 'not-sent' },
  MESSAGR_SMS_LATER: { why: 'later' },
}

/**
 * And of a finish, but for a wrong code, whose refusal carries how many
 * attempts it leaves.
 */
const FINISH_REFUSED: Readonly<Record<string, FinishRefusal>> = {
  MESSAGR_CODE_EXPIRED: { why: 'expired' },
  MESSAGR_NO_PROOF_PENDING: { why: 'no-proof' },
  MESSAGR_DISCOVERY_OFF: { why: 'off' },
}

/** `DELETE /discovery/number`: whether the number was withdrawn. */
async function withdrawNumber(
  deps: Pick<DiscoveryDeps, 'service'>,
): Promise<boolean> {
  try {
    return (await deps.service.withdraw()).status === 204
  } catch {
    return false
  }
}

type Finished =
  | { readonly proven: true; readonly findableUntil: number }
  | { readonly proven: false; readonly refused: FinishRefusal }

async function finishProof(
  deps: DiscoveryDeps,
  code: string,
  envelopeKey: Uint8Array | null,
): Promise<Finished> {
  let answer: Answer
  try {
    answer = await deps.service.finishProof(
      JSON.stringify(
        envelopeKey === null
          ? { code }
          : { code, envelope_key: base64Of(envelopeKey) },
      ),
    )
  } catch {
    return { proven: false, refused: { why: 'unreachable' } }
  }
  const body = parsed(answer.body)
  if (answer.status === 200) {
    return body !== null && typeof body.findable_until === 'number'
      ? { proven: true, findableUntil: body.findable_until * 1000 }
      : { proven: false, refused: { why: 'unreachable' } }
  }
  if (
    body?.errcode === 'MESSAGR_CODE_WRONG' &&
    typeof body.attempts_left === 'number'
  ) {
    return {
      proven: false,
      refused: { why: 'wrong', attemptsLeft: body.attempts_left },
    }
  }
  const errcode = errcodeOf(body)
  return {
    proven: false,
    refused: FINISH_REFUSED[errcode] ?? { why: 'unreachable' },
  }
}

/** The service's name for a refusal, or nothing when the body has none. */
function errcodeOf(body: Record<string, unknown> | null): string {
  return typeof body?.errcode === 'string' ? body.errcode : ''
}

/** Whether the account a reading describes is findable at `now`. */
export function isFindable(
  reading: DiscoveryReading & { readonly read: true },
  now: number,
): reading is DiscoveryReading & {
  readonly read: true
  readonly findableUntil: number
} {
  return reading.findableUntil !== null && reading.findableUntil > now
}

/** A JSON object, or `null` for anything else a body may hold. */
export function parsed(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text)
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function isOpenCountry(value: unknown): value is OpenCountry {
  if (typeof value !== 'object' || value === null) return false
  const { code, prefix, provider } = value as Record<string, unknown>
  return (
    typeof code === 'string' &&
    typeof prefix === 'string' &&
    typeof provider === 'string'
  )
}
