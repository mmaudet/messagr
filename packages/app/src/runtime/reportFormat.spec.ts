import { describe, expect, it } from 'vitest'

import {
  base64Bytes,
  fromWire,
  keyBytesOf,
  payloadBytes,
  payloadOf,
  reportAad,
  type ReportPayload,
} from './reportFormat'

function hex(of: Uint8Array): string {
  return Array.from(of, b => b.toString(16).padStart(2, '0')).join('')
}

function text(of: Uint8Array): string {
  return String.fromCharCode(...of)
}

describe('What binds a report to its reason and its reporting account', () => {
  it('lays both fields out as the format says: two length bytes, then the ASCII', () => {
    // Written from the format's description, byte by byte: 10 is 0x000a,
    // « harassment » in ASCII, 18 is 0x0012, « @alice:example.org » in ASCII.
    expect(
      hex(reportAad({ reason: 'harassment', reporter: '@alice:example.org' })),
    ).toBe(
      '000a' +
        '6861726173736d656e74' +
        '0012' +
        '40616c6963653a6578616d706c652e6f7267',
    )
  })

  it('tells a reason from an account ID, whatever their lengths', () => {
    // The same eleven characters, cut in two places: a plain concatenation
    // would give both the same bytes.
    const cutEarly = reportAad({ reason: 'ab', reporter: '@c:d.example' })
    const cutLate = reportAad({ reason: 'ab@', reporter: 'c:d.example' })

    expect(hex(cutEarly)).not.toBe(hex(cutLate))
  })

  it('refuses a field it could not write back the same way', () => {
    const reporter = '@alice:example.org'
    for (const reason of [
      '',
      'two words',
      'harcèlement',
      'tab\there',
      'line\nbreak',
      'x'.repeat(256),
    ]) {
      expect(() => reportAad({ reason, reporter })).toThrow(RangeError)
    }
    expect(() => reportAad({ reason: 'harassment', reporter: '' })).toThrow(
      RangeError,
    )
    expect(() =>
      reportAad({ reason: 'harassment', reporter: '@é:example.org' }),
    ).toThrow(RangeError)
  })

  it('takes an account ID of up to 255 characters', () => {
    // 255: the most a Matrix user ID may have, which is how an account ID
    // travels.
    const longest = `@${'a'.repeat(242)}:example.org`
    expect(longest).toHaveLength(255)

    expect(reportAad({ reason: 'threat', reporter: longest })).toHaveLength(
      2 + 6 + 2 + 255,
    )
  })
})

describe('Standard base64, as a sealed report and a key are written', () => {
  it('reads the test vectors of RFC 4648, section 10', () => {
    const vectors: readonly (readonly [string, string])[] = [
      ['', ''],
      ['Zg==', 'f'],
      ['Zm8=', 'fo'],
      ['Zm9v', 'foo'],
      ['Zm9vYg==', 'foob'],
      ['Zm9vYmE=', 'fooba'],
      ['Zm9vYmFy', 'foobar'],
    ]

    for (const [written, meant] of vectors) {
      const bytes = base64Bytes(written)
      expect(bytes === null ? null : text(bytes)).toBe(meant)
    }
  })

  it('refuses every other way of writing the same bytes, or anything else', () => {
    for (const written of [
      'Zh==', // « f », with bits left over after its last byte
      'Zm9=', // « fo », likewise
      'Zm8', // its padding left out
      'Zg=',
      ' Zm8=',
      'Zm8=\n',
      'Zm-_', // the URL alphabet
      'Zm8=Zm8=',
    ]) {
      expect(base64Bytes(written)).toBeNull()
    }
    expect(base64Bytes(42)).toBeNull()
  })

  it('reads a key only as 32 bytes, written the one way they can be', () => {
    const key = 'mD3vxUbnchoghIM22hYScz6J+lmbQuZTjX22y4FoSDY='

    expect(keyBytesOf(key)).toHaveLength(32)
    // The same 32 bytes for a lenient decoder: the last character differs
    // only in the two bits that fall beyond the last byte.
    expect(
      keyBytesOf('mD3vxUbnchoghIM22hYScz6J+lmbQuZTjX22y4FoSDZ='),
    ).toBeNull()
    expect(keyBytesOf('Zm9vYmFy')).toBeNull()
    expect(keyBytesOf(`${key.slice(0, 40)}AAAAAA==`)).toBeNull()
  })
})

