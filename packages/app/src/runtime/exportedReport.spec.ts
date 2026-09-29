import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { openTool } from '../../../../scripts/lib/ouvrir-un-signalement.mjs'

/**
 * What the service exports, the operator's tool opens (#473).
 *
 * On the host, `--export-report <number>` prints a sealed report as the JSON
 * the opening tool reads, and the procedure pipes it straight into the tool
 * on the operator's machine (`deploy/messagr-eu-invitations.md`). The
 * service's own test (`services/invitations/src/moderation.rs`) holds that
 * `signalement-exporte-de-test.json` is exactly what the export prints for
 * the test report; this opens that file with the test key, never the real
 * one. Either side changing its shape turns one of the two red.
 */

const FIXTURES = join(__dirname, '../../../../scripts/fixtures')
/** The test key, in the format of the operator's key file. TEST ONLY. */
const TEST_KEY_FILE = join(FIXTURES, 'cle-de-test-de-l-exploitant.json')
/** The service's export of the test report, byte for byte. */
const EXPORTED_FILE = join(FIXTURES, 'signalement-exporte-de-test.json')

/** What the tool says and prints, and how it ends. */
async function run(
  argv: readonly string[],
  input: string | null,
): Promise<{ status: number; said: string; printed: string[] }> {
  const said: string[] = []
  const printed: string[] = []
  const status = await openTool([...argv], {
    home: mkdtempSync(join(tmpdir(), 'exploitant-')),
    stdin: async () => input,
    stderr: (line: string) => said.push(line),
    stdout: (line: string) => printed.push(line),
  })
  return { status, said: said.join('\n'), printed }
}

describe("A report the service exports, on the operator's machine", () => {
  it('opens when piped into the tool, as the procedure does', async () => {
    const { status, said, printed } = await run(
      ['--cle', TEST_KEY_FILE],
      readFileSync(EXPORTED_FILE, 'utf8'),
    )

    expect(status).toBe(0)
    expect(printed).toEqual(['Beauty is truth, truth beauty'])
    expect(said).toContain('harassment')
    expect(said).toContain('@alice:example.org')
  })

  it('opens from a file as well', async () => {
    const { status, printed } = await run(
      ['--cle', TEST_KEY_FILE, EXPORTED_FILE],
      null,
    )

    expect(status).toBe(0)
    expect(printed).toEqual(['Beauty is truth, truth beauty'])
  })

  it('carries the three fields the tool reads, and nothing else', () => {
    const exported = JSON.parse(readFileSync(EXPORTED_FILE, 'utf8')) as Record<
      string,
      unknown
    >

    expect(Object.keys(exported)).toEqual(['reason', 'reporter', 'sealed'])
  })
})
