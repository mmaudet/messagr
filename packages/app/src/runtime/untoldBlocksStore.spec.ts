import { describe, expect, it } from 'vitest'

import type { EncryptedDatabase } from './givenNameStore'
import { forgetfulUntoldBlocks, openUntoldBlocks } from './untoldBlocksStore'

/** A notebook page in memory, which can refuse to be written or read. */
function fake(refuse: 'write' | 'read' | 'none' = 'none') {
  const rows = new Map<string, number>()
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
        rows.set(String(params[0]), Number(params[1]))
        return { rows: [] }
      }
      if (sql.startsWith('DELETE')) {
        rows.delete(String(params[0]))
        return { rows: [] }
      }
      return {
        rows: [...rows].map(([account, at]) => ({ account, at })),
      }
    },
  }
  return { database, rows }
}

describe('the blocks the service has not heard of yet', () => {
  it('keeps an account until the service has heard of its block', async () => {
    const page = await openUntoldBlocks(fake().database, () => 7)

    expect(await page.remember('@a:x')).toBe(true)
    expect(await page.remember('@b:x')).toBe(true)
    expect(await page.all()).toEqual(['@a:x', '@b:x'])
    expect(await page.forget('@a:x')).toBe(true)
    expect(await page.all()).toEqual(['@b:x'])
  })

  it('keeps an account once however many times it is remembered', async () => {
    const { database, rows } = fake()
    const page = await openUntoldBlocks(database)

    await page.remember('@a:x')
    await page.remember('@a:x')

    expect(rows.size).toBe(1)
  })

  it('drops a row of the wrong shape rather than asking the service about it', async () => {
    const page = await openUntoldBlocks({
      execute: async sql =>
        sql.startsWith('SELECT')
          ? { rows: [{ account: 42 }, { account: '' }, { account: '@a:x' }] }
          : { rows: [] },
    })
    expect(await page.all()).toEqual(['@a:x'])
  })

  it('says so when it could not keep or forget, and reads nothing it cannot open', async () => {
    const readOnly = await openUntoldBlocks(fake('write').database)
    expect(await readOnly.remember('@a:x')).toBe(false)
    expect(await readOnly.forget('@a:x')).toBe(false)
    const unreadable = await openUntoldBlocks(fake('read').database)
    expect(await unreadable.all()).toEqual([])
  })

  it('without a notebook, keeps nothing and says so', async () => {
    const page = forgetfulUntoldBlocks()
    expect(await page.remember('@a:x')).toBe(false)
    expect(await page.all()).toEqual([])
  })
})
