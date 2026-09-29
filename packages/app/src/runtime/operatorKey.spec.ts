import { Buffer } from 'node:buffer'
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { keyTool, openTool } from '../../../../scripts/lib/exploitant.mjs'
import { bytesOf } from './base64'
import { generateKeyPair } from './hpke'
import { OPERATOR_KEY } from './operatorKey'
import { base64Of } from './receiveImage'
import { sealReport } from './sealedReport'

/**
 * The operator key (#465, the glossary's « Operator key »): its public half
 * built into the application, the tool that draws the pair on the operator's
 * machine (`scripts/cle-de-l-exploitant.mjs`), and the guard that keeps the
 * test key out of a store build (`scripts/assert-operator-key.mjs`).
 *
 * # TRUE WITH THE TEST KEY, AND AFTER #470
 *
 * Nothing here reads which key the module carries today. The guard is run on
 * copies of the real module, with the test key put in and with another, so
 * these tests hold the day #470 replaces the test key, as they hold now.
 */

const ROOT = join(__dirname, '../../../..')
const MODULE = join(__dirname, 'operatorKey.ts')
const GUARD = join(ROOT, 'scripts/assert-operator-key.mjs')
const TEST_KEY = JSON.parse(
  readFileSync(
    join(ROOT, 'scripts/fixtures/cle-de-test-de-l-exploitant.json'),
    'utf8',
  ),
) as { readonly public_key: string; readonly secret_key: string }

/** The line that carries the key, in the module and in the tool's output. */
const KEY_LINE = /^export const OPERATOR_KEY = '[A-Za-z0-9+/]{43}='$/m

/** Scrypt at a test's cost: what these tests prove does not depend on it. */
const CHEAP = { n: 1024, r: 8, p: 1 }
const PASSPHRASE = 'une phrase de passe assez longue'

/** A copy of the real module, with its key line replaced by `line`. */
function moduleWith(line: string): string {
  const source = readFileSync(MODULE, 'utf8')
  expect(source.match(new RegExp(KEY_LINE.source, 'gm'))).toHaveLength(1)
  const path = join(mkdtempSync(join(tmpdir(), 'cle-')), 'operatorKey.ts')
  writeFileSync(path, source.replace(KEY_LINE, line))
  return path
}

/** A file's permissions in octal, as `ls -l` and `chmod` write them. */
function permissionsOf(path: string): string {
  return (statSync(path).mode % 0o1000).toString(8)
}

/** Whatever the owner may do, and nothing for the group nor for others. */
const OWNER_ONLY = /^[0-7]00$/

function keyLine(publicKey: string): string {
  return `export const OPERATOR_KEY = '${publicKey}'`
}

/** What a store build answers about the module at `path`. */
function storeBuild(path: string): { status: number | null; said: string } {
  const run = spawnSync(process.execPath, [GUARD, path], { encoding: 'utf8' })
  return { status: run.status, said: `${run.stdout}${run.stderr}` }
}

/** The answers typed at the terminal, one per question, then none. */
function typed(...answers: readonly string[]): {
  readonly ask: (question: string) => Promise<string | null>
  readonly asked: () => number
} {
  let at = 0
  return {
    ask: async () => (at < answers.length ? answers[at++]! : null),
    asked: () => at,
  }
}

interface Drawn {
  readonly status: number
  readonly said: string
  readonly printed: readonly string[]
  readonly home: string
  readonly copy: string
  readonly keyFile: string
}

async function keyToolRun(
  gesture: string,
  answers: readonly string[],
  place: { home?: string; copy?: string } = {},
): Promise<Drawn & { asked: number }> {
  const home = place.home ?? mkdtempSync(join(tmpdir(), 'exploitant-'))
  const copy =
    place.copy ??
    join(mkdtempSync(join(tmpdir(), 'hors-ligne-')), 'cle.copie.json')
  const said: string[] = []
  const printed: string[] = []
  const terminal = typed(...answers)
  const status = await keyTool([gesture, copy], {
    home,
    ask: terminal.ask,
    say: (line: string) => said.push(line),
    print: (line: string) => printed.push(line),
    cost: CHEAP,
  })
  return {
    status,
    said: said.join('\n'),
    printed,
    home,
    copy,
    keyFile: join(home, '.messagr-exploitation', 'cle-de-l-exploitant.json'),
    asked: terminal.asked(),
  }
}

