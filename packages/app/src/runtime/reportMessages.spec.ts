import { describe, expect, it } from 'vitest'

import type { TimelineEntry } from '../timeline/mergeTimeline'
import {
  MOST_PAYLOAD_BYTES,
  payloadOf,
  type ReportBinding,
} from './reportFormat'
import {
  ANSWER_DEADLINE_MS,
  drawnKey,
  keysInMemory,
  reportMessages,
  type Reporting,
  type ReportRequest,
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
  msgtype = 'm.text',
): TimelineEntry {
  return { eventId, claimedSender: sender, sentAt, body, msgtype }
}

/** A conversation of three people, as the screen shows it. */
const TIMELINE: readonly TimelineEntry[] = [
  said('$mine', ME, 1_790_000_000_000, 'Bonjour à tous.'),
  said('$first', HIM, 1_790_000_010_000, 'Tu vas le regretter.'),
  said('$other', SOMEBODY_ELSE, 1_790_000_015_000, 'Calmez-vous.'),
  said('$second', HIM, 1_790_000_020_000, 'Réponds.\nMaintenant.'),
  said('$later', HIM, 1_790_000_030_000, 'Laisse tomber.'),
  said('$film', HIM, 1_790_000_040_000, 'film.mp4', 'm.video'),
]

/** Reporting `$second` and `$first`, chosen in that order, as harassment. */
const REQUEST: ReportRequest = {
  self: ME,
  roomId: ROOM,
  reason: 'harassment',
  selected: new Set(['$second', '$first']),
  timeline: TIMELINE,
}

/**
 * A device reporting, and what it did: what it sealed and for what binding,
 * and what it sent under which key. The seal is a double that names what it
 * sealed, so a test reads the payload back with the format's own reader.
 */
function device(
  options: {
    readonly answer?:
      | { readonly status: number; readonly body: string }
      | 'unreachable'
      | 'silent'
    readonly seal?: 'refuses'
    /**
     * What the homeserver's whoami answers for the token, or that it fails,
     * or that it never answers.
     */
    readonly whoami?: string | 'unanswered' | 'silent'
    /**
     * Whether a deadline elapses: on the next turn of the event loop, after
     * any port that answers at once.
     */
    readonly deadline?: 'elapses'
  } = {},
) {
  const sealed: { payload: Uint8Array; binding: ReportBinding }[] = []
  const sent: { body: string; key: string }[] = []
  let keys = 0
  const answer = options.answer ?? {
    status: 201,
    body: '{"number":"K7QM-4ZT2"}',
  }
  const reporting: Reporting = {
    whoami: async () => {
      if (options.whoami === 'unanswered') throw new Error('network')
      if (options.whoami === 'silent') return new Promise<string>(() => {})
      return options.whoami ?? ME
    },
    seal: (payload, binding) => {
      if (options.seal === 'refuses') throw new RangeError('reporter')
      sealed.push({ payload, binding })
      return 'THE-SEALED-REPORT'
    },
    keyOf: keysInMemory(() => `report-key-${(keys += 1)}`),
    service: {
      send: async (body, key) => {
        sent.push({ body, key })
        if (answer === 'unreachable') throw new Error('network unreachable')
        if (answer === 'silent') return new Promise(() => {})
        return answer
      },
    },
    now: () => NOW,
    after: async ms => {
      expect(ms).toBe(ANSWER_DEADLINE_MS)
      await new Promise(elapsed => {
        if (options.deadline === 'elapses') setTimeout(elapsed, 0)
      })
    },
  }
  return { reporting, sealed, sent }
}

