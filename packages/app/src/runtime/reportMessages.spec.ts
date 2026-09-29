import { describe, expect, it } from 'vitest'

import type { TimelineEntry } from '../timeline/mergeTimeline'
import { payloadOf, type ReportBinding } from './reportFormat'
import {
  REPORT_REASONS,
  reportMessages,
  type Reporting,
  type Selection,
} from './reportMessages'

const ME = '@alice:example.org'
const HIM = '@bob:example.org'
const SOMEBODY_ELSE = '@carol:example.org'
const ROOM = '!room:example.org'
const NOW = 1_790_000_060_000

function said(
  eventId: string,
  sender: string,
  sentAt: number,
  body: string,
): TimelineEntry {
  return { eventId, claimedSender: sender, sentAt, body }
}

/** A conversation of three people, as the screen shows it. */
const TIMELINE: readonly TimelineEntry[] = [
  said('$mine', ME, 1_790_000_000_000, 'Bonjour à tous.'),
  said('$first', HIM, 1_790_000_010_000, 'Tu vas le regretter.'),
  said('$other', SOMEBODY_ELSE, 1_790_000_015_000, 'Calmez-vous.'),
  said('$second', HIM, 1_790_000_020_000, 'Réponds.\nMaintenant.'),
  said('$later', HIM, 1_790_000_030_000, 'Laisse tomber.'),
]

/** Reporting `$second` and `$first`, chosen in that order, as harassment. */
const SELECTION: Selection = {
  reporter: ME,
  roomId: ROOM,
  reason: 'harassment',
  selected: new Set(['$second', '$first']),
  timeline: TIMELINE,
}

/**
 * A device reporting, and what it did: what it sealed and for what binding,
 * and what it sent. The seal is a double that names what it sealed, so a
 * test reads the payload back with the format's own reader.
 */
function device(
  answer: { readonly status: number; readonly body: string } | 'unreachable' = {
    status: 201,
    body: '{"number":"K7QM-4ZT2"}',
  },
  seal: 'refuses' | 'seals' = 'seals',
) {
  const sealed: { payload: Uint8Array; binding: ReportBinding }[] = []
  const sent: string[] = []
  const reporting: Reporting = {
    seal: (payload, binding) => {
      if (seal === 'refuses') throw new RangeError('reporter: not ASCII')
      sealed.push({ payload, binding })
      return 'THE-SEALED-REPORT'
    },
    service: {
      send: async body => {
        sent.push(body)
        if (answer === 'unreachable') throw new Error('network unreachable')
        return answer
      },
    },
    now: () => NOW,
  }
  return { reporting, sealed, sent }
}

describe('Reporting messages to the operator (#468)', () => {
  it('offers the eight reasons of the terms, by the codes the service takes', () => {
    // #462, one per prohibition of the terms, in their order.
    expect(REPORT_REASONS).toEqual([
      'child_sexual_abuse',
      'threat',
      'harassment',
      'impersonation',
      'hate',
      'sexual_without_consent',
      'solicitation',
      'other_illegal',
    ])
  })

  it('seals the selected messages as read, from their one author, and nothing else of the conversation', async () => {
    const { reporting, sealed } = device()

    await reportMessages(reporting, SELECTION)

    expect(sealed).toHaveLength(1)
    expect(payloadOf(sealed[0]!.payload)).toEqual({
      reason: 'harassment',
      reportedAt: NOW,
      reportingAccount: ME,
      reportedAccount: HIM,
      roomId: ROOM,
      // In the order the conversation reads them, whatever the order they
      // were chosen in.
      messages: [
        {
          eventId: '$first',
          sentAt: 1_790_000_010_000,
          sender: HIM,
          text: 'Tu vas le regretter.',
        },
        {
          eventId: '$second',
          sentAt: 1_790_000_020_000,
          sender: HIM,
          text: 'Réponds.\nMaintenant.',
        },
      ],
    })
    const everything = new TextDecoder().decode(sealed[0]!.payload)
    for (const left of [
      '$mine',
      'Bonjour',
      '$other',
      'Calmez',
      SOMEBODY_ELSE,
      '$later',
      'Laisse',
    ]) {
      expect(everything).not.toContain(left)
    }
  })

  it('binds the seal to the reason and to this account’s own ID', async () => {
    // The two fields the service keeps unsealed: the reporting account is
    // the ID the service's whoami names this account's token for.
    const { reporting, sealed } = device()

    await reportMessages(reporting, { ...SELECTION, reason: 'threat' })

    expect(sealed.map(one => one.binding)).toEqual([
      { reason: 'threat', reporter: ME },
    ])
  })

  it('sends the reason and the sealed report, and nothing else', async () => {
    // The service learns neither the reported account, nor the
    // conversation, nor the messages: they are sealed.
    const { reporting, sent } = device()

    await reportMessages(reporting, SELECTION)

    expect(sent.map(body => JSON.parse(body) as unknown)).toEqual([
      { reason: 'harassment', sealed: 'THE-SEALED-REPORT' },
    ])
  })

  it('answers the report number the service gives', async () => {
    const { reporting } = device()

    expect(await reportMessages(reporting, SELECTION)).toEqual({
      sent: true,
      number: 'K7QM-4ZT2',
    })
  })

  it('seals and sends nothing when the messages are not one other person’s texts', async () => {
    for (const selected of [
      new Set(['$first', '$other']),
      new Set(['$mine']),
      new Set(['$mine', '$first']),
      new Set(['$first', '$gone']),
      new Set<string>(),
    ]) {
      const { reporting, sealed, sent } = device()

      expect(
        await reportMessages(reporting, { ...SELECTION, selected }),
      ).toEqual({ sent: false })
      expect(sealed).toEqual([])
      expect(sent).toEqual([])
    }
  })

  it('sends nothing when the seal refuses its binding', async () => {
    const { reporting, sent } = device(undefined, 'refuses')

    expect(await reportMessages(reporting, SELECTION)).toEqual({ sent: false })
    expect(sent).toEqual([])
  })

  it('is not sent when the service refuses it, cannot be reached, or gives no number', async () => {
    for (const answer of [
      { status: 400, body: '{"errcode":"M_INVALID_PARAM"}' },
      { status: 401, body: '{"errcode":"M_UNAUTHORIZED"}' },
      { status: 404, body: '{"errcode":"M_UNRECOGNIZED"}' },
      { status: 500, body: '{"errcode":"M_UNKNOWN"}' },
      { status: 201, body: '{}' },
      { status: 201, body: 'not json' },
      'unreachable' as const,
    ]) {
      const { reporting } = device(answer)

      expect(await reportMessages(reporting, SELECTION)).toEqual({
        sent: false,
      })
    }
  })
})
