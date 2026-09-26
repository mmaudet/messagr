import { describe, expect, it } from 'vitest'

import {
  forgetfulDiscoveryResults,
  openDiscoveryResults,
  type Fingerprint,
} from './discoveryResultsStore'
import type { Remembered } from './findContacts'
import type { EncryptedDatabase } from './givenNameStore'

/**
 * A database that answers what SQLite would for the statements this page
 * runs, as `favouriteStore.spec.ts` does: not a SQLite, since what is tested
 * is what the page writes and reads back, and what it never writes.
 */
function fake(refuse: 'none' | 'read' | 'write' = 'none') {
  const ran: { sql: string; params: readonly (string | number)[] }[] = []
  let key: string | null = null
  const rows = new Map<string, Record<string, unknown>>()
  const database: EncryptedDatabase = {
    execute: async (sql, params = []) => {
      ran.push({ sql, params })
      if (sql.startsWith('CREATE')) return { rows: [] }
      if (refuse === 'read' && sql.startsWith('SELECT')) {
        throw new Error('the notebook is unreadable')
      }
      if (refuse === 'write' && sql.startsWith('INSERT')) {
        throw new Error('the notebook is read-only')
      }
      if (sql.startsWith('SELECT key FROM discovery_fingerprint_key')) {
        return { rows: key === null ? [] : [{ key }] }
      }
      if (sql.startsWith('INSERT OR IGNORE INTO discovery_fingerprint_key')) {
        key ??= String(params[0])
        return { rows: [] }
      }
      if (sql.startsWith('SELECT fingerprint'))
        return { rows: [...rows.values()] }
      if (sql.startsWith('INSERT OR REPLACE INTO discovery_results')) {
        for (let at = 0; at < params.length; at += 4) {
          const [fingerprint, key_number, mask, reference] = params.slice(
            at,
            at + 4,
          )
          rows.set(String(fingerprint), {
            fingerprint,
            key_number,
            mask,
            reference,
          })
        }
        return { rows: [] }
      }
      throw new Error(`a statement this fake does not know: ${sql}`)
    },
  }
  return { database, ran, rows }
}

/**
 * A keyed stand-in for the hash, which is not what is tested here: it depends
 * on the key, and holds no digit of the number.
 */
const fingerprint: Fingerprint = (key, number) =>
  `fp${key[0]}-${[...number].map(c => 'abcdefghijk'[Number(c)] ?? 'x').join('')}`

/** A generator that gives a new byte each time, so two devices differ. */
function counting() {
  let next = 0
  return (byteLength: number) =>
    Uint8Array.from({ length: byteLength }, () => (next += 1) % 256)
}

const PAUL = '+33612345678'
const ZOE = '+33698765432'
const found: Remembered = {
  keyNumber: 7,
  mask: 'bWFzaw==',
  reference: 'ref-paul',
}
const none: Remembered = { keyNumber: 7, mask: 'b3RoZXI=', reference: null }

describe('what looking for contacts found (#402)', () => {
  it('recalls what it kept, by number', async () => {
    const page = await openDiscoveryResults(
      fake().database,
      fingerprint,
      counting(),
    )

    expect(
      await page.keep(
        new Map([
          [PAUL, found],
          [ZOE, none],
        ]),
      ),
    ).toBe(true)

    expect(await page.recall([ZOE, PAUL, '+33700000000'])).toEqual(
      new Map([
        [ZOE, none],
        [PAUL, found],
      ]),
    )
  })

  it('writes no number, in any form it was given', async () => {
    const { database, ran } = fake()
    const page = await openDiscoveryResults(database, fingerprint, counting())

    await page.keep(new Map([[PAUL, found]]))
    await page.recall([PAUL])

    const written = JSON.stringify(ran)
    for (const trace of [PAUL, '612345678', '0612345678']) {
      expect(written).not.toContain(trace)
    }
  })

  it('mints its key once, and fingerprints under it', async () => {
    const { database, ran } = fake()
    const page = await openDiscoveryResults(database, fingerprint, counting())

    await page.keep(new Map([[PAUL, found]]))
    await page.keep(new Map([[ZOE, none]]))

    expect(
      ran.filter(one => one.sql.includes('INTO discovery_fingerprint_key')),
    ).toHaveLength(1)
    expect(await page.recall([PAUL, ZOE])).toHaveProperty('size', 2)
  })

  it('gives the same number another fingerprint on another device', async () => {
    const one = fake()
    const other = fake()
    const random = counting()
    await (
      await openDiscoveryResults(one.database, fingerprint, random)
    ).keep(new Map([[PAUL, found]]))
    await (
      await openDiscoveryResults(other.database, fingerprint, random)
    ).keep(new Map([[PAUL, found]]))

    expect([...one.rows.keys()]).not.toEqual([...other.rows.keys()])
  })

  it('keeps a number once, with what it led to last', async () => {
    const { database, rows } = fake()
    const page = await openDiscoveryResults(database, fingerprint, counting())

    await page.keep(new Map([[PAUL, none]]))
    await page.keep(new Map([[PAUL, found]]))

    expect(rows.size).toBe(1)
    expect(await page.recall([PAUL])).toEqual(new Map([[PAUL, found]]))
  })

  it('writes five thousand numbers in a few statements, not one each', async () => {
    const { database, ran } = fake()
    const page = await openDiscoveryResults(database, fingerprint, counting())
    const many = new Map(
      Array.from({ length: 5_000 }, (_, i) => [
        `+336${String(i).padStart(8, '0')}`,
        found,
      ]),
    )

    await page.keep(many)

    const writes = ran.filter(one => one.sql.startsWith('INSERT OR REPLACE'))
    expect(writes).toHaveLength(25)
    expect(
      Math.max(...writes.map(one => one.params.length)),
    ).toBeLessThanOrEqual(999)
    expect((await page.recall([...many.keys()])).size).toBe(5_000)
  })

  it('recalls nothing before its first search, and without minting a key', async () => {
    const { database, ran } = fake()
    const page = await openDiscoveryResults(database, fingerprint, counting())

    expect((await page.recall([PAUL])).size).toBe(0)
    expect(ran.some(one => one.sql.startsWith('INSERT'))).toBe(false)
  })

  it('drops a row of the wrong shape rather than failing a search', async () => {
    const { database, rows } = fake()
    const page = await openDiscoveryResults(database, fingerprint, counting())
    await page.keep(
      new Map([
        [PAUL, found],
        [ZOE, none],
      ]),
    )
    const [first] = rows.keys()
    rows.set(first!, { ...rows.get(first!), key_number: 'seven' })

    expect([...(await page.recall([PAUL, ZOE])).keys()]).toEqual([ZOE])
  })

  it('recalls nothing when the page will not open, and says a keep did not hold', async () => {
    const unreadable = await openDiscoveryResults(
      fake('read').database,
      fingerprint,
      counting(),
    )
    expect((await unreadable.recall([PAUL])).size).toBe(0)

    const readOnly = await openDiscoveryResults(
      fake('write').database,
      fingerprint,
      counting(),
    )
    expect(await readOnly.keep(new Map([[PAUL, found]]))).toBe(false)
  })

  it('a device without a notebook recalls nothing and keeps nothing', async () => {
    const page = forgetfulDiscoveryResults()
    expect(await page.keep(new Map([[PAUL, found]]))).toBe(false)
    expect((await page.recall([PAUL])).size).toBe(0)
  })
})
