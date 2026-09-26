import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { AcceptBackupDeps } from './acceptBackup'
import type { ReplaceBackupDeps } from './replaceBackup'

/**
 * That the backup's sequences are actually bound to something.
 *
 * # WHY THIS IS READ FROM THE SOURCE
 *
 * `cryptoPump.ts` is the one place where `acceptBackup` and `replaceBackup`
 * meet the bridge, the keystore and the homeserver — and it is the one place
 * no test in this workspace can import. It reads
 * `react-native-matrix-crypto` as a value, which installs a native JSI
 * bootstrap as a side effect and takes the test runner's parser down with it;
 * `acceptBackup.ts` and `outgoingPumpCycle.ts` both say so, and it is the
 * reason every dependency here is injected in the first place.
 *
 * So the sequences are proved against doubles, and nothing proved that the
 * real call site passes anything. **That gap has cost this repository twice**:
 * finished units nobody called, invisible to the whole chain, because a
 * missing binding is the behaviour of no unit.
 *
 * TypeScript catches a *missing* property on an object literal, which is most
 * of it. What it does not catch is the shape this defect actually takes here:
 * a dependency added as optional to spare a call site, or one bound to a stub
 * while the real reading is written "next". Both compile. Neither is a
 * binding.
 *
 * This reads the file as text and asks one question of it: does the object
 * handed to each sequence name every dependency that sequence declares, and
 * does each name point at something from this module rather than nothing?
 *
 * # THE OTHER HALF IS IN `replaceBackup.spec.ts`
 *
 * A binding that exists and is never reached is the same defect wearing a
 * coat, so `commitment` is read on every replacement rather than only on the
 * ones that fail — the ordinary gesture is what exercises it, on a bench and
 * on a telephone. That is asserted there, where the sequence is.
 */

/**
 * The module, with its comments taken out.
 *
 * A comment carrying an unmatched brace or parenthesis would send the walk
 * below off the end of the object it is reading, and this file's comments
 * are long. `copy.spec.ts` strips the same two forms for the same reason.
 */
const SOURCE = readFileSync(join(__dirname, 'cryptoPump.ts'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')

/**
 * Every dependency each sequence declares, as a value.
 *
 * `Record<keyof Deps, true>` rather than a list: a dependency added to the
 * interface and not here fails to compile, so this cannot fall behind the
 * type it is checking. That is the whole reason it is written this way round.
 */
const ACCEPT: Record<keyof AcceptBackupDeps, true> = {
  rememberAsked: true,
  createKeyBackup: true,
  publishVersion: true,
  remember: true,
  enable: true,
  forget: true,
}

const REPLACE: Record<keyof ReplaceBackupDeps, true> = {
  ...ACCEPT,
  currentVersion: true,
  commitment: true,
  retire: true,
}

/**
 * The properties of the object literal handed to `call(` in `cryptoPump.ts`.
 *
 * Read by walking the braces rather than by a pattern: the values are
 * arrow functions holding objects and calls of their own, and a regular
 * expression over the whole slice would collect their properties too.
 */
function boundBy(call: string): Map<string, string> {
  const opens = SOURCE.indexOf(`${call}({`)
  expect(opens).toBeGreaterThan(-1)
  const bound = new Map<string, string>()
  let depth = 0
  let line = ''
  const take = () => {
    // `name: value`, or the shorthand `name`, which binds the import of that
    // name and is a binding like any other.
    const named = /^\s*([A-Za-z]\w*)\s*(:?)([\s\S]*)$/.exec(line)
    line = ''
    if (named === null || named[1] === undefined) return
    const value = named[2] === ':' ? (named[3] ?? '').trim() : named[1]
    if (value !== '') bound.set(named[1], value)
  }
  for (let at = opens + call.length + 1; at < SOURCE.length; at += 1) {
    const character = SOURCE[at]
    if (character === '{' || character === '(' || character === '[') {
      depth += 1
      if (depth > 1) line += character
      continue
    }
    if (character === '}' || character === ')' || character === ']') {
      depth -= 1
      if (depth === 0) break
      line += character
      continue
    }
    // A property ends at the comma or at the end of its line; deeper than
    // that, both belong to a value and are kept.
    if (depth === 1 && (character === ',' || character === '\n')) {
      take()
      continue
    }
    line += character
  }
  take()
  return bound
}

describe('what cryptoPump.ts hands the backup sequences', () => {
  it.each([
    ['acceptBackup', ACCEPT],
    ['replaceBackup', REPLACE],
  ] as const)('binds every dependency %s declares', (call, declared) => {
    const bound = boundBy(call)

    expect([...Object.keys(declared)].sort()).toEqual([...bound.keys()].sort())
  })

  it('binds the commitment a failed replacement puts back, to the keystore (#327)', () => {
    // Named rather than left to the count above, because this is the one the
    // ticket is about and because the value matters as much as the key: the
    // entry `resumeKeyBackup` reads on every launch is the entry a rollback
    // has to write again, and a binding to anything else would put a device
    // back on a backup it never fed.
    expect(boundBy('replaceBackup').get('commitment')).toBe(
      '() => readBackupCommitment(backupSecrets)',
    )
  })

  it('binds nothing to a placeholder', () => {
    // The shape TypeScript cannot see: a property that is there, types, and
    // does nothing. A sequence handed one of these is a sequence whose step
    // never runs, which is what a binding is supposed to stop.
    const inert = [...boundBy('replaceBackup').entries()].filter(([, value]) =>
      /^(?:undefined|null|async \(\) => \{\}|\(\) => \{\}|\(\) => undefined|\(\) => null)$/.test(
        value,
      ),
    )

    expect(inert).toEqual([])
  })
})
