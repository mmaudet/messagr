import { Buffer } from 'node:buffer'
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
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

import {
  excludeFromTimeMachine,
  keyTool,
} from '../../../../scripts/lib/cle-de-l-exploitant.mjs'
import { openTool } from '../../../../scripts/lib/ouvrir-un-signalement.mjs'
import { bytesOf } from './base64'
import { generateKeyPair } from './hpke'
import { OPERATOR_KEY } from './operatorKey'
import { base64Of } from './receiveImage'
import { sealReportWithEphemeral } from './sealedReport'

/**
 * The operator key (#465, the glossary's « Operator key »): its public half
 * built into the application, the tool that keeps the pair on the operator's
 * machine (`scripts/cle-de-l-exploitant.mjs`), and the guard that keeps the
 * test key out of a store build (`scripts/assert-operator-key.mjs`).
 *
 * # TRUE WITH THE TEST KEY, AND AFTER #470
 *
 * Nothing here reads which key the module carries today. The guard is run on
 * copies of the real module, with the test key put in and with another, so
 * these tests hold the day #470 replaces the test key, as they hold now.
 *
 * # NEVER THE REAL HOME, NEVER THE REAL TIME MACHINE
 *
 * Every home directory here is a temporary one, and Time Machine a double
 * that says what it was asked. `tmutil` itself is only driven through a
 * runner that answers as it does.
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

/** What Time Machine was asked to leave out, and how big each file was then. */
interface Excluded {
  readonly path: string
  readonly bytes: number
}

interface Place {
  readonly home?: string
  readonly copy?: string
  /** Time Machine refuses, with this reason. */
  readonly refusal?: string
}

interface Run {
  readonly status: number
  readonly said: string
  readonly printed: readonly string[]
  readonly home: string
  readonly copy: string
  readonly keyFile: string
  readonly asked: number
  readonly excluded: readonly Excluded[]
}