describe('Reporting messages to the operator (#468)', () => {
  it('seals the selected messages as read, from their one author, and nothing else of the conversation', async () => {
    const { reporting, sealed } = device()

    await reportMessages(reporting, REQUEST)

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
          kind: 'text',
          eventId: '$first',
          sentAt: 1_790_000_010_000,
          sender: HIM,
          text: 'Tu vas le regretter.',
        },
        {
          kind: 'text',
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
      '$film',
    ]) {
      expect(everything).not.toContain(left)
    }
  })

  it('seals a photograph and a document of the same author beside their words, each as the description of its encrypted file, never its bytes (#471)', async () => {
    // A twelve-megabyte photograph. What reporting is handed has no way to
    // fetch it, decrypt it or upload it (`Reporting`), and what is sealed
    // names its address, its key and its hash: one block, for any size.
    const material = {
      v: 'v2',
      key: {
        kty: 'oct',
        key_ops: ['encrypt', 'decrypt'],
        alg: 'A256CTR',
        k: 'qcHVMSgYg-71CauWBezXI5qkaRb0LuIy-Wx5kIaHMIA',
        ext: true,
      },
      iv: 'X85+XgHN+HEAAAAAAAAAAA',
      hashes: { sha256: 'eZjVdFJp2cSnZjB2S2BWrPCtbWRXjt0ZRkAyXvqSFw8' },
    }
    const photograph: TimelineEntry = {
      eventId: '$photograph',
      claimedSender: HIM,
      sentAt: 1_790_000_012_000,
      body: 'image.jpg',
      msgtype: 'm.image',
      image: {
        url: 'mxc://example.org/photograph',
        secret: JSON.stringify(material),
        mimeType: 'image/jpeg',
        width: 4000,
        height: 3000,
        size: 12_000_000,
        thumbnail: null,
      },
    }
    const document: TimelineEntry = {
      eventId: '$document',
      claimedSender: HIM,
      sentAt: 1_790_000_014_000,
      body: 'menaces.pdf',
      msgtype: 'm.file',
      document: {
        url: 'mxc://example.org/document',
        secret: JSON.stringify(material),
        name: 'menaces.pdf',
        mimeType: 'application/pdf',
        size: 81_920,
      },
    }
    const { reporting, sealed, sent } = device()

    const reported = await reportMessages(reporting, {
      ...REQUEST,
      selected: new Set(['$document', '$first', '$photograph']),
      timeline: [...TIMELINE, photograph, document],
    })

    expect(reported).toEqual({ outcome: 'sent', number: 'K7QM-4ZT2' })
    expect(payloadOf(sealed[0]!.payload)?.messages).toEqual([
      {
        kind: 'text',
        eventId: '$first',
        sentAt: 1_790_000_010_000,
        sender: HIM,
        text: 'Tu vas le regretter.',
      },
      {
        kind: 'photograph',
        eventId: '$photograph',
        sentAt: 1_790_000_012_000,
        sender: HIM,
        file: { ...material, url: 'mxc://example.org/photograph' },
        mimetype: 'image/jpeg',
        name: 'image.jpg',
        size: 12_000_000,
      },
      {
        kind: 'document',
        eventId: '$document',
        sentAt: 1_790_000_014_000,
        sender: HIM,
        file: { ...material, url: 'mxc://example.org/document' },
        mimetype: 'application/pdf',
        name: 'menaces.pdf',
        size: 81_920,
      },
    ])
    expect(sealed[0]!.payload.length).toBeLessThan(4096)
    // And the service learns no more of a file than of words.
    expect(sent.map(({ body }) => JSON.parse(body) as unknown)).toEqual([
      { reason: 'harassment', sealed: 'THE-SEALED-REPORT' },
    ])
  })

  it('names the reporting account exactly as the homeserver’s whoami answers, and binds the seal to it', async () => {
    // The service keeps the account its whoami names, and the seal must bind
    // that very string, or the report does not open: not the one this device
    // holds, which a login or a claim once gave it.
    const { reporting, sealed } = device({ whoami: '@alice:home.example.org' })

    await reportMessages(reporting, { ...REQUEST, reason: 'threat' })

    expect(sealed.map(one => one.binding)).toEqual([
      { reason: 'threat', reporter: '@alice:home.example.org' },
    ])
    expect(payloadOf(sealed[0]!.payload)?.reportingAccount).toBe(
      '@alice:home.example.org',
    )
  })

  it('sends the reason and the sealed report under the report’s key, and nothing else', async () => {
    // The service learns neither the reported account, nor the
    // conversation, nor the messages: they are sealed.
    const { reporting, sent } = device()

    await reportMessages(reporting, REQUEST)

    expect(
      sent.map(({ body, key }) => ({ body: JSON.parse(body) as unknown, key })),
    ).toEqual([
      {
        body: { reason: 'harassment', sealed: 'THE-SEALED-REPORT' },
        key: 'report-key-1',
      },
    ])
  })

  it('answers the report number the service gives', async () => {
    const { reporting } = device()

    expect(await reportMessages(reporting, REQUEST)).toEqual({
      outcome: 'sent',
      number: 'K7QM-4ZT2',
    })
  })

  it('sends the same report again under the same key, and another report under another', async () => {
    // Retrying after an answer that never came must not file a second
    // report: the service answers the first one's number for the same key.
    const { reporting, sent } = device({ answer: 'unreachable' })

    await reportMessages(reporting, REQUEST)
    await reportMessages(reporting, {
      ...REQUEST,
      selected: new Set(['$first', '$second']),
    })
    await reportMessages(reporting, { ...REQUEST, reason: 'threat' })
    await reportMessages(reporting, {
      ...REQUEST,
      selected: new Set(['$first']),
    })
    await reportMessages(reporting, REQUEST)

    expect(sent.map(one => one.key)).toEqual([
      'report-key-1',
      'report-key-1',
      'report-key-2',
      'report-key-3',
      'report-key-1',
    ])
  })

  it('seals and sends a report up to what the service takes, and not one byte more', async () => {
    // Sixteen blocks, less the byte that ends the payload: 65,535 bytes. A
    // longer report could never be sent, so fewer messages must be chosen.
    const reporting = (text: string) => {
      const one = device()
      return {
        ...one,
        request: {
          ...REQUEST,
          selected: new Set(['$first']),
          timeline: [said('$first', HIM, 1_790_000_010_000, text)],
        },
      }
    }
    const measured = reporting('x')
    await reportMessages(measured.reporting, measured.request)
    const around = measured.sealed[0]!.payload.length - 1

    const longest = reporting('x'.repeat(MOST_PAYLOAD_BYTES - around))
    expect(await reportMessages(longest.reporting, longest.request)).toEqual({
      outcome: 'sent',
      number: 'K7QM-4ZT2',
    })
    expect(longest.sealed[0]!.payload).toHaveLength(MOST_PAYLOAD_BYTES)

    const tooLong = reporting('x'.repeat(MOST_PAYLOAD_BYTES - around + 1))
    expect(await reportMessages(tooLong.reporting, tooLong.request)).toEqual({
      outcome: 'too-long',
    })
    expect(tooLong.sealed).toEqual([])
    expect(tooLong.sent).toEqual([])
  })

  it('seals and sends nothing, and says so, when the selection is not one another person’s report can carry', async () => {
    // Not « unconfirmed » (#491): nothing left, and sending again could not
    // make it leave.
    for (const selected of [
      new Set(['$first', '$other']),
      new Set(['$mine']),
      new Set(['$mine', '$first']),
      new Set(['$first', '$film']),
      new Set(['$first', '$gone']),
      new Set<string>(),
    ]) {
      const { reporting, sealed, sent } = device()

      expect(await reportMessages(reporting, { ...REQUEST, selected })).toEqual(
        { outcome: 'unreportable' },
      )
      expect(sealed).toEqual([])
      expect(sent).toEqual([])
    }
  })

  it('seals and sends nothing, and says so, when a message chosen was removed while the sheet was open', async () => {
    // #491, the case the ticket names: the sheet opened on two messages, and
    // one was removed for everyone before « Envoyer ».
    const { reporting, sealed, sent } = device()
    const removedMeanwhile = TIMELINE.map(entry =>
      entry.eventId === '$second'
        ? { ...entry, body: null, msgtype: undefined, removed: true }
        : entry,
    )

    expect(
      await reportMessages(reporting, {
        ...REQUEST,
        timeline: removedMeanwhile,
      }),
    ).toEqual({ outcome: 'unreportable' })
    expect(sealed).toEqual([])
    expect(sent).toEqual([])
  })

  it('seals and sends nothing, and says nothing left, when the homeserver does not say whose account this is', async () => {
    // #491, the review of #493: nothing was sealed, and nothing left this
    // device. Not « perhaps sent ».
    const { reporting, sealed, sent } = device({ whoami: 'unanswered' })

    expect(await reportMessages(reporting, REQUEST)).toEqual({
      outcome: 'not-sent',
    })
    expect(sealed).toEqual([])
    expect(sent).toEqual([])
  })

  it('gives the homeserver’s whoami the send’s deadline, and says nothing left when it does not answer within it', async () => {
    // #491: asked just before sealing, it had none, and « Envoi… » could
    // stay on the sheet for ever.
    const { reporting, sealed, sent } = device({
      whoami: 'silent',
      deadline: 'elapses',
    })

    expect(await reportMessages(reporting, REQUEST)).toEqual({
      outcome: 'not-sent',
    })
    expect(sealed).toEqual([])
    expect(sent).toEqual([])
  })

  it('sends nothing, and says so, when the seal refuses its binding', async () => {
    const { reporting, sent } = device({ seal: 'refuses' })

    expect(await reportMessages(reporting, REQUEST)).toEqual({
      outcome: 'not-sent',
    })
    expect(sent).toEqual([])
  })

  it('is to be sent again when the service answers 503: its homeserver did not answer, and it kept nothing', async () => {
    // #491, the review of #493: the service answers 503 when it cannot ask
    // its homeserver who the token is, before keeping anything
    // (`auth.rs`). Not a refusal, which is final, nor « perhaps sent ».
    const { reporting, sent } = device({
      answer: { status: 503, body: '{"errcode":"MESSAGR_UPSTREAM"}' },
    })

    expect(await reportMessages(reporting, REQUEST)).toEqual({
      outcome: 'unavailable',
    })
    expect(sent).toHaveLength(1)
  })

  it('is refused when the service refuses it for good: a request it will not take, or a token it does not take', async () => {
    // #491: « pas confirmé, réessayer ne l'enverra qu'une fois » cannot be
    // true of a refusal. The service refuses before keeping anything
    // (`handlers/reports.rs`), and the same request would be refused again.
    for (const answer of [
      { status: 400, body: '{"errcode":"M_INVALID_PARAM"}' },
      { status: 401, body: '{"errcode":"M_UNAUTHORIZED"}' },
    ]) {
      const { reporting, sent } = device({ answer })

      expect(await reportMessages(reporting, REQUEST)).toEqual({
        outcome: 'refused',
      })
      expect(sent).toHaveLength(1)
    }
  })

  it('is unconfirmed when the service cannot be reached, gives no number, fails, or does not answer in time', async () => {
    for (const options of [
      { answer: { status: 404, body: '{"errcode":"M_UNRECOGNIZED"}' } },
      { answer: { status: 500, body: '{"errcode":"M_UNKNOWN"}' } },
      { answer: { status: 201, body: '{}' } },
      { answer: { status: 201, body: 'not json' } },
      { answer: 'unreachable' as const },
      { answer: 'silent' as const, deadline: 'elapses' as const },
    ]) {
      const { reporting } = device(options)

      expect(await reportMessages(reporting, REQUEST)).toEqual({
        outcome: 'unconfirmed',
      })
    }
  })
})

describe('The keys of the reports this device sends (#468)', () => {
  it('draws sixteen random bytes, in hexadecimal: within what the service takes, and saying nothing of the report', () => {
    // The service takes 8 to 200 visible ASCII characters
    // (`validate_idempotency_key`).
    const [one, two] = [drawnKey(), drawnKey()]

    expect(one).toMatch(/^[0-9a-f]{32}$/)
    expect(two).toMatch(/^[0-9a-f]{32}$/)
    expect(one).not.toBe(two)
  })

  it('draws one key per report, and gives it back for the same report', () => {
    let drawn = 0
    const keyOf = keysInMemory(() => `key-${(drawn += 1)}`)

    expect([keyOf('a'), keyOf('b'), keyOf('a'), keyOf('b')]).toEqual([
      'key-1',
      'key-2',
      'key-1',
      'key-2',
    ])
    expect(drawn).toBe(2)
  })
})