describe('What a report carries, inside the seal (#468)', () => {
  const PAYLOAD: ReportPayload = {
    reason: 'harassment',
    reportedAt: 1_790_000_060_000,
    reportingAccount: '@alice:example.org',
    reportedAccount: '@bob:example.org',
    roomId: '!room:example.org',
    messages: [
      {
        eventId: '$first',
        sentAt: 1_790_000_000_000,
        sender: '@bob:example.org',
        text: 'Tu vas le regretter.',
      },
      {
        eventId: '$second',
        sentAt: 1_790_000_030_000,
        sender: '@bob:example.org',
        text: 'Réponds.\nMaintenant.',
      },
    ],
  }

  function json(value: unknown): Uint8Array {
    return new TextEncoder().encode(JSON.stringify(value))
  }

  it('is JSON in UTF-8, laid out as the format says', () => {
    expect(JSON.parse(new TextDecoder().decode(payloadBytes(PAYLOAD)))).toEqual(
      {
        format: 1,
        reason: 'harassment',
        reported_at: 1790000060000,
        reporting_account: '@alice:example.org',
        reported_account: '@bob:example.org',
        room_id: '!room:example.org',
        messages: [
          {
            event_id: '$first',
            sent_at: 1790000000000,
            sender: '@bob:example.org',
            text: 'Tu vas le regretter.',
          },
          {
            event_id: '$second',
            sent_at: 1790000030000,
            sender: '@bob:example.org',
            text: 'Réponds.\nMaintenant.',
          },
        ],
      },
    )
  })

  it('reads back as it was written', () => {
    expect(payloadOf(payloadBytes(PAYLOAD))).toEqual(PAYLOAD)
  })

  it('refuses what the format does not write', () => {
    const written = JSON.parse(
      new TextDecoder().decode(payloadBytes(PAYLOAD)),
    ) as Record<string, unknown> & { messages: Record<string, unknown>[] }
    const cases: [string, Uint8Array][] = [
      ['not JSON', new TextEncoder().encode('Beauty is truth, truth beauty')],
      ['not UTF-8', Uint8Array.of(0x7b, 0xff, 0x7d)],
      ['a list', json([written])],
      ['another format', json({ ...written, format: 2 })],
      ['no format', json({ ...written, format: undefined })],
      ['no message', json({ ...written, messages: [] })],
      [
        'a message without its text',
        json({ ...written, messages: [{ ...written.messages[0], text: 1 }] }),
      ],
      [
        'a message without its event',
        json({
          ...written,
          messages: [{ ...written.messages[0], event_id: undefined }],
        }),
      ],
      ['a time written as text', json({ ...written, reported_at: '1790' })],
      ['no conversation', json({ ...written, room_id: undefined })],
    ]
    for (const [what, bytes] of cases) {
      expect(payloadOf(bytes), what).toBeNull()
    }
  })
})

describe('The bytes of a sealed report, read back', () => {
  it('says whether a report was refused for its format or for its size', () => {
    const report = new Uint8Array(49 + 4096)
    report[0] = 0x01
    const otherFormat = report.slice()
    otherFormat[0] = 0x02

    expect(fromWire(report).ok).toBe(true)
    expect(fromWire(otherFormat)).toEqual({ ok: false, refusal: 'format' })
    expect(fromWire(report.subarray(0, report.length - 1))).toEqual({
      ok: false,
      refusal: 'size',
    })
    expect(fromWire(report.subarray(0, 49))).toEqual({
      ok: false,
      refusal: 'size',
    })
  })
})
