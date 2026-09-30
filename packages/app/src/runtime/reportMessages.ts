import type { TimelineEntry } from '../timeline/mergeTimeline'
import { reportable } from '../timeline/selection'
import {
  MOST_PAYLOAD_BYTES,
  payloadBytes,
  type ReportBinding,
  type ReportReason,
} from './reportFormat'
import { parsed, type Answer } from './serviceAnswer'

/**
 * Reporting messages to the operator, from a conversation (#468, ADR 0015,
 * the glossary's « Report »).
 *
 * The person selects messages of one other participant, chooses a reason
 * among what the terms forbid, reads what leaves, and sends. This module
 * assembles the report in memory, seals it for the operator key, sends it to
 * the invitation service, and says what became of it.
 *
 * # IN MEMORY, AND SEALED BEFORE IT LEAVES
 *
 * ADR 0006: nothing decrypted is written to disk, and a report is made of
 * decrypted messages. The payload is built here, sealed here, and only the
 * sealed report leaves, beside the reason's code. Neither is kept on this
 * device: the report number is all the person keeps, on screen.
 *
 * What it carries is `reportable`'s, the one definition the selection bar
 * and the sheet read too: nothing leaves that was not shown. A photograph or
 * a document is in it as the description of its encrypted file, the key to
 * a copy already on the server, never as its bytes (#471): nothing is
 * downloaded, decrypted, written or uploaded to make a report, and what is
 * handed to this module could not do any of it.
 *
 * # WHAT THE SERVICE LEARNS, AND WHAT IT DOES NOT
 *
 * The reason, and the reporting account, which is the token's. Not the
 * reported account, nor the conversation, nor the messages: they are inside
 * the seal (`reportFormat.ts` lays the payload out), which the operator opens
 * on its own machine.
 *
 * THE SEAL BINDS THE ACCOUNT AS THE SERVICE WILL KEEP IT: the reason, and the
 * account ID exactly as the homeserver's `whoami` answers for this token,
 * which is what the service asks the homeserver and keeps. So it is asked
 * here, just before sealing, rather than read from what a login or a claim
 * once gave this device: a report kept under an account ID spelled otherwise
 * would not open.
 *
 * # OUTCOMES, AND WHY A FAILURE SAYS « PERHAPS »
 *
 * Sent, with the report number the service drew. Too long, when the report
 * is more than the service takes (`MOST_PAYLOAD_BYTES`): nothing is sealed
 * or sent, and fewer messages would go. Unreportable, when what was chosen
 * is no longer a report `reportable` makes, a message removed while the
 * sheet was open for one: nothing is sealed or sent. Not sent, when the
 * homeserver's `whoami` does not name the account, or not in time, or the
 * seal refuses what it named: nothing is sealed or sent, and it can be sent
 * again. Refused, when the service answers 400 or 401: it refuses before
 * keeping anything (`handlers/reports.rs`), and would refuse the same
 * request again (#491). Unavailable, when the service answers 503: it could
 * not ask its own homeserver who the token is, and kept nothing; it can be
 * sent again (`auth.rs`). Otherwise unconfirmed: no number came back, which
 * cannot tell a report never sent from one kept whose answer was lost, or
 * that did not come in `ANSWER_DEADLINE_MS`.
 *
 * Each of the two requests has that deadline: the homeserver's `whoami`,
 * asked just before sealing, as much as the service's answer. Without it,
 * a network that takes the question and never answers keeps « Envoi… » on
 * the sheet for ever (#491).
 *
 * Sending it again is safe either way: each report goes under an
 * idempotency key (`keysInMemory`), the same for every attempt of the same
 * report, and the service keeps a report once per key, answering the same
 * number to a second attempt. The reported messages stay on screen whatever
 * happens: reporting removes nothing.
 */

/** The report route of the invitation service (`servicePoster.ts`). */
export interface ReportService {
  /**
   * `POST /reports`, with the reason's code and the sealed report, under the
   * report's idempotency key.
   */
  readonly send: (body: string, idempotencyKey: string) => Promise<Answer>
}

/** What reporting needs, so that the whole of it is testable without a device. */
export interface Reporting {
  readonly service: ReportService
  /**
   * The account ID exactly as the account's own homeserver answers `whoami`
   * for its token. Throws when it does not answer, and then nothing leaves,
   * as when it has not answered within `ANSWER_DEADLINE_MS`.
   */
  readonly whoami: () => Promise<string>
  /**
   * Seals a payload for the operator key, bound to the reason and the
   * reporting account: `sealReport` (`sealedReport.ts`). Throws for a
   * binding the format cannot carry, and then nothing leaves.
   */
  readonly seal: (payload: Uint8Array, binding: ReportBinding) => string
  /** The idempotency key of a report: see `keysInMemory`. */
  readonly keyOf: (report: string) => string
  /** Now, in milliseconds since the epoch. */
  readonly now: () => number
  /** Resolves after `ms`: how long the service is given to answer. */
  readonly after: (ms: number) => Promise<void>
}

