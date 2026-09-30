import { describe, expect, it } from 'vitest'

import {
  answeredSheet,
  closingClearsTheSelection,
  stageAfter,
  type OpenReport,
  type ReportStage,
} from './reportStage'

/** The sheet as « Signaler » opens it, the `opening`-th of this launch. */
function opened(opening: number, sheet: ReportStage = { stage: 'choosing' }) {
  const report: OpenReport = {
    opening,
    scope: '!room:example.org',
    eventIds: new Set(['$first', '$second']),
    author: '@bob:example.org',
    sheet,
  }
  return report
}

const SENT = { outcome: 'sent', number: 'K7QM-4ZT2' } as const

describe('Where a report stands on its sheet', () => {
  it('shows the number of a report sent, and every other outcome as a stage of its own', () => {
    expect(stageAfter(SENT)).toEqual({ stage: 'sent', number: 'K7QM-4ZT2' })
    // #491: a refusal and a selection that can no longer be reported each
    // have their own, rather than « unconfirmed ».
    for (const outcome of [
      'too-long',
      'unreportable',
      'not-sent',
      'refused',
      'unavailable',
      'unconfirmed',
    ] as const) {
      expect(stageAfter({ outcome })).toEqual({ stage: outcome })
    }
  })
})

describe('The answer to a report, and the sheet on screen (#491)', () => {
  it('puts the sheet it was sent from at the stage the answer gives', () => {
    const sending = opened(1, { stage: 'sending' })

    expect(answeredSheet(sending, 1, SENT)).toEqual({
      ...sending,
      sheet: { stage: 'sent', number: 'K7QM-4ZT2' },
    })
    expect(answeredSheet(sending, 1, { outcome: 'refused' })).toEqual({
      ...sending,
      sheet: { stage: 'refused' },
    })
  })

  it('never reaches a sheet opened after the one it was sent from', () => {
    // The first sheet sent its report and was closed while it went; a second
    // was opened on other messages. The first answer belongs to no sheet on
    // screen, and the second sheet must not show a number it never sent.
    const second = opened(2)

    expect(answeredSheet(second, 1, SENT)).toBe(second)
    expect(answeredSheet(second, 1, { outcome: 'unconfirmed' })).toBe(second)
  })

  it('opens no sheet again when the one it was sent from was closed', () => {
    expect(answeredSheet(null, 1, SENT)).toBeNull()
  })
})

describe('Closing the sheet (#491)', () => {
  it('takes the selection with it once the report is sent: it has done what it was made for', () => {
    expect(
      closingClearsTheSelection(
        opened(1, { stage: 'sent', number: 'K7QM-4ZT2' }),
      ),
    ).toBe(true)
  })

  it('leaves the selection otherwise, to send again or to do something else with', () => {
    // Closed while sending too: the report goes on without its sheet.
    for (const sheet of [
      { stage: 'choosing' },
      { stage: 'sending' },
      { stage: 'too-long' },
      { stage: 'unreportable' },
      { stage: 'not-sent' },
      { stage: 'refused' },
      { stage: 'unavailable' },
      { stage: 'unconfirmed' },
    ] as const) {
      expect(closingClearsTheSelection(opened(1, sheet)), sheet.stage).toBe(
        false,
      )
    }
    expect(closingClearsTheSelection(null)).toBe(false)
  })
})