async function keyToolRun(
  gesture: string,
  answers: readonly string[],
  place: Place = {},
): Promise<Run> {
  const home = place.home ?? mkdtempSync(join(tmpdir(), 'exploitant-'))
  const copy =
    place.copy ??
    join(mkdtempSync(join(tmpdir(), 'hors-ligne-')), 'cle.copie.json')
  const said: string[] = []
  const printed: string[] = []
  const excluded: Excluded[] = []
  const terminal = typed(...answers)
  const status = await keyTool([gesture, copy], {
    home,
    ask: terminal.ask,
    stderr: (line: string) => said.push(line),
    stdout: (line: string) => printed.push(line),
    excludeFromBackups: (path: string) => {
      if (place.refusal !== undefined) throw new Error(place.refusal)
      excluded.push({ path, bytes: statSync(path).size })
    },
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
    excluded,
  }
}

function draw(place: Place = {}): Promise<Run> {
  return keyToolRun('tirer', [PASSPHRASE, PASSPHRASE], place)
}

function secretIn(keyFile: string): string {
  return (JSON.parse(readFileSync(keyFile, 'utf8')) as { secret_key: string })
    .secret_key
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
      // The test key, with bits left over after its last byte.
      "export const OPERATOR_KEY = 'mD3vxUbnchoghIM22hYScz6J+lmbQuZTjX22y4FoSDZ='",
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
    expect(permissionsOf(join(drawn.home, '.messagr-exploitation'))).toBe('700')
  })

  it('leaves it out of Time Machine before a byte of it is written, and says so', async () => {
    const drawn = await draw()

    expect(drawn.excluded).toEqual([{ path: drawn.keyFile, bytes: 0 }])
    expect(drawn.said).toContain('Time Machine')
  })

  it('keeps nothing when Time Machine will not leave it out, and says why', async () => {
    const drawn = await draw({ refusal: 'tmutil a refusé' })

    expect(drawn.status).toBe(1)
    expect(existsSync(drawn.keyFile)).toBe(false)
    expect(existsSync(drawn.copy)).toBe(false)
    expect(drawn.printed).toEqual([])
    expect(drawn.said).toContain('tmutil a refusé')
  })

  it('tightens an existing ~/.messagr-exploitation to 700, keeping what it holds', async () => {
    const home = mkdtempSync(join(tmpdir(), 'exploitant-'))
    const directory = join(home, '.messagr-exploitation')
    mkdirSync(directory)
    chmodSync(directory, 0o755)
    writeFileSync(join(directory, 'messagr-eu.json'), '{}', { mode: 0o600 })

    const drawn = await draw({ home })

    expect(drawn.status).toBe(0)
    expect(permissionsOf(directory)).toBe('700')
    expect(readdirSync(directory).sort()).toEqual([
      'cle-de-l-exploitant.json',
      'messagr-eu.json',
    ])
    expect(drawn.said).toContain('755')
  })

  it('writes one offline copy, where it is told, that does not show the key', async () => {
    const drawn = await draw()
    const secret = secretIn(drawn.keyFile)
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
    const secret = secretIn(drawn.keyFile)
    const everything = `${drawn.said}\n${drawn.printed.join('\n')}`

    expect(everything).not.toContain(secret)
    expect(everything).not.toContain(
      Buffer.from(secret, 'base64').toString('hex'),
    )
  })

  it('prints the public half, alone on stdout, as the line of the application’s module', async () => {
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
    const binding = { reason: 'threat', reporter: '@alice:example.org' }
    const sealed = sealReportWithEphemeral(
      generateKeyPair(),
      new TextEncoder().encode('pour la clé tirée'),
      binding,
      publicKey,
    )
    const pli = join(mkdtempSync(join(tmpdir(), 'pli-')), 'pli.json')
    writeFileSync(pli, JSON.stringify({ ...binding, sealed }))
    const printed: string[] = []
    const status = await openTool([pli], {
      home: drawn.home,
      stdin: async () => '',
      stderr: () => undefined,
      stdout: (text: string) => printed.push(text),
    })
    expect(status).toBe(0)
    expect(printed).toEqual(['pour la clé tirée'])
  })

  it('refuses to replace a key that exists, before asking anything, and writes nothing', async () => {
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
    const place = { home: drawn.home, copy: drawn.copy }

    const refused = await keyToolRun(
      'restaurer',
      ['une autre phrase de passe'],
      place,
    )
    expect(refused.status).toBe(1)
    expect(existsSync(drawn.keyFile)).toBe(false)

    const restored = await keyToolRun('restaurer', [PASSPHRASE], place)
    expect(restored.status).toBe(0)
    expect(JSON.parse(readFileSync(drawn.keyFile, 'utf8'))).toEqual(
      JSON.parse(kept),
    )
    expect(permissionsOf(drawn.keyFile)).toMatch(OWNER_ONLY)
    expect(restored.excluded).toEqual([{ path: drawn.keyFile, bytes: 0 }])
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
      stderr: (line: string) => said.push(line),
      stdout: () => undefined,
    })

    expect(status).toBe(2)
    expect(said.join('\n')).toContain('restaurer')
  })
})

describe('Leaving the key out of Time Machine', () => {
  /** A `tmutil` that answers `isexcluded` with `answer`, and says what it ran. */
  function tmutil(answer: string | Error): {
    readonly run: (command: string, args: string[]) => string
    readonly ran: string[]
  } {
    const ran: string[] = []
    return {
      ran,
      run: (command, args) => {
        ran.push([command, ...args].join(' '))
        if (answer instanceof Error) throw answer
        return args[0] === 'isexcluded' ? answer : ''
      },
    }
  }

  it('asks tmutil to leave the file out, then checks that it did', () => {
    const { run, ran } = tmutil('[Excluded]  /home/cle.json\n')

    excludeFromTimeMachine('/home/cle.json', run)

    expect(ran).toEqual([
      'tmutil addexclusion /home/cle.json',
      'tmutil isexcluded /home/cle.json',
    ])
  })

  it('refuses when tmutil says the file is still backed up', () => {
    const { run } = tmutil('[Included]  /home/cle.json\n')

    expect(() => excludeFromTimeMachine('/home/cle.json', run)).toThrow(
      /\[Included\]/,
    )
  })

  it('refuses when tmutil cannot run, and names it', () => {
    const absent = Object.assign(new Error('spawnSync tmutil ENOENT'), {
      code: 'ENOENT',
    })
    const { run } = tmutil(absent)

    expect(() => excludeFromTimeMachine('/home/cle.json', run)).toThrow(
      /tmutil addexclusion.*ENOENT/,
    )
  })
})
