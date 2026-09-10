import { describe, expect, it } from 'vitest'

import { forgetfulFavourites, openFavourites } from './favouriteStore'
import type { EncryptedDatabase } from './givenNameStore'

/**
 * A database that answers what SQLite would for the four statements this page
 * runs. Not a SQLite: what is being tested is the reading, the defensive
 * drops and the idempotence, none of which need a real engine.
 */
function fake(rows: Record<string, unknown>[] = [], refuse = false) {
  const ran: { sql: string; params?: readonly (string | number)[] }[] = []
  const database: EncryptedDatabase = {
    execute: async (sql, params) => {
      ran.push({ sql, params })
      if (refuse && !sql.startsWith('CREATE')) {
        throw new Error('the notebook is unreadable')
      }
      return { rows: sql.startsWith('SELECT') ? rows : [] }
    },
  }
  return { database, ran }
}

const ROW = { event_id: '$one', scope: '!a:x', at: 1_700_000_000_000 }

describe('the messages somebody kept', () => {
  it('reads one back as it was written', async () => {
    const kept = await openFavourites(fake([ROW]).database)
    expect(await kept.all()).toEqual([
      { eventId: '$one', scope: '!a:x', at: 1_700_000_000_000 },
    ])
  })

  it('asks for the newest first, which is how a list of kept things reads', async () => {
    const { database, ran } = fake()
    await (await openFavourites(database)).all()
    expect(ran.find(one => one.sql.startsWith('SELECT'))?.sql).toContain(
      'ORDER BY at DESC',
    )
  })

  it('carries the conversation, because the screen spans all of them', async () => {
    // A row that could not say where it came from would be a line nobody
    // could open.
    const kept = await openFavourites(fake([ROW]).database)
    expect((await kept.all())[0]?.scope).toBe('!a:x')
  })

  it('answers just the identifiers when that is all a timeline needs', async () => {
    const kept = await openFavourites(fake([ROW]).database)
    expect(await kept.marks()).toEqual(new Set(['$one']))
  })

  it('drops a row of the wrong shape rather than crashing a screen', async () => {
    const kept = await openFavourites(
      fake([
        { ...ROW, event_id: '' },
        { ...ROW, scope: 42 },
        { ...ROW, at: 'yesterday' },
        ROW,
      ]).database,
    )
    expect(await kept.all()).toHaveLength(1)
  })

  it('keeps twice as keeping once, and refreshes when', async () => {
    const { database, ran } = fake()
    const kept = await openFavourites(database, () => 7)
    expect(await kept.keep('!a:x', ['$one', '$one'])).toBe(true)
    const writes = ran.filter(one => one.sql.startsWith('INSERT'))
    expect(writes).toHaveLength(2)
    // `INSERT OR REPLACE`, so the second is the same row with a later `at`.
    expect(writes[0]?.sql).toContain('INSERT OR REPLACE')
    expect(writes[0]?.params).toEqual(['$one', '!a:x', 7])
  })

  it('takes the mark back', async () => {
    const { database, ran } = fake()
    const kept = await openFavourites(database)
    expect(await kept.drop(['$one'])).toBe(true)
    const gone = ran.find(one => one.sql.startsWith('DELETE'))
    expect(gone?.params).toEqual(['$one'])
  })

  it('writes nothing at all for an empty selection', async () => {
    const { database, ran } = fake()
    const kept = await openFavourites(database)
    expect(await kept.keep('!a:x', [])).toBe(true)
    expect(await kept.drop([])).toBe(true)
    expect(ran.filter(one => !one.sql.startsWith('CREATE'))).toEqual([])
  })

  it('says so when the notebook will not take the mark', async () => {
    const kept = await openFavourites(fake([], true).database)
    expect(await kept.keep('!a:x', ['$one'])).toBe(false)
    expect(await kept.drop(['$one'])).toBe(false)
  })

  it('shows an empty screen rather than no screen when it cannot be read', async () => {
    // ADR-0010: this notebook degrades.
    const kept = await openFavourites(fake([], true).database)
    expect(await kept.all()).toEqual([])
    expect(await kept.marks()).toEqual(new Set())
  })

  it('a device without a notebook keeps nothing and says so', async () => {
    const none = forgetfulFavourites()
    expect(await none.all()).toEqual([])
    expect(await none.keep('!a:x', ['$one'])).toBe(false)
    expect(await none.drop(['$one'])).toBe(false)
  })
})
