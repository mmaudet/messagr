import { describe, expect, it } from 'vitest'

import {
  base64Bytes,
  encryptedFileOf,
  fromWire,
  keyBytesOf,
  MOST_PAYLOAD_BYTES,
  openingOf,
  padded,
  payloadBytes,
  payloadOf,
  REPORT_REASONS,
  reportAad,
  type ReportedMessage,
  type ReportPayload,
  type ReportReason,
} from './reportFormat'

function hex(of: Uint8Array): string {
  return Array.from(of, b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * A reason as the operator's tool hands one over, read from a JSON document
 * the compiler never sees: the format's own check is what stands then.
 */
function untyped(reason: string): ReportReason {
  return reason as ReportReason
}

function text(of: Uint8Array): string {
  return String.fromCharCode(...of)
}

/** `value` in JSON, in UTF-8: a payload as the device writes one. */
function json(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value))
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
    const cutEarly = reportAad({
      reason: untyped('ab'),
      reporter: '@c:d.example',
    })
    const cutLate = reportAad({
      reason: untyped('ab@'),
      reporter: 'c:d.example',
    })

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
      expect(() => reportAad({ reason: untyped(reason), reporter })).toThrow(
        RangeError,
      )
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

describe('The reasons a report is sent for (#468)', () => {
  it('are the eight of the terms, by the codes the service takes', () => {
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
        kind: 'text',
        eventId: '$first',
        sentAt: 1_790_000_000_000,
        sender: '@bob:example.org',
        text: 'Tu vas le regretter.',
      },
      {
        kind: 'text',
        eventId: '$second',
        sentAt: 1_790_000_030_000,
        sender: '@bob:example.org',
        text: 'Réponds.\nMaintenant.',
      },
    ],
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
            kind: 'text',
            text: 'Tu vas le regretter.',
          },
          {
            event_id: '$second',
            sent_at: 1790000030000,
            sender: '@bob:example.org',
            kind: 'text',
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
        'a message of a kind the format does not know',
        json({
          ...written,
          messages: [{ ...written.messages[0], kind: 'video' }],
        }),
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
      ['a reason outside the eight', json({ ...written, reason: 'spam' })],
      ['nothing at all', json(null)],
      [
        'a message that is nothing',
        json({ ...written, messages: [null, written.messages[1]] }),
      ],
    ]
    for (const [what, bytes] of cases) {
      expect(payloadOf(bytes), what).toBeNull()
    }
  })

  it('still reads a report of words exactly as #468 wrote it, without a kind', () => {
    // Backward-readable (#471): a message of #468 has no `kind`, words being
    // the only kind there was, and every report sealed before reads as it
    // did.
    const written =
      '{"format":1,"reason":"threat","reported_at":1790000060000,' +
      '"reporting_account":"@alice:example.org",' +
      '"reported_account":"@bob:example.org","room_id":"!room:example.org",' +
      '"messages":[{"event_id":"$first","sent_at":1790000000000,' +
      '"sender":"@bob:example.org","text":"Tu vas le regretter."}]}'

    expect(payloadOf(new TextEncoder().encode(written))).toEqual({
      reason: 'threat',
      reportedAt: 1_790_000_060_000,
      reportingAccount: '@alice:example.org',
      reportedAccount: '@bob:example.org',
      roomId: '!room:example.org',
      messages: [
        {
          kind: 'text',
          eventId: '$first',
          sentAt: 1_790_000_000_000,
          sender: '@bob:example.org',
          text: 'Tu vas le regretter.',
        },
      ],
    })
  })

  it('fits the service’s sixteen blocks up to 65,535 bytes, and not one more', () => {
    // The service takes one to sixteen blocks of 4,096 bytes (`report.rs`),
    // and the padding needs one byte of its own.
    expect(MOST_PAYLOAD_BYTES).toBe(16 * 4096 - 1)
    expect(padded(new Uint8Array(MOST_PAYLOAD_BYTES))).toHaveLength(16 * 4096)
    expect(padded(new Uint8Array(MOST_PAYLOAD_BYTES + 1))).toHaveLength(
      17 * 4096,
    )
  })
})

/**
 * NIST SP 800-38A, appendix F.5.5, CTR-AES256.Encrypt: its key and its
 * initial counter, and the SHA-256 hash of its ciphertext, computed apart
 * with `openssl dgst -sha256`. What an encrypted file of Matrix carries is
 * these, written in base64.
 */
