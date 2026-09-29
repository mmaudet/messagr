import { describe, expect, it } from 'vitest'

import type { EncryptedDatabase } from './givenNameStore'
import { forgetfulIgnoredList, openIgnoredList } from './ignoredListStore'

/** The page in memory: the one row it keeps, or none. */
function fake(refuse: 'write' | 'read' | 'none' = 'none') {
  const row: { accounts?: string } = {}
  const database: EncryptedDatabase = {
    execute: async (sql, params = []) => {
      if (sql.startsWith('CREATE')) return { rows: [] }
      if (refuse === 'read' && sql.startsWith('SELECT')) {
        throw new Error('the notebook is unreadable')
      }
      if (refuse === 'write' && !sql.startsWith('SELECT')) {
        throw new Error('the notebook is read-only')
      }
      if (sql.startsWith('INSERT')) {
        row.accounts = String(params[0])
        return { rows: [] }
      }
      return {
        rows: row.accounts === undefined ? [] : [{ accounts: row.accounts }],
      }
    },
  }
  return { database, row }
}

describe('the ignored list, as the homeserver last said it', () => {
  it('knows nothing until the homeserver has said something', async () => {
    const page = await openIgnoredList(fake().database)
    expect(await page.read()).toBeNull()
  })

  it('reads back the list it was given, whole, and replaced by the next', async () => {
    const page = await openIgnoredList(fake().database)

    expect(await page.keep(new Set(['@a:x', '@b:x']))).toBe(true)
    expect([...((await page.read()) ?? [])].sort()).toEqual(['@a:x', '@b:x'])
    // A list emptied elsewhere empties this one: it holds what the
    // homeserver says, never more.
    await page.keep(new Set())
    expect([...((await page.read()) ?? ['?'])]).toEqual([])
  })

  it('reads a row it cannot make sense of as knowing nothing', async () => {
    for (const accounts of ['not json', '{"a":1}', '[1,"@a:x"]']) {
      const page = await openIgnoredList({
        execute: async sql =>
          sql.startsWith('SELECT') ? { rows: [{ accounts }] } : { rows: [] },
      })
      const read = await page.read()
      if (accounts === '[1,"@a:x"]') {
        expect([...(read ?? [])]).toEqual(['@a:x'])
      } else {
        expect(read).toBeNull()
      }
    }
  })

  it('says so when it could not keep, and reads nothing it cannot open', async () => {
    expect(
      await (await openIgnoredList(fake('write').database)).keep(new Set()),
    ).toBe(false)
    expect(
      await (await openIgnoredList(fake('read').database)).read(),
    ).toBeNull()
  })

  it('without a notebook, keeps nothing and knows nothing', async () => {
    const page = forgetfulIgnoredList()
    expect(await page.keep(new Set(['@a:x']))).toBe(false)
    expect(await page.read()).toBeNull()
  })
})
