import { randomBytes } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import * as independent from '../../../../scripts/fixtures/hpke-independant.mjs'
import { readKeyFile } from '../../../../scripts/lib/cle-de-l-exploitant.mjs'
import {
  openSealedReport,
  openTool,
} from '../../../../scripts/lib/ouvrir-un-signalement.mjs'
import { bytesOf } from './base64'
import { deriveKeyPair, generateKeyPair, seal, type KeyPair } from './hpke'
import { OPERATOR_KEY } from './operatorKey'
import { base64Of } from './receiveImage'
import {
  payloadBytes,
  REPORT_INFO,
  reportAad,
  toWire,
  type ReportPayload,
} from './reportFormat'
import { reportMessages } from './reportMessages'
import { sealReport, sealReportWithEphemeral } from './sealedReport'

/**
 * The seal, verified on both sides (#465), and never by the application
 * alone.
 *
 * A second construction of RFC 9180 on node:crypto
 * (`scripts/fixtures/hpke-independant.mjs`), which shares no code with
 * `hpke.ts` nor with `reportFormat.ts`, first reproduces the vectors of
 * appendix A.2.1. Then it seals the committed test report byte for byte,
 * which the application must seal too, and opens what the application seals.
 * The operator's tool (`scripts/lib/ouvrir-un-signalement.mjs`) opens what
 * either seals, and refuses a report whose reason or account ID was changed.
 */

/** The ephemeral key `sealReport` draws, when a test fixes it. */
const drawn = vi.hoisted(() => ({ ephemeral: null as KeyPair | null }))

vi.mock('./hpke', async importOriginal => {
  const real = await importOriginal<typeof import('./hpke')>()
  return {
    ...real,
    generateKeyPair: () => drawn.ephemeral ?? real.generateKeyPair(),
  }
})

const FIXTURES = join(__dirname, '../../../../scripts/fixtures')
/** The test key, in the format of the operator's key file. TEST ONLY. */
const TEST_KEY_FILE = join(FIXTURES, 'cle-de-test-de-l-exploitant.json')
/** A sealed report for the test key, computed by the second construction. */
const TEST_REPORT_FILE = join(FIXTURES, 'signalement-de-test.json')

interface ReportDocument {
  readonly reason: string
  readonly reporter: string
  readonly sealed: string
}

const TEST_KEY = JSON.parse(readFileSync(TEST_KEY_FILE, 'utf8')) as {
  readonly public_key: string
  readonly secret_key: string
}
const TEST_REPORT = JSON.parse(
  readFileSync(TEST_REPORT_FILE, 'utf8'),
) as ReportDocument

/**
 * RFC 9180, appendix A.2.1: DHKEM(X25519, HKDF-SHA256), HKDF-SHA256,
 * ChaCha20Poly1305, base mode, and its first encryption. Copied from the
 * RFC's text, as `hpke.spec.ts` copies it.
 */
const A_2_1 = {
  info: '4f6465206f6e2061204772656369616e2055726e',
  ikmE: '909a9b35d3dc4713a5e72a4da274b55d3d3821a37e5d099e74a647db583a904b',
  skEm: 'f4ec9b33b792c372c1d2c2063507b684ef925b8c75a42dbcbf57d63ccd381600',
  ikmR: '1ac01f181fdf9f352797655161c58b75c656a6cc2716dcb66372da835542e1df',
  pkRm: '4310ee97d88cc1f088a5576c77ab0cf5c3ac797f3d95139c6c84b5429c59662a',
  skRm: '8057991eef8f1f1af18f4a9491d16a1ce333f695d4db8e38da75975c4478e0fb',
  enc: '1afa08d3dec047a643885163f1180476fa7ddb54c6a8029ea33f95796bf2ac4a',
  pt: '4265617574792069732074727574682c20747275746820626561757479',
  aad: '436f756e742d30',
  ct:
    '1c5250d8034ec2b784ba2cfd69dbdb8af406cfe3ff938e131f0def8c8b60b4db' +
    '21993c62ce81883d2dd1b51a28',
}

const BINDING = { reason: 'harassment', reporter: '@alice:example.org' }