const NIST = {
  key: '603deb1015ca71be2b73aef0857d77811f352c073b6108d72d9810a30914dff4',
  counter: 'f0f1f2f3f4f5f6f7f8f9fafbfcfdfeff',
  sha256: '663131a07e9ec56a0c7d066bbc44fd4eefa4bae97ceeb2701f53d2153e82ffa5',
}

/** That file described as Matrix describes it, as an event carries it. */
const ENCRYPTED_FILE = {
  v: 'v2',
  key: {
    kty: 'oct',
    key_ops: ['encrypt', 'decrypt'],
    alg: 'A256CTR',
    k: 'YD3rEBXKcb4rc67whX13gR81LAc7YQjXLZgQowkU3_Q',
    ext: true,
  },
  iv: '8PHy8/T19vf4+fr7/P3+/w',
  hashes: { sha256: 'ZjExoH6exWoMfQZrvET9Tu+kuul87rJwH1PSFT6C/6U' },
  url: 'mxc://example.org/AbCdEf_photo-1',
}

describe('What opening a reported file needs, for the application and the tool alike (#471)', () => {
  it('reads the address, the key, the counter and the hash an encrypted file carries', () => {
    const opening = openingOf(ENCRYPTED_FILE)

    expect(opening?.server).toBe('example.org')
    expect(opening?.mediaId).toBe('AbCdEf_photo-1')
    expect(hex(opening!.key)).toBe(NIST.key)
    expect(hex(opening!.counter)).toBe(NIST.counter)
    expect(hex(opening!.sha256)).toBe(NIST.sha256)
  })

  it('opens every form of them the application’s display opens (#496)', () => {
    // The display decrypts through the bridge (`decryptAttachment`), which
    // reads a description as matrix-sdk-crypto does, with ruma's base64:
    // the key in the URL-safe alphabet, the counter and the hash in the
    // standard one, each with its padding, part of it or none, the bits of
    // its last character beyond its last byte ignored. Each form below was
    // decoded apart with that configuration (base64 0.22.1, the bridge's),
    // to the bytes of the vector. A photograph the display shows is one a
    // report carries.
    const opening = openingOf(ENCRYPTED_FILE)
    const written = (fields: { k?: string; iv?: string; sha256?: string }) => ({
      ...ENCRYPTED_FILE,
      key: { ...ENCRYPTED_FILE.key, k: fields.k ?? ENCRYPTED_FILE.key.k },
      iv: fields.iv ?? ENCRYPTED_FILE.iv,
      hashes: { sha256: fields.sha256 ?? ENCRYPTED_FILE.hashes.sha256 },
    })
    const forms: [string, object][] = [
      [
        'a key padded',
        written({ k: 'YD3rEBXKcb4rc67whX13gR81LAc7YQjXLZgQowkU3_Q=' }),
      ],
      ['a counter padded', written({ iv: '8PHy8/T19vf4+fr7/P3+/w==' })],
      ['a counter padded in part', written({ iv: '8PHy8/T19vf4+fr7/P3+/w=' })],
      [
        'a hash padded',
        written({ sha256: 'ZjExoH6exWoMfQZrvET9Tu+kuul87rJwH1PSFT6C/6U=' }),
      ],
      [
        'a key whose last character carries bits beyond its last byte',
        written({ k: 'YD3rEBXKcb4rc67whX13gR81LAc7YQjXLZgQowkU3_T' }),
      ],
      [
        'a counter whose last character carries bits beyond its last byte',
        written({ iv: '8PHy8/T19vf4+fr7/P3+//' }),
      ],
      [
        'a hash whose last character carries bits beyond its last byte',
        written({ sha256: 'ZjExoH6exWoMfQZrvET9Tu+kuul87rJwH1PSFT6C/6V=' }),
      ],
    ]
    for (const [what, file] of forms) {
      expect(openingOf(file), what).toEqual(opening)
      // And what is carried is the description as the event gave it.
      expect(encryptedFileOf(file), what).toBe(file)
    }
  })

  it('opens nothing the display refuses: a byte short, the other alphabet, more padding than the bytes need, or addressed off a homeserver’s media', () => {
    const withKey = (k: unknown) => ({
      ...ENCRYPTED_FILE,
      key: { ...ENCRYPTED_FILE.key, k },
    })
    const cases: [string, unknown][] = [
      ['a key a byte short', withKey(ENCRYPTED_FILE.key.k.slice(0, 42))],
      [
        'a key in the other alphabet',
        withKey(`${ENCRYPTED_FILE.key.k.slice(0, 42)}/`),
      ],
      ['a key padded twice', withKey(`${ENCRYPTED_FILE.key.k}==`)],
      [
        'a key padded before its end',
        withKey(
          `${ENCRYPTED_FILE.key.k.slice(0, 40)}=${ENCRYPTED_FILE.key.k.slice(40)}`,
        ),
      ],
      [
        'a key ending in a space',
        withKey(`${ENCRYPTED_FILE.key.k.slice(0, 42)} `),
      ],
      ['no key', { ...ENCRYPTED_FILE, key: undefined }],
      [
        'a counter of fifteen bytes',
        { ...ENCRYPTED_FILE, iv: 'AAECAwQFBgcICQoLDA0O' },
      ],
      [
        'a counter in the other alphabet',
        { ...ENCRYPTED_FILE, iv: '8PHy8_T19vf4-fr7_P3-_w' },
      ],
      [
        'a counter padded thrice',
        { ...ENCRYPTED_FILE, iv: '8PHy8/T19vf4+fr7/P3+/w===' },
      ],
      ['no counter', { ...ENCRYPTED_FILE, iv: 7 }],
      [
        'a hash of 31 bytes',
        {
          ...ENCRYPTED_FILE,
          hashes: { sha256: 'ZjExoH6exWoMfQZrvET9Tu+kuul87rJwH1PSFT6C/w' },
        },
      ],
      [
        'a hash padded twice',
        {
          ...ENCRYPTED_FILE,
          hashes: { sha256: 'ZjExoH6exWoMfQZrvET9Tu+kuul87rJwH1PSFT6C/6U==' },
        },
      ],
      [
        'a hash ending in a new line',
        {
          ...ENCRYPTED_FILE,
          hashes: { sha256: 'ZjExoH6exWoMfQZrvET9Tu+kuul87rJwH1PSFT6C/6U\n' },
        },
      ],
      ['no hash', { ...ENCRYPTED_FILE, hashes: {} }],
      [
        'an address on the web',
        { ...ENCRYPTED_FILE, url: 'https://example.org/a.jpg' },
      ],
      [
        'an address that walks out of its path',
        { ...ENCRYPTED_FILE, url: 'mxc://example.org/../../x' },
      ],
      [
        'an address of two segments',
        { ...ENCRYPTED_FILE, url: 'mxc://example.org/a/b' },
      ],
      [
        'an address without a media',
        { ...ENCRYPTED_FILE, url: 'mxc://example.org/' },
      ],
      ['nothing', null],
    ]
    for (const [what, file] of cases) {
      expect(openingOf(file), what).toBeNull()
      expect(encryptedFileOf(file), what).toBeNull()
    }
    // Control: what opens is kept as the event gave it.
    expect(encryptedFileOf(ENCRYPTED_FILE)).toBe(ENCRYPTED_FILE)
  })

  it('opens a description only where the display does: version 2, a key of AES-256-CTR for both ways, extractable, every hash in base64 (#496)', () => {
    // The display reads the description as ruma-events 0.34 does, then
    // matrix-sdk-crypto asks for version 2 and a SHA-256 hash. Each case
    // below was read apart with ruma-events 0.34.0, the bridge's, and gave
    // the verdict it is held to here.
    const withKey = (fields: Record<string, unknown>) => ({
      ...ENCRYPTED_FILE,
      key: { ...ENCRYPTED_FILE.key, ...fields },
    })
    const withHash = (hashes: unknown) => ({
      ...ENCRYPTED_FILE,
      hashes: { ...ENCRYPTED_FILE.hashes, ...(hashes as object) },
    })
    const refused: [string, unknown][] = [
      ['version 1', { ...ENCRYPTED_FILE, v: 'v1' }],
      ['no version', { ...ENCRYPTED_FILE, v: undefined }],
      ['a version that is not text', { ...ENCRYPTED_FILE, v: 2 }],
      ['a key of another type', withKey({ kty: 'RSA' })],
      ['a key type in capitals', withKey({ kty: 'OCT' })],
      ['a key of no type', withKey({ kty: undefined })],
      ['another algorithm', withKey({ alg: 'A128CTR' })],
      ['no algorithm', withKey({ alg: undefined })],
      ['a key that only encrypts', withKey({ key_ops: ['encrypt'] })],
      ['a key that only decrypts', withKey({ key_ops: ['decrypt'] })],
      [
        'operations that are not all words',
        withKey({ key_ops: ['encrypt', 'decrypt', 7] }),
      ],
      [
        'operations that are not a list',
        withKey({ key_ops: 'encrypt decrypt' }),
      ],
      ['no operations', withKey({ key_ops: undefined })],
      ['a key that is not extractable', withKey({ ext: false })],
      ['extractable written as text', withKey({ ext: 'true' })],
      ['nothing said of extractable', withKey({ ext: undefined })],
      [
        'another hash that is not base64',
        withHash({ sha512: 'pas du base64 !' }),
      ],
      ['another hash that is a number', withHash({ sha512: 7 })],
      [
        'another hash in the other alphabet',
        withHash({ sha512: 'q83vEjRWeJA-_w' }),
      ],
      ['another hash of one character', withHash({ sha512: 'q' })],
      [
        'another hash padded more than it needs',
        withHash({ sha512: 'q83vEjRWeJA==' }),
      ],
      [
        'another hash padded after a whole block',
        withHash({ sha512: 'q83v=' }),
      ],
      [
        'hashes as a list',
        {
          ...ENCRYPTED_FILE,
          hashes: ['ZjExoH6exWoMfQZrvET9Tu+kuul87rJwH1PSFT6C/6U'],
        },
      ],
      [
        'the SHA-256 hash under another name',
        {
          ...ENCRYPTED_FILE,
          hashes: { SHA256: 'ZjExoH6exWoMfQZrvET9Tu+kuul87rJwH1PSFT6C/6U' },
        },
      ],
    ]
    for (const [what, file] of refused) {
      expect(openingOf(file), what).toBeNull()
    }
    const opened: [string, object][] = [
      [
        'operations in another order, and one more',
        withKey({ key_ops: ['decrypt', 'wrapKey', 'encrypt'] }),
      ],
      ['another hash in base64', withHash({ sha512: 'q83vEjRWeJA' })],
      ['another hash, padded', withHash({ sha512: 'q83vEjRWeJA=' })],
      ['another hash, empty', withHash({ sha512: '' })],
      ['a field the display does not read', { ...ENCRYPTED_FILE, extra: 1 }],
      ['a key field the display does not read', withKey({ extra: 1 })],
    ]
    for (const [what, file] of opened) {
      expect(openingOf(file), what).toEqual(openingOf(ENCRYPTED_FILE))
    }
  })
})

