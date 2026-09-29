import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  openSealedReport,
  openTool,
  readKeyFile,
} from '../../../../scripts/lib/exploitant.mjs'
import { bytesOf } from './base64'
import { deriveKeyPair, generateKeyPair, seal } from './hpke'
import { OPERATOR_KEY } from './operatorKey'
import { base64Of } from './receiveImage'
import { REPORT_INFO, reportAad, toWire } from './reportFormat'
import { sealReport, sealReportWithEphemeral } from './sealedReport'

/**
 * The seal, verified on both sides (#465): what this module seals, the
 * operator's tool opens (`scripts/lib/exploitant.mjs`), and it refuses a
 * sealed report whose reason or reporting account was changed on the way.
 *
 * The tool's own behaviour is proved here too, beside what it opens: what it
 * reads, what it prints, and what it refuses.
 */

const FIXTURES = join(__dirname, '../../../../scripts/fixtures')
/** The test key, in the format of the operator's key file. TEST ONLY. */
const TEST_KEY_FILE = join(FIXTURES, 'cle-de-test-de-l-exploitant.json')
/** A sealed report for the test key, computed outside this repository. */
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

/** RFC 9180, appendix A.2.1: the ephemeral key's seed, and what it encapsulates. */
const A_2_1 = {
  ikmE: '909a9b35d3dc4713a5e72a4da274b55d3d3821a37e5d099e74a647db583a904b',
  enc: '1afa08d3dec047a643885163f1180476fa7ddb54c6a8029ea33f95796bf2ac4a',
  pt: '4265617574792069732074727574682c20747275746820626561757479',
}

const BINDING = { reason: 'harassment', reporter: '@alice:example.org' }

function bytes(hexadecimal: string): Uint8Array {
  return Uint8Array.from(hexadecimal.match(/../g) ?? [], pair =>
    parseInt(pair, 16),
  )
}

function hex(of: Uint8Array): string {
  return Array.from(of, b => b.toString(16).padStart(2, '0')).join('')
}

function text(of: string): Uint8Array {
  return new TextEncoder().encode(of)
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
    say: (line: string) => said.push(line),
    print: (line: string) => printed.push(line),
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
  it('seals exactly the bytes computed outside this repository', () => {
    // Same ephemeral key (A.2.1's), same test key, same reason, account and
    // payload as the fixture, whose bytes an independent construction of
    // RFC 9180 on node:crypto computed after reproducing A.2.1 itself.
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
        TEST_KEY.public_key,
      ),
    )

    expect(wire[0]).toBe(0x01)
    expect(hex(wire.subarray(1, 33))).toBe(A_2_1.enc)
  })

  it('draws a fresh ephemeral key for every report', () => {
    const first = bytesOf(
      sealReport(text('same'), BINDING, TEST_KEY.public_key),
    )
    const second = bytesOf(
      sealReport(text('same'), BINDING, TEST_KEY.public_key),
    )

    expect(hex(first.subarray(1, 33))).not.toBe(hex(second.subarray(1, 33)))
    expect(hex(first)).not.toBe(hex(second))
  })

  it('gives the service one size for every report up to 4,095 bytes', () => {
    const sizeOf = (length: number): number =>
      bytesOf(sealReport(new Uint8Array(length), BINDING, TEST_KEY.public_key))
        .length

    // 1 + 32 + 4,096 + 16, written from the format: its number, the
    // encapsulated key, one block, and the tag.
    expect([0, 1, 700, 4095].map(sizeOf)).toEqual([4145, 4145, 4145, 4145])
    // The marker byte no longer fits: a second block.
    expect(sizeOf(4096)).toBe(8241)
  })

  it('seals for the key built into the application, unless told otherwise', () => {
    const ephemeral = generateKeyPair()
    const other = base64Of(generateKeyPair().publicKey)
    const payload = text('the same payload')

    const byDefault = sealReportWithEphemeral(ephemeral, payload, BINDING)

    expect(byDefault).toBe(
      sealReportWithEphemeral(ephemeral, payload, BINDING, OPERATOR_KEY),
    )
    expect(byDefault).not.toBe(
      sealReportWithEphemeral(ephemeral, payload, BINDING, other),
    )
  })

  it('refuses a key that is not an X25519 public key', () => {
    const short = base64Of(new Uint8Array(31).fill(9))

    expect(() => sealReport(text('x'), BINDING, short)).toThrow(RangeError)
    expect(() => sealReport(text('x'), BINDING, 'not base64 at all')).toThrow(
      RangeError,
    )
  })

  it('refuses a reason or an account the binding cannot carry', () => {
    expect(() =>
      sealReport(
        text('x'),
        { ...BINDING, reason: 'two words' },
        TEST_KEY.public_key,
      ),
    ).toThrow(RangeError)
  })
})

describe("What the application seals, the operator's tool opens", () => {
  it('opens a report sealed here, with the reason and account the device bound', () => {
    // Any bytes: what a report holds is #468's to assemble.
    const payload = text('Tu vas le regretter.')
    const sealed = sealReport(payload, BINDING, TEST_KEY.public_key)

    const opened = openSealedReport(testSecretKey(), { ...BINDING, sealed })

    expect(opened).toEqual({ opened: true, payload, ...BINDING })
  })

  it('refuses a report whose reason was changed after sealing', () => {
    const sealed = sealReport(text('x'), BINDING, TEST_KEY.public_key)

    const opened = openSealedReport(testSecretKey(), {
      ...BINDING,
      reason: 'spam',
      sealed,
    })

    expect(opened.opened).toBe(false)
  })

  it('refuses a report whose reporting account was changed after sealing', () => {
    const sealed = sealReport(text('x'), BINDING, TEST_KEY.public_key)

    const opened = openSealedReport(testSecretKey(), {
      ...BINDING,
      reporter: '@bob:example.org',
      sealed,
    })

    expect(opened.opened).toBe(false)
  })

  it('opens nothing with another key', () => {
    const sealed = sealReport(text('x'), BINDING, TEST_KEY.public_key)

    const opened = openSealedReport(generateKeyPair().secretKey, {
      ...BINDING,
      sealed,
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
    const wire = bytesOf(sealReport(text('x'), BINDING, TEST_KEY.public_key))
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
  it('opens the sealed report of the fixture, and prints its payload', async () => {
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

  it('refuses the fixture with its reason or its account changed, and prints nothing', async () => {
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
    const sealed = sealReport(payload, BINDING, TEST_KEY.public_key)

    const { status, printed } = await run([
      '--cle',
      TEST_KEY_FILE,
      written({ ...BINDING, sealed }),
    ])

    expect(status).toBe(0)
    expect(printed).toEqual(['rouge \\x1b[31m cloche \\x07 fin\ttab\nligne'])
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
