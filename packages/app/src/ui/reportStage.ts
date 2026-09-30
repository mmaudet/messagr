import type { Reported } from '../runtime/reportMessages'

/**
 * Where a report stands while its sheet is up (#468, #491), and the two
 * rules the main screen applies to it: an answer reaches only the sheet it
 * was sent from, and closing takes the selection with it only once the
 * report is sent.
 *
 * They were written inline in `App.tsx`, where nothing could test them
 * (#491). They are here, pure, and `App.tsx` calls them.
 */

/** Where a report stands, as the sheet shows it. */
export type ReportStage =
  | { readonly stage: 'choosing' }
  | { readonly stage: 'sending' }
  | { readonly stage: 'sent'; readonly number: string }
  | { readonly stage: 'too-long' }
  | { readonly stage: 'unreportable' }
  | { readonly stage: 'not-sent' }
  | { readonly stage: 'refused' }
  | { readonly stage: 'unavailable' }
  | { readonly stage: 'unconfirmed' }

/**
 * The report being prepared, while its sheet is up: the conversation and the
 * messages it carries, taken from the selection when « Signaler » was
 * pressed, their one author, and where the sheet stands.
 */
export interface OpenReport {
  /**
   * Which opening of the sheet this is, counted from the launch. It tells
   * one sheet from the next: a sheet may close while its report is being
   * sent, and another open before the answer comes back.
   */
  readonly opening: number
  /** The conversation's Matrix room. */
  readonly scope: string
  /** The event IDs of the messages chosen. */
  readonly eventIds: ReadonlySet<string>
  /** The account the homeserver attributes them to. */
  readonly author: string
  readonly sheet: ReportStage
}

/** The stage a report's outcome puts the sheet at. */
export function stageAfter(reported: Reported): ReportStage {
  return reported.outcome === 'sent'
    ? { stage: 'sent', number: reported.number }
    : { stage: reported.outcome }
}

/**
 * The sheet on screen once the answer to the report sent from the
 * `from`-th opening comes back: that sheet at the stage the answer gives, if
 * it is still the one up. Otherwise the sheet on screen, untouched, or none:
 * the answer belongs to a sheet that was closed, and a sheet opened since
 * must not show a number it never sent.
 */
export function answeredSheet(
  now: OpenReport | null,
  from: number,
  reported: Reported,
): OpenReport | null {
  return now?.opening === from ? { ...now, sheet: stageAfter(reported) } : now
}

/**
 * Whether closing the sheet `now` takes the selection with it: its own
 * buttons, its scrim, or back. Once the report is sent, the selection mode
 * has done what it was opened for. Otherwise the selection stays, to send
 * again or to do something else with, as the removal sheet leaves it; closed
 * while sending too, since the report goes on without its sheet.
 */
export function closingClearsTheSelection(now: OpenReport | null): boolean {
  return now?.sheet.stage === 'sent'
}