/** What the person reports, in the conversation they are reading. */
export interface ReportRequest {
  /** The account ID this device holds: its own messages are not reported. */
  readonly self: string
  /** The conversation's Matrix room. */
  readonly roomId: string
  readonly reason: ReportReason
  /** The event IDs of the messages selected. */
  readonly selected: ReadonlySet<string>
  /** The conversation, as the screen shows it. */
  readonly timeline: readonly TimelineEntry[]
}

/** What became of a report. */
export type Reported =
  | { readonly outcome: 'sent'; readonly number: string }
  | { readonly outcome: 'too-long' }
  | { readonly outcome: 'unreportable' }
  | { readonly outcome: 'not-sent' }
  | { readonly outcome: 'refused' }
  | { readonly outcome: 'unavailable' }
  | { readonly outcome: 'unconfirmed' }

/**
 * How long the homeserver and the service are each given to answer. They
 * answer at once when they answer; this is for a network that takes the
 * request and never gives anything back, which React Native's `fetch` would
 * wait on for ever.
 */
export const ANSWER_DEADLINE_MS = 30_000

/**
 * What the service answers a request it will never take: one it does not
 * read as a report (400), or one whose token it does not take (401). It
 * answers them before keeping anything.
 */
const REFUSALS: ReadonlySet<number> = new Set([400, 401])

/**
 * What the service answers when it cannot take a request for now, and has
 * kept nothing of it: when its own homeserver does not answer who the token
 * is (`auth.rs`, `HomeserverUnavailable`).
 */
const UNAVAILABLE = 503

const UNCONFIRMED: Reported = { outcome: 'unconfirmed' }
const NOT_SENT: Reported = { outcome: 'not-sent' }

/**
 * Reports what `request` selects to the operator, and answers what became
 * of it (see the module).
 *
 * Nothing is sealed when the selection is not a report `reportable` makes:
 * the screen offers none, and this does not rely on it.
 */
export async function reportMessages(
  deps: Reporting,
  request: ReportRequest,
): Promise<Reported> {
  const carried = reportable(request.selected, request.timeline, request.self)
  if (carried === null) return { outcome: 'unreportable' }

  // NOTHING HAS LEFT YET: the homeserver was only asked who this is.
  const reporter = await answeredInTime(deps, deps.whoami)
  if (reporter === null) return NOT_SENT
  const payload = payloadBytes({
    reason: request.reason,
    reportedAt: deps.now(),
    reportingAccount: reporter,
    reportedAccount: carried.author,
    roomId: request.roomId,
    messages: carried.messages,
  })
  if (payload.length > MOST_PAYLOAD_BYTES) return { outcome: 'too-long' }

  let sealed: string
  try {
    sealed = deps.seal(payload, { reason: request.reason, reporter })
  } catch {
    return NOT_SENT
  }

  const answer = await answeredInTime(deps, () =>
    deps.service.send(
      JSON.stringify({ reason: request.reason, sealed }),
      deps.keyOf(sameReport(request)),
    ),
  )
  if (answer !== null && REFUSALS.has(answer.status)) {
    return { outcome: 'refused' }
  }
  if (answer?.status === UNAVAILABLE) return { outcome: 'unavailable' }
  // 201 AND A NUMBER: the service answers the one only with the other
  // (`handlers/reports.rs`), a second attempt of the same report included.
  const number = answer?.status === 201 ? parsed(answer.body)?.number : null
  return typeof number === 'string' ? { outcome: 'sent', number } : UNCONFIRMED
}

/**
 * Keys drawn by `draw`, one per report and the same for every attempt of it,
 * held in memory for as long as the application runs: « Réessayer », or the
 * same messages reported again for the same reason after the sheet was
 * closed, goes under the key of the first attempt. A report is named by what
 * makes it the same (`sameReport`), and nothing of it is written anywhere.
 */
export function keysInMemory(draw: () => string): (report: string) => string {
  const keys = new Map<string, string>()
  return report => {
    const held = keys.get(report)
    if (held !== undefined) return held
    const drawn = draw()
    keys.set(report, drawn)
    return drawn
  }
}

/**
 * A report's idempotency key: sixteen random bytes, in hexadecimal. Drawn,
 * and not made from the report, so that it says nothing of it.
 */
export function drawnKey(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), byte =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}

/**
 * What makes two attempts the same report: the conversation, the reason,
 * and the messages, whatever the order they were chosen in.
 */
function sameReport(request: ReportRequest): string {
  return [request.roomId, request.reason, ...[...request.selected].sort()].join(
    '\n',
  )
}

/**
 * The answer `request` gets, or `null` when nothing came back: a network
 * that failed, or one that did not answer within `ANSWER_DEADLINE_MS`.
 */
async function answeredInTime<T>(
  deps: Reporting,
  request: () => Promise<T>,
): Promise<T | null> {
  try {
    return await Promise.race([
      request(),
      deps.after(ANSWER_DEADLINE_MS).then(() => null),
    ])
  } catch {
    return null
  }
}
