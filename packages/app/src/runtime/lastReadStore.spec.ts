import { describe, expect, it } from 'vitest'

import type { EncryptedDatabase } from './givenNameStore'
import { forgetfulLastRead, openLastRead } from './lastReadStore'

/** A database that remembers, so the store can be driven without a device. */
function fake(): EncryptedDatabase & { readonly sql: string[] } {
  const table = new Map<string, number>()
  const sql: string[] = []
  return {
    sql,
    execute: async (statement, params = []) => {
      sql.push(statement.replace(/\s+/g, ' ').trim())
      if (statement.startsWith('CREATE')) return { rows: [] }
      if (statement.startsWith('SELECT')) {
        return {
          rows: [...table].map(([scope, at]) => ({ scope, at })),
        }
      }
      const [scope, at] = params as [string, number]
      table.set(scope, Math.max(table.get(scope) ?? 0, at))
      return { rows: [] }
    },
  }
}

describe('openLastRead', () => {
  it('creates its table on every open, so a first launch is not special', async () => {
    const database = fake()
    await openLastRead(database)
    expect(database.sql[0]).toContain('CREATE TABLE IF NOT EXISTS last_read')
  })

  it('remembers a mark and reads it back', async () => {
    const marks = await openLastRead(fake())
    expect(await marks.set('!a:messagr.eu', 1700)).toBe(true)
    expect(await marks.all()).toEqual(new Map([['!a:messagr.eu', 1700]]))
  })

  it('knows nothing about a conversation never opened', async () => {
    const marks = await openLastRead(fake())
    expect(await marks.all()).toEqual(new Map())
  })

  it('skips a row of the wrong shape rather than losing the launch', async () => {
    const marks = await openLastRead({
      execute: async () => ({
        rows: [
          { scope: '!good:messagr.eu', at: 12 },
          { scope: 42, at: 12 },
          { scope: '!bad:messagr.eu', at: 'soon' },
        ],
      }),
    })
    expect(await marks.all()).toEqual(new Map([['!good:messagr.eu', 12]]))
  })

  it('answers false rather than throwing when the write will not hold', async () => {
    const marks = await openLastRead({
      execute: async sql => {
        if (sql.startsWith('CREATE')) return { rows: [] }
        throw new Error('disk is full')
      },
    })
    expect(await marks.set('!a:messagr.eu', 1)).toBe(false)
  })
})

describe('forgetfulLastRead', () => {
  it('remembers nothing and says so', async () => {
    const marks = forgetfulLastRead()
    expect(await marks.set('!a:messagr.eu', 5)).toBe(false)
    expect(await marks.all()).toEqual(new Map())
  })
})