function bytes(hexadecimal: string): Uint8Array {
  return Uint8Array.from(hexadecimal.match(/../g) ?? [], pair =>
    parseInt(pair, 16),
  )
}

function hex(of: Uint8Array | null): string | null {
  return of === null
    ? null
    : Array.from(of, b => b.toString(16).padStart(2, '0')).join('')
}

function text(of: string): Uint8Array {
  return new TextEncoder().encode(of)
}

/** `payload` sealed by the application, for the test key. */
function sealedForTheTestKey(payload: Uint8Array): string {
  return sealReportWithEphemeral(
    generateKeyPair(),
    payload,
    BINDING,
    TEST_KEY.public_key,
  )
}

function testSecretKey(): Uint8Array {
  const key = readKeyFile(readFileSync(TEST_KEY_FILE, 'utf8'))
  if (!key.ok) throw new Error(key.why)
  return key.secretKey
}

/** What the tool says and prints, and how it ends. */
async function run(
  argv: readonly string[],
  input = '',
  home = mkdtempSync(join(tmpdir(), 'exploitant-')),
): Promise<{ status: number; said: string; printed: string[] }> {
  const said: string[] = []
  const printed: string[] = []
  const status = await openTool([...argv], {
    home,
    stdin: async () => input,
    stderr: (line: string) => said.push(line),
    stdout: (line: string) => printed.push(line),
  })
  return { status, said: said.join('\n'), printed }
}

/** `document`, written to a file of its own. */
function written(document: object): string {
  const path = join(mkdtempSync(join(tmpdir(), 'pli-')), 'pli.json')
  writeFileSync(path, JSON.stringify(document))
  return path
}

describe('A report, sealed for the operator key', () => {
  it('seals exactly the bytes of the test report, under the ephemeral key of A.2.1', () => {
    const sealed = sealReportWithEphemeral(
      deriveKeyPair(bytes(A_2_1.ikmE)),
      bytes(A_2_1.pt),
      { reason: TEST_REPORT.reason, reporter: TEST_REPORT.reporter },
      TEST_KEY.public_key,
    )

    expect(sealed).toBe(TEST_REPORT.sealed)
  })

  it("carries the format's number, then the key the RFC encapsulates", () => {
    const wire = bytesOf(
      sealReportWithEphemeral(
        deriveKeyPair(bytes(A_2_1.ikmE)),
        text('anything'),
        BINDING,
      ),
    )

    expect(wire[0]).toBe(0x01)
    expect(hex(wire.subarray(1, 33))).toBe(A_2_1.enc)
  })

  it('draws a fresh ephemeral key for every report', () => {
    const first = bytesOf(sealReport(text('same'), BINDING))
    const second = bytesOf(sealReport(text('same'), BINDING))

    expect(hex(first.subarray(1, 33))).not.toBe(hex(second.subarray(1, 33)))
    expect(hex(first)).not.toBe(hex(second))
  })

  it('gives the service one size for every report up to 4,095 bytes', () => {
    const sizeOf = (length: number): number =>
      bytesOf(sealReport(new Uint8Array(length), BINDING)).length

    // 1 + 32 + 4,096 + 16, written from the format: its number, the
    // encapsulated key, one block, and the tag.
    expect([0, 1, 700, 4095].map(sizeOf)).toEqual([4145, 4145, 4145, 4145])
    // The marker byte no longer fits: a second block.
    expect(sizeOf(4096)).toBe(8241)
  })

  it('seals for the key built into the application, whatever it is handed', () => {
    const other = base64Of(generateKeyPair().publicKey)
    const ephemeral = generateKeyPair()
    const payload = text('the same payload')
    drawn.ephemeral = ephemeral
    try {
      const sealed = sealReport(payload, BINDING)
      // A key handed anyway, past the type that leaves it no room.
      const handedAKey: unknown = Reflect.apply(sealReport, undefined, [
        payload,
        BINDING,
        other,
      ])

      expect(sealed).toBe(
        sealReportWithEphemeral(ephemeral, payload, BINDING, OPERATOR_KEY),
      )
      expect(handedAKey).toBe(sealed)
      expect(sealed).not.toBe(
        sealReportWithEphemeral(ephemeral, payload, BINDING, other),
      )
    } finally {
      drawn.ephemeral = null
    }
  })

  it('refuses a key that is not an X25519 public key, however it is written', () => {
    for (const key of [
      base64Of(new Uint8Array(31).fill(9)),
      'not base64 at all',
      // The test key, with bits left over after its last byte.
      'mD3vxUbnchoghIM22hYScz6J+lmbQuZTjX22y4FoSDZ=',
    ]) {
      expect(() =>
        sealReportWithEphemeral(generateKeyPair(), text('x'), BINDING, key),
      ).toThrow(RangeError)
    }
  })

  it('refuses a reason or an account ID the binding cannot carry', () => {
    expect(() =>
      sealReport(text('x'), { ...BINDING, reason: 'two words' }),
    ).toThrow(RangeError)
  })
})