describe('A photograph or a document in a report (#471)', () => {
  const DOCUMENT_FILE = { ...ENCRYPTED_FILE, url: 'mxc://example.org/GhIjKl' }
  const PAYLOAD: ReportPayload = {
    reason: 'sexual_without_consent',
    reportedAt: 1_790_000_060_000,
    reportingAccount: '@alice:example.org',
    reportedAccount: '@bob:example.org',
    roomId: '!room:example.org',
    messages: [
      {
        kind: 'text',
        eventId: '$words',
        sentAt: 1_790_000_000_000,
        sender: '@bob:example.org',
        text: 'Regarde.',
      },
      {
        kind: 'photograph',
        eventId: '$photograph',
        sentAt: 1_790_000_010_000,
        sender: '@bob:example.org',
        file: ENCRYPTED_FILE,
        mimetype: 'image/jpeg',
        name: 'image.jpg',
        size: 12_000_000,
        thumbnail: null,
      },
      {
        kind: 'document',
        eventId: '$document',
        sentAt: 1_790_000_020_000,
        sender: '@bob:example.org',
        file: DOCUMENT_FILE,
        mimetype: null,
        name: 'contrat.pdf',
        size: null,
      },
    ],
  }

  it('writes each as the description of its encrypted file, laid out as the format says', () => {
    // #471: the address of its encrypted copy on the server, its key, its
    // counter, its hashes, then its type, its name and its size. Never its
    // bytes: the payload names twelve megabytes and holds none of them.
    const written = JSON.parse(
      new TextDecoder().decode(payloadBytes(PAYLOAD)),
    ) as { messages: unknown[] }

    expect(written.messages).toEqual([
      {
        event_id: '$words',
        sent_at: 1790000000000,
        sender: '@bob:example.org',
        kind: 'text',
        text: 'Regarde.',
      },
      {
        event_id: '$photograph',
        sent_at: 1790000010000,
        sender: '@bob:example.org',
        kind: 'photograph',
        file: {
          v: 'v2',
          key: {
            kty: 'oct',
            key_ops: ['encrypt', 'decrypt'],
            alg: 'A256CTR',
            k: 'YD3rEBXKcb4rc67whX13gR81LAc7YQjXLZgQowkU3_Q',
            ext: true,
          },
          iv: '8PHy8/T19vf4+fr7/P3+/w',
          hashes: { sha256: 'ZjExoH6exWoMfQZrvET9Tu+kuul87rJwH1PSFT6C/6U' },
          url: 'mxc://example.org/AbCdEf_photo-1',
        },
        mimetype: 'image/jpeg',
        name: 'image.jpg',
        size: 12000000,
        thumbnail: null,
      },
      {
        event_id: '$document',
        sent_at: 1790000020000,
        sender: '@bob:example.org',
        kind: 'document',
        file: DOCUMENT_FILE,
        mimetype: null,
        name: 'contrat.pdf',
        size: null,
      },
    ])
    expect(payloadBytes(PAYLOAD).length).toBeLessThan(4096)
  })

  it('reads them back as they were written', () => {
    expect(payloadOf(payloadBytes(PAYLOAD))).toEqual(PAYLOAD)
  })

  it('refuses a message that is not exactly one kind, or a file it could not open', () => {
    const written = JSON.parse(
      new TextDecoder().decode(payloadBytes(PAYLOAD)),
    ) as Record<string, unknown> & { messages: Record<string, unknown>[] }
    const photograph = written.messages[1]!
    const changed = (fields: Record<string, unknown>) =>
      json({ ...written, messages: [{ ...photograph, ...fields }] })
    const cases: [string, Uint8Array][] = [
      ['words beside a photograph', changed({ text: 'Regarde.' })],
      [
        'words that carry a file',
        json({
          ...written,
          messages: [{ ...written.messages[0], file: ENCRYPTED_FILE }],
        }),
      ],
      ['a photograph without its file', changed({ file: undefined })],
      ['a photograph whose file is nothing', changed({ file: null })],
      [
        'a file it could not open',
        changed({ file: { ...ENCRYPTED_FILE, hashes: {} } }),
      ],
      ['a size written as text', changed({ size: '12 Mo' })],
      ['a type that is not text', changed({ mimetype: 7 })],
      ['no name at all', changed({ name: undefined })],
      ['no kind, and a file', changed({ kind: undefined })],
    ]
    for (const [what, bytes] of cases) {
      expect(payloadOf(bytes), what).toBeNull()
    }
  })
})

