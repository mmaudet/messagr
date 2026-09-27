import { describe, expect, it } from 'vitest'

import {
  forgetfulDiscoveryResults,
  openDiscoveryResults,
} from './discoveryResultsStore'
import type { Remembered } from './findContacts'
import type { EncryptedDatabase } from './givenNameStore'

/**
 * A database that answers what SQLite would for the statements this page
 * runs, as `favouriteStore.spec.ts` does: not a SQLite, since what is tested
 * is what the page writes and reads back, and what it never writes. Rows are
 * keyed by fingerprint and key number, as the table is.
 */
function fake(refuse: 'none' | 'read' | 'write' = 'none') {
  const ran: { sql: string; params: readonly (string | number)[] }[] = []
  let key: string | null = null
  const rows = new Map<string, Record<string, unknown>>()
  /** The names of cards found, by fingerprint (#407). */
  const names = new Map<string, string>()
  const database: EncryptedDatabase = {
    execute: async (sql, params = []) => {
      ran.push({ sql, params })
      if (sql.startsWith('CREATE')) return { rows: [] }
      if (refuse === 'read' && sql.startsWith('SELECT')) {
        throw new Error('the notebook is unreadable')
      }
      if (
        refuse === 'write' &&
        (sql.startsWith('INSERT') || sql.startsWith('DELETE'))
      ) {
        throw new Error('the notebook is read-only')
      }
      if (sql.startsWith('SELECT key FROM discovery_fingerprint_key')) {
        return { rows: key === null ? [] : [{ key }] }
      }
      if (sql.startsWith('INSERT OR IGNORE INTO discovery_fingerprint_key')) {
        key ??= String(params[0])
        return { rows: [] }
      }
      if (sql.startsWith('SELECT fingerprint, mask, reference')) {
        return {
          rows: [...rows.values()].filter(row => row.key_number === params[0]),
        }
      }
      if (sql.startsWith('SELECT fingerprint FROM discovery_results UNION')) {
        return {
          rows: [
            ...new Set([
              ...[...rows.values()].map(row => row.fingerprint),
              ...names.keys(),
            ]),
          ].map(fingerprint => ({ fingerprint })),
        }
      }
      if (sql.startsWith('INSERT OR REPLACE INTO discovery_found_names')) {
        for (let at = 0; at < params.length; at += 2) {
          names.set(String(params[at]), String(params[at + 1]))
        }
        return { rows: [] }
      }
      if (
        sql.startsWith('DELETE FROM discovery_found_names WHERE fingerprint IN')
      ) {
        for (const fingerprint of params) names.delete(String(fingerprint))
        return { rows: [] }
      }
      if (sql.startsWith('SELECT n.name AS name FROM discovery_found_names')) {
        for (const row of rows.values()) {
          const name = names.get(row.fingerprint as string)
          if (row.reference === params[0] && name !== undefined) {
            return { rows: [{ name }] }
          }
        }
        return { rows: [] }
      }
      if (sql.startsWith('INSERT OR REPLACE INTO discovery_results')) {
        for (let at = 0; at < params.length; at += 4) {
          const [fingerprint, key_number, mask, reference] = params.slice(
            at,
            at + 4,
          )
          rows.set(`${fingerprint}/${key_number}`, {
            fingerprint,
            key_number,
            mask,
            reference,
          })
        }
        return { rows: [] }
      }
      if (
        sql.startsWith('DELETE FROM discovery_results WHERE fingerprint IN')
      ) {
        for (const [id, row] of rows) {
          if (params.includes(row.fingerprint as string)) rows.delete(id)
        }
        return { rows: [] }
      }
      throw new Error(`a statement this fake does not know: ${sql}`)
    },
  }
  return { database, ran, rows, names }
}

/** A generator that gives a new byte each time, so two devices differ. */
function counting() {
  let next = 0
  return (byteLength: number) =>
    Uint8Array.from({ length: byteLength }, () => (next += 1) % 256)
}

const KEY = 7
const PAUL = '+33612345678'
const ZOE = '+33698765432'
const found: Remembered = { mask: 'bWFzaw==', reference: 'ref-paul' }
const none: Remembered = { mask: 'b3RoZXI=', reference: null }

