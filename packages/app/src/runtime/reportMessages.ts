import type { TimelineEntry } from '../timeline/mergeTimeline'
import { reportedAuthor } from '../timeline/selection'
import { parsed, type Answer } from './discovery'
import {
  payloadBytes,
  type ReportBinding,
  type ReportedMessage,
} from './reportFormat'

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
 * # WHAT THE SERVICE LEARNS, AND WHAT IT DOES NOT
 *
 * The reason, and the reporting account, which is the token's. Not the
 * reported account, nor the conversation, nor the messages: they are inside
 * the seal (`reportFormat.ts` lays the payload out), which the operator opens
 * on its own machine. The seal binds the reason and the reporting account's
 * ID, so a report the service kept under others does not open: the ID bound
 * is the one this device holds, which the homeserver gave at login and names
 * again when the service asks it whose token this is.
 *
 * # TWO OUTCOMES, AND NOTHING IN BETWEEN
 *
 * Sent, with the report number the service drew, or not sent. Not sent means
 * the service kept nothing: it refused, or nothing reached it. One case
 * escapes that, an answer lost after the service kept the report; sending
 * again then makes a second report, which the operator reads as such. The
 * reported messages stay on screen either way: reporting removes nothing.
 */

/**
 * The eight reasons of the terms, in their order, by the codes the service
 * takes (`services/invitations/src/report.rs`).
 */
export const REPORT_REASONS = [
  'child_sexual_abuse',
  'threat',
  'harassment',
  'impersonation',
  'hate',
  'sexual_without_consent',
  'solicitation',
  'other_illegal',
] as const

export type ReportReason = (typeof REPORT_REASONS)[number]

/** The report route of the invitation service (`servicePoster.ts`). */
export interface ReportService {
  /** `POST /reports`, with the reason's code and the sealed report. */
  readonly send: (body: string) => Promise<Answer>
}

/** What reporting needs, so that the whole of it is testable without a device. */
export interface Reporting {
  readonly service: ReportService
  /**
   * Seals a payload for the operator key, bound to the reason and the
   * reporting account: `sealReport` (`sealedReport.ts`). Throws for a
   * binding the format cannot carry, and then nothing leaves.
   */
  readonly seal: (payload: Uint8Array, binding: ReportBinding) => string
  /** Now, in milliseconds since the epoch. */
  readonly now: () => number
}

/** What the person reports, in the conversation they are reading. */
export interface Selection {
  /** The account ID this device holds, which reports. */
  readonly reporter: string
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
  { readonly sent: true; readonly number: string } | { readonly sent: false }

const NOT_SENT: Reported = { sent: false }

/**
 * Reports `what` to the operator, and answers the report number, or that
 * nothing was sent.
 *
 * Refused before anything is sealed when the selection is not texts of one
 * other participant, the rule that shows « Signaler » (`reportedAuthor`): the
 * screen offers nothing else, and this does not rely on it.
 */
export async function reportMessages(
  deps: Reporting,
  what: Selection,
): Promise<Reported> {
  const author = reportedAuthor(what.selected, what.timeline, what.reporter)
  if (author === null) return NOT_SENT
  const messages = what.timeline.flatMap((entry): ReportedMessage[] =>
    what.selected.has(entry.eventId) && entry.body !== null
      ? [
          {
            eventId: entry.eventId,
            sentAt: entry.sentAt,
            sender: entry.claimedSender,
            text: entry.body,
          },
        ]
      : [],
  )

  let sealed: string
  try {
    sealed = deps.seal(
      payloadBytes({
        reason: what.reason,
        reportedAt: deps.now(),
        reportingAccount: what.reporter,
        reportedAccount: author,
        roomId: what.roomId,
        messages,
      }),
      { reason: what.reason, reporter: what.reporter },
    )
  } catch {
    return NOT_SENT
  }

  let answer: Answer
  try {
    answer = await deps.service.send(
      JSON.stringify({ reason: what.reason, sealed }),
    )
  } catch {
    return NOT_SENT
  }
  // 201 AND A NUMBER: the service answers the one only with the other
  // (`handlers/reports.rs`), and anything else kept nothing.
  const number = answer.status === 201 ? parsed(answer.body)?.number : null
  return typeof number === 'string' ? { sent: true, number } : NOT_SENT
}
