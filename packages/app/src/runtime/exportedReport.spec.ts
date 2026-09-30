import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { runTheOpeningTool } from '../../../../scripts/fixtures/lancer-l-outil-d-ouverture.mjs'

/**
 * What the service exports, the operator's tool opens (#473).
 *
 * On the host, `--export-report <number>` prints a sealed report as the JSON
 * the opening tool reads, and the procedure pipes it straight into the tool
 * on the operator's machine (`deploy/messagr-eu-invitations.md`). The
 * service's own test (`services/invitations/src/moderation/mod.rs`) holds
 * that `signalement-exporte-de-test.json` is exactly what the export prints
 * for the test report; this opens that file with the test key, never the
 * real one. Either side changing its shape turns one of the two red.
 */

const FIXTURES = join(__dirname, '../../../../scripts/fixtures')
/** The test key, in the format of the operator's key file. TEST ONLY. */
const TEST_KEY_FILE = join(FIXTURES, 'cle-de-test-de-l-exploitant.json')
/** The service's export of the test report, byte for byte. */
const EXPORTED_FILE = join(FIXTURES, 'signalement-exporte-de-test.json')

describe("A report the service exports, on the operator's machine", () => {
  it('opens when piped into the tool, as the procedure does', async () => {
    const { status, said, printed } = await runTheOpeningTool(
      ['--cle', TEST_KEY_FILE],
      readFileSync(EXPORTED_FILE, 'utf8'),
    )

    expect(status).toBe(0)
    expect(printed).toEqual(['Beauty is truth, truth beauty'])
    expect(said).toContain('harassment')
    expect(said).toContain('@alice:example.org')
  })

  // Step 3 runs the same pipe with `--ouvrir <n>`, or `--ouvrir-vignette <n>`
  // for the thumbnail of a photo (#471, #496). What the test report carries
  // is not a report in format 1, and has no message to open: the tool reads
  // the pipe with either option, prints what the report carries, and says
  // there is nothing to open, without reaching a single port that opens a
  // file.
  it.each(['--ouvrir', '--ouvrir-vignette'])(
    'reads the same pipe with %s, as step 3 writes it',
    async option => {
      const { status, said, printed } = await runTheOpeningTool(
        ['--cle', TEST_KEY_FILE, option, '1'],
        readFileSync(EXPORTED_FILE, 'utf8'),
      )

      expect(status).toBe(2)
      expect(printed).toEqual(['Beauty is truth, truth beauty'])
      expect(said).toContain('Rien à ouvrir')
      expect(said).not.toContain('usage')
    },
  )

  it('opens from a file as well', async () => {
    const { status, printed } = await runTheOpeningTool(
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