describe('what looking for contacts found (#402)', () => {
  it('recalls what it kept, by number', async () => {
    const page = await openDiscoveryResults(fake().database, counting())

    expect(
      await page.keep(
        KEY,
        new Map([
          [PAUL, found],
          [ZOE, none],
        ]),
      ),
    ).toBe(true)

    expect(await page.recall(KEY, [ZOE, PAUL, '+33700000000'])).toEqual(
      new Map([
        [ZOE, none],
        [PAUL, found],
      ]),
    )
  })

  it('writes no number, in any form it was given', async () => {
    const { database, ran } = fake()
    const page = await openDiscoveryResults(database, counting())

    await page.keep(KEY, new Map([[PAUL, found]]))
    await page.recall(KEY, [PAUL])
    await page.forgetAllBut([PAUL])

    const written = JSON.stringify(ran)
    for (const trace of [PAUL, '612345678', '0612345678']) {
      expect(written).not.toContain(trace)
    }
  })

  it('mints its key once', async () => {
    const { database, ran } = fake()
    const page = await openDiscoveryResults(database, counting())

    await page.keep(KEY, new Map([[PAUL, found]]))
    await page.keep(KEY, new Map([[ZOE, none]]))

    expect(
      ran.filter(one => one.sql.includes('INTO discovery_fingerprint_key')),
    ).toHaveLength(1)
    expect((await page.recall(KEY, [PAUL, ZOE])).size).toBe(2)
  })

  it('gives the same number another fingerprint on another device', async () => {
    const one = fake()
    const other = fake()
    const random = counting()
    await (
      await openDiscoveryResults(one.database, random)
    ).keep(KEY, new Map([[PAUL, found]]))
    await (
      await openDiscoveryResults(other.database, random)
    ).keep(KEY, new Map([[PAUL, found]]))

    expect([...one.rows.keys()]).not.toEqual([...other.rows.keys()])
  })

  it('keeps a number once under a key, with what it led to last', async () => {
    const { database, rows } = fake()
    const page = await openDiscoveryResults(database, counting())

    await page.keep(KEY, new Map([[PAUL, none]]))
    await page.keep(KEY, new Map([[PAUL, found]]))

    expect(rows.size).toBe(1)
    expect(await page.recall(KEY, [PAUL])).toEqual(new Map([[PAUL, found]]))
  })

  it('keeps a number under each key apart, and recalls under the key asked', async () => {
    const page = await openDiscoveryResults(fake().database, counting())
    const underTheNext: Remembered = { mask: 'bmV4dA==', reference: null }

    await page.keep(KEY, new Map([[PAUL, found]]))
    await page.keep(KEY + 1, new Map([[PAUL, underTheNext]]))

    expect(await page.recall(KEY, [PAUL])).toEqual(new Map([[PAUL, found]]))
    expect(await page.recall(KEY + 1, [PAUL])).toEqual(
      new Map([[PAUL, underTheNext]]),
    )
  })

  it('forgets the numbers that left the address book, under every key', async () => {
    const page = await openDiscoveryResults(fake().database, counting())
    await page.keep(
      KEY,
      new Map([
        [PAUL, found],
        [ZOE, none],
      ]),
    )
    await page.keep(KEY + 1, new Map([[ZOE, none]]))

    expect(await page.forgetAllBut([PAUL])).toBe(true)

    expect([...(await page.recall(KEY, [PAUL, ZOE])).keys()]).toEqual([PAUL])
    expect((await page.recall(KEY + 1, [PAUL, ZOE])).size).toBe(0)
  })

  it('writes five thousand numbers in a few statements, not one each', async () => {
    const { database, ran } = fake()
    const page = await openDiscoveryResults(database, counting())
    const many = new Map(
      Array.from({ length: 5_000 }, (_, i) => [
        `+336${String(i).padStart(8, '0')}`,
        found,
      ]),
    )

    await page.keep(KEY, many)
    await page.keepNames(new Map([...many.keys()].map(n => [n, 'Paul'])))
    await page.forgetAllBut([])

    const writes = ran.filter(one => one.sql.startsWith('INSERT OR REPLACE'))
    const forgets = ran.filter(one => one.sql.startsWith('DELETE'))
    // The rows, then the names (#407): twenty-five statements each.
    expect(writes).toHaveLength(50)
    // Six handfuls of fingerprints, forgotten from both tables.
    expect(forgets).toHaveLength(12)
    for (const one of [...writes, ...forgets]) {
      expect(one.params.length).toBeLessThanOrEqual(999)
    }
    expect((await page.recall(KEY, [...many.keys()])).size).toBe(0)
  })

  it('recalls nothing before its first look, and without minting a key', async () => {
    const { database, ran } = fake()
    const page = await openDiscoveryResults(database, counting())

    expect((await page.recall(KEY, [PAUL])).size).toBe(0)
    expect(await page.forgetAllBut([])).toBe(true)
    expect(
      ran.some(
        one => !one.sql.startsWith('CREATE') && !one.sql.startsWith('SELECT'),
      ),
    ).toBe(false)
  })

  it('drops a row of the wrong shape rather than failing a look', async () => {
    const { database, rows } = fake()
    const page = await openDiscoveryResults(database, counting())
    await page.keep(
      KEY,
      new Map([
        [PAUL, found],
        [ZOE, none],
      ]),
    )
    const [first] = rows.keys()
    rows.set(first!, { ...rows.get(first!), mask: 42 })

    expect([...(await page.recall(KEY, [PAUL, ZOE])).keys()]).toEqual([ZOE])
  })

  it('recalls nothing when the page will not open, and says a write did not hold', async () => {
    const unreadable = await openDiscoveryResults(
      fake('read').database,
      counting(),
    )
    expect((await unreadable.recall(KEY, [PAUL])).size).toBe(0)

    const readOnly = await openDiscoveryResults(
      fake('write').database,
      counting(),
    )
    expect(await readOnly.keep(KEY, new Map([[PAUL, found]]))).toBe(false)
  })

  it('a device without a notebook recalls nothing and keeps nothing', async () => {
    const page = forgetfulDiscoveryResults()
    expect(await page.keep(KEY, new Map([[PAUL, found]]))).toBe(false)
    expect(await page.forgetAllBut([PAUL])).toBe(false)
    expect((await page.recall(KEY, [PAUL])).size).toBe(0)
  })

  it('keeps the name of a card found, and gives it back by the reference its number led to (#407)', async () => {
    const page = await openDiscoveryResults(fake().database, counting())
    await page.keep(
      KEY,
      new Map([
        [PAUL, found],
        [ZOE, none],
      ]),
    )

    expect(await page.keepNames(new Map([[PAUL, 'Paul Martin']]))).toBe(true)

    expect(await page.nameOf('ref-paul')).toBe('Paul Martin')
    expect(await page.nameOf('ref-other')).toBeNull()
  })

  it('forgets the name with its number, and writes no number for it either', async () => {
    const { database, ran, names } = fake()
    const page = await openDiscoveryResults(database, counting())
    await page.keep(KEY, new Map([[PAUL, found]]))
    await page.keepNames(new Map([[PAUL, 'Paul Martin']]))

    expect(await page.forgetAllBut([ZOE])).toBe(true)

    expect(await page.nameOf('ref-paul')).toBeNull()
    expect(names.size).toBe(0)
    const written = ran.flatMap(one => one.params.map(String)).join(' ')
    expect(written).not.toContain('12345678')
  })

  it('names nobody when the page will not open, and says a write did not hold', async () => {
    const reading = await openDiscoveryResults(
      fake('read').database,
      counting(),
    )
    expect(await reading.nameOf('ref-paul')).toBeNull()

    const writing = await openDiscoveryResults(
      fake('write').database,
      counting(),
    )
    expect(await writing.keepNames(new Map([[PAUL, 'Paul']]))).toBe(false)
    expect(await forgetfulDiscoveryResults().nameOf('ref-paul')).toBeNull()
  })
})