describe('A second construction of RFC 9180, on node:crypto alone', () => {
  it('reproduces appendix A.2.1, sealing and opening', () => {
    const ephemeral = independent.deriveSecretKey(bytes(A_2_1.ikmE))
    const recipient = independent.deriveSecretKey(bytes(A_2_1.ikmR))

    expect(hex(ephemeral)).toBe(A_2_1.skEm)
    expect(hex(recipient)).toBe(A_2_1.skRm)
    expect(hex(independent.publicKeyOf(recipient))).toBe(A_2_1.pkRm)

    const sealed = independent.seal(
      ephemeral,
      bytes(A_2_1.pkRm),
      bytes(A_2_1.info),
      bytes(A_2_1.aad),
      bytes(A_2_1.pt),
    )
    expect(hex(sealed.enc)).toBe(A_2_1.enc)
    expect(hex(sealed.ciphertext)).toBe(A_2_1.ct)
    expect(
      hex(
        independent.open(
          recipient,
          bytes(A_2_1.enc),
          bytes(A_2_1.info),
          bytes(A_2_1.aad),
          bytes(A_2_1.ct),
        ),
      ),
    ).toBe(A_2_1.pt)
  })

  it('seals the test report byte for byte, from the format’s description alone', () => {
    const sealed = independent.sealReport({
      ephemeral: independent.deriveSecretKey(bytes(A_2_1.ikmE)),
      recipient: bytesOf(TEST_KEY.public_key),
      reason: TEST_REPORT.reason,
      reporter: TEST_REPORT.reporter,
      payload: bytes(A_2_1.pt),
    })

    expect(sealed).toBe(TEST_REPORT.sealed)
  })

  it('opens what the application seals, and refuses it with the reason or the account ID changed', () => {
    const payload = text('Tu vas le regretter.')
    const sealed = sealedForTheTestKey(payload)
    const secret = testSecretKey()

    expect(hex(independent.openReport({ secret, ...BINDING, sealed }))).toBe(
      hex(payload),
    )
    expect(
      independent.openReport({ secret, ...BINDING, reason: 'spam', sealed }),
    ).toBeNull()
    expect(
      independent.openReport({
        secret,
        ...BINDING,
        reporter: '@bob:example.org',
        sealed,
      }),
    ).toBeNull()
  })
})