function draw(place: { home?: string; copy?: string } = {}) {
  return keyToolRun('tirer', [PASSPHRASE, PASSPHRASE], place)
}

describe('The key built into the application', () => {
  it('is an X25519 public key, in standard base64', () => {
    expect(bytesOf(OPERATOR_KEY)).toHaveLength(32)
    expect(base64Of(bytesOf(OPERATOR_KEY))).toBe(OPERATOR_KEY)
  })

  it('stands on one line of the form the key tool prints', () => {
    expect(readFileSync(MODULE, 'utf8')).toMatch(KEY_LINE)
  })
})

describe('A store build', () => {
  it('refuses the test key, whose private half is in this repository', () => {
    const { status, said } = storeBuild(
      moduleWith(keyLine(TEST_KEY.public_key)),
    )

    expect(status).toBe(1)
    expect(said).toContain('clé de test')
  })

  it('accepts another key', () => {
    const other = base64Of(generateKeyPair().publicKey)

    expect(storeBuild(moduleWith(keyLine(other))).status).toBe(0)
  })

  it('refuses a key it cannot read, rather than letting it through', () => {
    for (const line of [
      "export const OPERATOR_KEY = 'pas une clé'",
      `export const OPERATOR_KEY = '${base64Of(new Uint8Array(31).fill(7))}'`,
      `export const SOME_OTHER_NAME = '${base64Of(generateKeyPair().publicKey)}'`,
      // A module that does not even load.
      "export const OPERATOR_KEY = '",
    ]) {
      expect(storeBuild(moduleWith(line)).status).toBe(1)
    }
  })
})

describe('Drawing the operator key, on the operator’s machine', () => {
  it('keeps the private half in ~/.messagr-exploitation, readable by the operator alone', async () => {
    const drawn = await draw()

    expect(drawn.status).toBe(0)
    expect(readdirSync(drawn.home)).toEqual(['.messagr-exploitation'])
    expect(readdirSync(join(drawn.home, '.messagr-exploitation'))).toEqual([
      'cle-de-l-exploitant.json',
    ])
    expect(permissionsOf(drawn.keyFile)).toMatch(OWNER_ONLY)
    expect(permissionsOf(join(drawn.home, '.messagr-exploitation'))).toMatch(
      OWNER_ONLY,
    )
  })

  it('writes one offline copy, where it is told, that does not show the key', async () => {
    const drawn = await draw()
    const { secret_key: secret } = JSON.parse(
      readFileSync(drawn.keyFile, 'utf8'),
    ) as { secret_key: string }
    const copy = readFileSync(drawn.copy, 'utf8')

    expect(copy).not.toContain(secret)
    expect(copy).not.toContain(Buffer.from(secret, 'base64').toString('hex'))
    expect(JSON.parse(copy)).toMatchObject({
      kind: 'messagr operator key, offline copy',
      kdf: { name: 'scrypt', ...CHEAP },
      aead: { name: 'xchacha20-poly1305' },
    })
  })

  it('never prints the private half', async () => {
    const drawn = await draw()
    const { secret_key: secret } = JSON.parse(
      readFileSync(drawn.keyFile, 'utf8'),
    ) as { secret_key: string }
    const everything = `${drawn.said}\n${drawn.printed.join('\n')}`

    expect(everything).not.toContain(secret)
    expect(everything).not.toContain(
      Buffer.from(secret, 'base64').toString('hex'),
    )
  })

  it('prints the public half as the line that takes the test key’s place', async () => {
    const drawn = await draw()

    expect(drawn.printed).toHaveLength(1)
    const line = drawn.printed[0]!
    expect(line).toMatch(KEY_LINE)
    const { public_key: publicKey } = JSON.parse(
      readFileSync(drawn.keyFile, 'utf8'),
    ) as { public_key: string }
    expect(line).toBe(keyLine(publicKey))
    // #470's gesture, end to end: the line in the application, a store build
    // that accepts it, and a report sealed for it opened on the machine.
    expect(storeBuild(moduleWith(line)).status).toBe(0)
    const sealed = sealReport(
      new TextEncoder().encode('pour la clé tirée'),
      { reason: 'threat', reporter: '@alice:example.org' },
      publicKey,
    )
    const pli = join(mkdtempSync(join(tmpdir(), 'pli-')), 'pli.json')
    writeFileSync(
      pli,
      JSON.stringify({
        reason: 'threat',
        reporter: '@alice:example.org',
        sealed,
      }),
    )
    const printed: string[] = []
    const status = await openTool([pli], {
      home: drawn.home,
      stdin: async () => '',
      say: () => undefined,
      print: (text: string) => printed.push(text),
    })
    expect(status).toBe(0)
    expect(printed).toEqual(['pour la clé tirée'])
  })

  it('refuses to replace a key that exists, and writes nothing', async () => {
    const home = mkdtempSync(join(tmpdir(), 'exploitant-'))
    mkdirSync(join(home, '.messagr-exploitation'))
    const keyFile = join(
      home,
      '.messagr-exploitation',
      'cle-de-l-exploitant.json',
    )
    writeFileSync(keyFile, 'la clé déjà là')

    const drawn = await draw({ home })

    expect(drawn.status).toBe(1)
    expect(readFileSync(keyFile, 'utf8')).toBe('la clé déjà là')
    expect(existsSync(drawn.copy)).toBe(false)
    expect(drawn.asked).toBe(0)
    expect(drawn.printed).toEqual([])
  })

  it('refuses to replace an offline copy that exists, and writes nothing', async () => {
    const copy = join(
      mkdtempSync(join(tmpdir(), 'hors-ligne-')),
      'cle.copie.json',
    )
    writeFileSync(copy, 'une autre copie')

    const drawn = await draw({ copy })

    expect(drawn.status).toBe(1)
    expect(readFileSync(copy, 'utf8')).toBe('une autre copie')
    expect(existsSync(drawn.keyFile)).toBe(false)
  })

  it('writes nothing without the same passphrase twice, long enough, typed on a terminal', async () => {
    for (const answers of [
      [PASSPHRASE, `${PASSPHRASE}!`],
      ['court', 'court'],
      [],
    ]) {
      const drawn = await keyToolRun('tirer', answers)

      expect(drawn.status).toBe(1)
      expect(existsSync(drawn.keyFile)).toBe(false)
      expect(existsSync(drawn.copy)).toBe(false)
      expect(drawn.printed).toEqual([])
    }
  })
})

