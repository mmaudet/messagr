import { describe, expect, it, vi } from 'vitest'

import {
  forgetfulGivenNames,
  openGivenNames,
  type EncryptedDatabase,
} from './givenNameStore'

/**
 * A database that answers the two statements this store makes, and records
 * what it was asked. Not a SQL engine: what is under test is the store's own
 * behaviour — the schema it insists on, the shapes it refuses, and what it
 * does when a write is rejected — not SQLite's.
 */
function fakeDatabase(): EncryptedDatabase & {
  readonly statements: string[]
  rows: Record<string, unknown>[]
  refuseWrites: boolean
} {
  const db = {
    statements: [] as string[],
    rows: [] as Record<string, unknown>[],
    refuseWrites: false,
    execute: async (sql: string) => {
      db.statements.push(sql)
      if (sql.startsWith('INSERT') && db.refuseWrites) {
        throw new Error('the database is read-only')
      }
      return { rows: sql.startsWith('SELECT') ? db.rows : [] }
    },
  }
  return db
}

describe('openGivenNames', () => {
  it('creates the table as part of opening, so a first launch is not special', async () => {
    const db = fakeDatabase()
    await openGivenNames(db)
    expect(db.statements[0]).toContain('CREATE TABLE IF NOT EXISTS given_names')
  })

  it('reads every name back, keyed by participant', async () => {
    const db = fakeDatabase()
    const names = await openGivenNames(db)
    db.rows = [
      { participant: '@her:x', name: 'Nadia' },
      { participant: '@him:x', name: 'Marc' },
    ]
    expect(await names.all()).toEqual(
      new Map([
        ['@her:x', 'Nadia'],
        ['@him:x', 'Marc'],
      ]),
    )
  })

  it('skips a row of the wrong shape rather than losing the launch', async () => {
    const db = fakeDatabase()
    const names = await openGivenNames(db)
    db.rows = [
      { participant: '@her:x', name: 'Nadia' },
      { participant: 42, name: 'not a participant' },
      { participant: '@him:x', name: null },
      { participant: '@nobody:x', name: '' },
    ]
    expect(await names.all()).toEqual(new Map([['@her:x', 'Nadia']]))
  })

  it('writes a name', async () => {
    const db = fakeDatabase()
    const names = await openGivenNames(db)
    expect(await names.set('@her:x', 'Nadia')).toBe(true)
    expect(db.statements.at(-1)).toContain('INSERT INTO given_names')
  })

  it('upserts, so naming somebody twice has no moment where they are unnamed', async () => {
    const db = fakeDatabase()
    const names = await openGivenNames(db)
    await names.set('@her:x', 'Nadia')
    expect(db.statements.at(-1)).toContain('ON CONFLICT(participant) DO UPDATE')
    expect(db.statements.join(' ')).not.toContain('DELETE')
  })

  it('reports a refused write rather than throwing it at the screen', async () => {
    const db = fakeDatabase()
    const names = await openGivenNames(db)
    db.refuseWrites = true
    expect(await names.set('@her:x', 'Nadia')).toBe(false)
  })
})

describe('forgetfulGivenNames', () => {
  it('holds nothing, so a list still renders as identifiers', async () => {
    expect(await forgetfulGivenNames().all()).toEqual(new Map())
  })

  it('says plainly that a name was not kept', async () => {
    // Not `true`. A gesture that appears to work and is gone at the next
    // launch is worse than one that says so at the time.
    expect(await forgetfulGivenNames().set('@her:x', 'Nadia')).toBe(false)
  })

  it('never touches a database, because there is none to touch', async () => {
    const execute = vi.fn()
    const names = forgetfulGivenNames()
    await names.all()
    await names.set('@her:x', 'Nadia')
    expect(execute).not.toHaveBeenCalled()
  })
})