describe("What is sealed for the operator key, the operator's tool opens", () => {
  it('opens a report sealed by the application, with its reason and account ID', () => {
    // Any bytes: what a report holds is #468's to assemble.
    const payload = text('Tu vas le regretter.')

    const opened = openSealedReport(testSecretKey(), {
      ...BINDING,
      sealed: sealedForTheTestKey(payload),
    })

    expect(opened).toEqual({ opened: true, payload, ...BINDING })
  })

  it('opens a report sealed by the second construction', () => {
    const payload = text('scellé ailleurs')
    const sealed = independent.sealReport({
      ephemeral: randomBytes(32),
      recipient: bytesOf(TEST_KEY.public_key),
      ...BINDING,
      payload,
    })

    const opened = openSealedReport(testSecretKey(), { ...BINDING, sealed })

    expect(opened.opened ? hex(opened.payload) : opened.why).toBe(hex(payload))
  })

  it('refuses a report whose reason was changed after sealing', () => {
    const sealed = sealedForTheTestKey(text('x'))

    const opened = openSealedReport(testSecretKey(), {
      ...BINDING,
      reason: 'spam',
      sealed,
    })

    expect(opened.opened).toBe(false)
  })

  it('refuses a report whose account ID was changed after sealing', () => {
    const sealed = sealedForTheTestKey(text('x'))

    const opened = openSealedReport(testSecretKey(), {
      ...BINDING,
      reporter: '@bob:example.org',
      sealed,
    })

    expect(opened.opened).toBe(false)
  })

  it('opens nothing with another key', () => {
    const opened = openSealedReport(generateKeyPair().secretKey, {
      ...BINDING,
      sealed: sealedForTheTestKey(text('x')),
    })

    expect(opened.opened).toBe(false)
  })

  it('refuses what opens but was not padded as the format says', () => {
    // Sealed like a report, over a whole block with no marker byte.
    const unpadded = new Uint8Array(4096).fill(0x41)
    const sealed = base64Of(
      toWire(
        seal(
          bytesOf(TEST_KEY.public_key),
          REPORT_INFO,
          reportAad(BINDING),
          unpadded,
        ),
      ),
    )

    expect(
      openSealedReport(testSecretKey(), { ...BINDING, sealed }).opened,
    ).toBe(false)
  })

  it('refuses another format, a truncated report and loose base64', () => {
    const wire = bytesOf(sealedForTheTestKey(text('x')))
    const otherFormat = wire.slice()
    otherFormat[0] = 0x02
    const cases = [
      base64Of(otherFormat),
      base64Of(wire.subarray(0, wire.length - 1)),
      ` ${base64Of(wire)}`,
      // 4,145 bytes: base64 ends with one padding character, left out here.
      base64Of(wire).replace(/[=]$/, ''),
    ]

    for (const sealed of cases) {
      expect(
        openSealedReport(testSecretKey(), { ...BINDING, sealed }).opened,
      ).toBe(false)
    }
  })
})