describe('A photograph’s thumbnail in a report (#496)', () => {
  /**
   * A thumbnail's encrypted file, as `info.thumbnail_file` carries one: an
   * address and a key of its own, not the photograph's (`imageEvent.ts`).
   */
  const THUMBNAIL_FILE = {
    v: 'v2',
    key: {
      kty: 'oct',
      key_ops: ['encrypt', 'decrypt'],
      alg: 'A256CTR',
      k: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8',
      ext: true,
    },
    iv: 'oKGio6SlpqcAAAAAAAAAAA',
    hashes: { sha256: 'piM3s213LABROxYZnnkExsCsjY9idjZfqVCxYxA3TRE' },
    url: 'mxc://example.org/GhIjKl_thumbnail',
  }
  const PHOTOGRAPH: ReportedMessage = {
    kind: 'photograph',
    eventId: '$photograph',
    sentAt: 1_790_000_010_000,
    sender: '@bob:example.org',
    file: ENCRYPTED_FILE,
    mimetype: 'image/jpeg',
    name: 'image.jpg',
    size: 482_113,
    thumbnail: { file: THUMBNAIL_FILE, mimetype: 'image/jpeg' },
  }
  const PAYLOAD: ReportPayload = {
    reason: 'sexual_without_consent',
    reportedAt: 1_790_000_060_000,
    reportingAccount: '@alice:example.org',
    reportedAccount: '@bob:example.org',
    roomId: '!room:example.org',
    messages: [PHOTOGRAPH],
  }

  function written(): Record<string, unknown> & {
    messages: Record<string, unknown>[]
  } {
    return JSON.parse(
      new TextDecoder().decode(payloadBytes(PAYLOAD)),
    ) as ReturnType<typeof written>
  }

  it('writes a photograph’s thumbnail beside its file, as the description of its own encrypted file, and reads it back', () => {
    // What the conversation showed the person who reports is the thumbnail
    // (`smallestCopyOf`), so the operator can open it too: its address, its
    // own key, its counter, its hashes, and its type. Never its bytes.
    expect(written().messages).toEqual([
      {
        event_id: '$photograph',
        sent_at: 1790000010000,
        sender: '@bob:example.org',
        kind: 'photograph',
        file: ENCRYPTED_FILE,
        mimetype: 'image/jpeg',
        name: 'image.jpg',
        size: 482113,
        thumbnail: {
          file: {
            v: 'v2',
            key: {
              kty: 'oct',
              key_ops: ['encrypt', 'decrypt'],
              alg: 'A256CTR',
              k: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8',
              ext: true,
            },
            iv: 'oKGio6SlpqcAAAAAAAAAAA',
            hashes: { sha256: 'piM3s213LABROxYZnnkExsCsjY9idjZfqVCxYxA3TRE' },
            url: 'mxc://example.org/GhIjKl_thumbnail',
          },
          mimetype: 'image/jpeg',
        },
      },
    ])
    expect(payloadOf(payloadBytes(PAYLOAD))).toEqual(PAYLOAD)
    expect(payloadBytes(PAYLOAD).length).toBeLessThan(4096)
  })

  it('still reads a photograph as #471 wrote it, with no thumbnail at all', () => {
    // Every report sealed before #496: its photographs carry no `thumbnail`,
    // and read as having none.
    const of471 = json({
      format: 1,
      reason: 'sexual_without_consent',
      reported_at: 1790000060000,
      reporting_account: '@alice:example.org',
      reported_account: '@bob:example.org',
      room_id: '!room:example.org',
      messages: [
        {
          event_id: '$photograph',
          sent_at: 1790000010000,
          sender: '@bob:example.org',
          kind: 'photograph',
          file: ENCRYPTED_FILE,
          mimetype: 'image/jpeg',
          name: 'image.jpg',
          size: 482113,
        },
      ],
    })

    expect(payloadOf(of471)?.messages).toEqual([
      { ...PHOTOGRAPH, thumbnail: null },
    ])
  })

  it('refuses a thumbnail it could not open, one the format does not write, or one on a document', () => {
    const payload = written()
    const photograph = payload.messages[0]!
    const changed = (fields: Record<string, unknown>) =>
      json({ ...payload, messages: [{ ...photograph, ...fields }] })
    const cases: [string, Uint8Array][] = [
      [
        'a thumbnail it could not open',
        changed({
          thumbnail: {
            file: { ...THUMBNAIL_FILE, hashes: {} },
            mimetype: 'image/jpeg',
          },
        }),
      ],
      [
        'a thumbnail without its file',
        changed({ thumbnail: { mimetype: 'image/jpeg' } }),
      ],
      [
        'a thumbnail that is only a file',
        changed({ thumbnail: THUMBNAIL_FILE }),
      ],
      [
        'a thumbnail whose type is not text',
        changed({ thumbnail: { file: THUMBNAIL_FILE, mimetype: 7 } }),
      ],
      [
        'a thumbnail without its type',
        changed({ thumbnail: { file: THUMBNAIL_FILE } }),
      ],
      ['a thumbnail that is words', changed({ thumbnail: 'vignette' })],
      ['a document with a thumbnail', changed({ kind: 'document' })],
    ]
    for (const [what, bytes] of cases) {
      expect(payloadOf(bytes), what).toBeNull()
    }
    // Control: the same photograph, as written, reads.
    expect(payloadOf(json(payload))).toEqual(PAYLOAD)
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