describe('Restoring the operator key from its offline copy', () => {
  it('gives the same key back with the passphrase, and nothing without it', async () => {
    const drawn = await draw()
    const kept = readFileSync(drawn.keyFile, 'utf8')
    unlinkSync(drawn.keyFile)

    const refused = await keyToolRun(
      'restaurer',
      ['une autre phrase de passe'],
      {
        home: drawn.home,
        copy: drawn.copy,
      },
    )
    expect(refused.status).toBe(1)
    expect(existsSync(drawn.keyFile)).toBe(false)

    const restored = await keyToolRun('restaurer', [PASSPHRASE], {
      home: drawn.home,
      copy: drawn.copy,
    })
    expect(restored.status).toBe(0)
    expect(JSON.parse(readFileSync(drawn.keyFile, 'utf8'))).toEqual(
      JSON.parse(kept),
    )
    expect(permissionsOf(drawn.keyFile)).toMatch(OWNER_ONLY)
    expect(restored.printed).toEqual(drawn.printed)
  })

  it('refuses to replace a key that exists', async () => {
    const drawn = await draw()
    const kept = readFileSync(drawn.keyFile, 'utf8')

    const again = await keyToolRun('restaurer', [PASSPHRASE], {
      home: drawn.home,
      copy: drawn.copy,
    })

    expect(again.status).toBe(1)
    expect(readFileSync(drawn.keyFile, 'utf8')).toBe(kept)
  })

  it('is not a key the opening tool uses: it says to restore it first', async () => {
    const drawn = await draw()
    const said: string[] = []

    const status = await openTool(['--cle', drawn.copy, 'pli.json'], {
      home: drawn.home,
      stdin: async () => '',
      say: (line: string) => said.push(line),
      print: () => undefined,
    })

    expect(status).toBe(2)
    expect(said.join('\n')).toContain('restaurer')
  })
})