describe("The operator's opening tool, as it is run", () => {
  it('opens the test report, and prints its payload alone on stdout', async () => {
    const { status, said, printed } = await run([
      '--cle',
      TEST_KEY_FILE,
      TEST_REPORT_FILE,
    ])

    expect(status).toBe(0)
    expect(printed).toEqual(['Beauty is truth, truth beauty'])
    expect(said).toContain('harassment')
    expect(said).toContain('@alice:example.org')
  })

  it('reads the sealed report on its standard input when no file is named', async () => {
    const { status, printed } = await run(
      ['--cle', TEST_KEY_FILE],
      readFileSync(TEST_REPORT_FILE, 'utf8'),
    )

    expect(status).toBe(0)
    expect(printed).toEqual(['Beauty is truth, truth beauty'])
  })

  it('takes the key from ~/.messagr-exploitation when none is named', async () => {
    const home = mkdtempSync(join(tmpdir(), 'exploitant-'))
    mkdirSync(join(home, '.messagr-exploitation'))
    writeFileSync(
      join(home, '.messagr-exploitation', 'cle-de-l-exploitant.json'),
      readFileSync(TEST_KEY_FILE),
    )

    const { status } = await run([TEST_REPORT_FILE], '', home)

    expect(status).toBe(0)
  })

  it('refuses the test report with its reason or its account ID changed, and prints nothing', async () => {
    for (const changed of [
      { ...TEST_REPORT, reason: 'spam' },
      { ...TEST_REPORT, reporter: '@bob:example.org' },
    ]) {
      const { status, printed } = await run([
        '--cle',
        TEST_KEY_FILE,
        written(changed),
      ])

      expect(status).toBe(1)
      expect(printed).toEqual([])
    }
  })

  it('shows control characters rather than sending them to the terminal', async () => {
    const payload = text('rouge \u001b[31m cloche \u0007 fin\ttab\nligne')

    const { status, printed } = await run([
      '--cle',
      TEST_KEY_FILE,
      written({ ...BINDING, sealed: sealedForTheTestKey(payload) }),
    ])

    expect(status).toBe(0)
    expect(printed).toEqual(['rouge \\x1b[31m cloche \\x07 fin\ttab\nligne'])
  })

  it('shows a report the application made: who reports, the author, the conversation, then each message with its time and its event', async () => {
    // From the selection to the operator's screen, through the application's
    // own assembly and seal (#468), for the test key.
    const sent: string[] = []
    const reported = await reportMessages(
      {
        seal: (payload, binding) =>
          sealReportWithEphemeral(
            generateKeyPair(),
            payload,
            binding,
            TEST_KEY.public_key,
          ),
        service: {
          send: async body => {
            sent.push(body)
            return { status: 201, body: '{"number":"K7QM-4ZT2"}' }
          },
        },
        now: () => 1_790_000_060_000,
      },
      {
        reporter: '@alice:example.org',
        roomId: '!room:example.org',
        reason: 'harassment',
        selected: new Set(['$first', '$second']),
        timeline: [
          {
            eventId: '$first',
            claimedSender: '@bob:example.org',
            sentAt: 1_790_000_010_000,
            body: 'Tu vas le regretter.',
          },
          {
            eventId: '$between',
            claimedSender: '@alice:example.org',
            sentAt: 1_790_000_015_000,
            body: 'Arrête.',
          },
          {
            eventId: '$second',
            claimedSender: '@bob:example.org',
            sentAt: 1_790_000_020_000,
            body: 'Réponds.\nMaintenant.',
          },
        ],
      },
    )
    expect(reported).toEqual({ sent: true, number: 'K7QM-4ZT2' })
    const { reason, sealed } = JSON.parse(sent[0]!) as {
      readonly reason: string
      readonly sealed: string
    }

    const { status, said, printed } = await run([
      '--cle',
      TEST_KEY_FILE,
      written({ reason, reporter: '@alice:example.org', sealed }),
    ])

    expect(status).toBe(0)
    expect(said).not.toContain('Attention')
    expect(printed.join('\n').split('\n')).toEqual([
      'compte qui signale : @alice:example.org',
      'auteur             : @bob:example.org',
      'conversation       : !room:example.org',
      'motif              : harassment',
      'signalé le         : 2026-09-21 14:14:20 UTC',
      '',
      'message 1 sur 2, écrit le 2026-09-21 14:13:30 UTC',
      '  événement : $first',
      '  │ Tu vas le regretter.',
      '',
      'message 2 sur 2, écrit le 2026-09-21 14:13:40 UTC',
      '  événement : $second',
      '  │ Réponds.',
      '  │ Maintenant.',
    ])
  })

  it('says when what it opens is not a report the format writes, and shows it as it is', async () => {
    const { status, said, printed } = await run([
      '--cle',
      TEST_KEY_FILE,
      TEST_REPORT_FILE,
    ])

    expect(status).toBe(0)
    expect(said).toContain('pas un signalement au format 1')
    expect(printed).toEqual(['Beauty is truth, truth beauty'])
  })

  it('says so when the report names another reason, reporter or author than it should', async () => {
    // Not what the application writes: the seal binds the reason and the
    // reporting account kept by the service, and those are what count.
    const payload: ReportPayload = {
      reason: 'threat',
      reportedAt: 1_790_000_060_000,
      reportingAccount: '@mallory:example.org',
      reportedAccount: '@bob:example.org',
      roomId: '!room:example.org',
      messages: [
        {
          eventId: '$first',
          sentAt: 1_790_000_010_000,
          sender: '@carol:example.org',
          text: 'rouge \u001b[31m cloche \u0007',
        },
      ],
    }

    const { status, said, printed } = await run([
      '--cle',
      TEST_KEY_FILE,
      written({
        ...BINDING,
        sealed: sealedForTheTestKey(payloadBytes(payload)),
      }),
    ])

    expect(status).toBe(0)
    expect(said).toContain('Attention')
    const shown = printed.join('\n').split('\n')
    expect(shown).toContain(
      '  expéditeur : @carol:example.org, qui n’est pas l’auteur',
    )
    expect(shown).toContain('  │ rouge \\x1b[31m cloche \\x07')
  })

  it('says what is missing from a document that is not a sealed report', async () => {
    const { status, said } = await run([
      '--cle',
      TEST_KEY_FILE,
      written({ reason: 'harassment' }),
    ])

    expect(status).toBe(2)
    expect(said).toContain('reporter')
  })
})
