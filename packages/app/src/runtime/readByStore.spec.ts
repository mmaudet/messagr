import { describe, expect, it } from 'vitest'

import type { EncryptedDatabase } from './givenNameStore'
import { forgetfulReadBy, openReadBy } from './readByStore'

function fake(
  rows: Record<string, unknown>[] = [],
  refuse: 'write' | 'read' | 'none' = 'none',
) {
  const ran: { sql: string; params?: readonly (string | number)[] }[] = []
  const database: EncryptedDatabase = {
    execute: async (sql, params) => {
      ran.push({ sql, params })
      if (refuse === 'write' && sql.startsWith('INSERT')) {
        throw new Error('the notebook is read-only')
      }
      if (refuse === 'read' && sql.startsWith('SELECT')) {
        throw new Error('the notebook is unreadable')
      }
      return { rows: sql.startsWith('SELECT') ? rows : [] }
    },
  }
  return { database, ran }
}

describe('how far the other person has read', () => {
  it('reads its marks back', async () => {
    const kept = await openReadBy(
      fake([{ scope: '!a:x', at: 1_700_000_000_000 }]).database,
    )
    expect((await kept.all()).get('!a:x')).toBe(1_700_000_000_000)
  })

  it('raises a mark with MAX, so a late poll cannot lower it', async () => {
    // The writes race: a poll can resolve an older receipt after a newer one
    // is recorded, and a mark that moved back would take a tick off a
    // message somebody has plainly read.
    const { database, ran } = fake()
    const kept = await openReadBy(database)
    expect(await kept.raise('!a:x', 200)).toBe(true)
    const written = ran.find(one => one.sql.startsWith('INSERT'))
    expect(written?.sql).toContain('MAX(at, excluded.at)')
  })

  it('skips a row of the wrong shape rather than losing the launch', async () => {
    const kept = await openReadBy(
      fake([
        { scope: 42, at: 1 },
        { scope: '!a:x', at: 'hier' },
        { scope: '!b:x', at: 5 },
      ]).database,
    )
    const marks = await kept.all()
    expect([...marks.keys()]).toEqual(['!b:x'])
  })

  it('answers an empty map rather than throwing when it will not open', async () => {
    // A conversation with no second tick is what yesterday already looked
    // like; losing the launch over it would be worse.
    const kept = await openReadBy(fake([], 'read').database)
    expect((await kept.all()).size).toBe(0)
  })

  it('says so when a mark could not be kept', async () => {
    const kept = await openReadBy(fake([], 'write').database)
    expect(await kept.raise('!a:x', 1)).toBe(false)
  })

  it('a device without a notebook knows no marks and keeps none', async () => {
    const kept = forgetfulReadBy()
    expect((await kept.all()).size).toBe(0)
    expect(await kept.raise('!a:x', 1)).toBe(false)
  })
})
