import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

import type { EncryptedDatabase } from './givenNameStore'
import {
  forgetfulOutstanding,
  openOutstanding,
  type OutstandingInvitation,
} from './outstandingStore'

/**
 * The invitations issued here that nobody has walked through yet, against a
 * database that answers what SQLite would for the statements this page runs,
 * as `listCacheStore.spec.ts` does. A row written before a column existed
 * comes back with the column's default, which is SQLite's doing.
 */
function fake(written: Record<string, unknown>[] = []) {
  const rows = new Map<string, Record<string, unknown>>(
    written.map(row => [String(row.invitation_id), row]),
  )
  const database: EncryptedDatabase = {
    execute: async (sql, params = []) => {
      if (sql.startsWith('CREATE') || sql.startsWith('ALTER')) {
        return { rows: [] }
      }
      if (sql.startsWith('SELECT')) return { rows: [...rows.values()] }
      if (sql.startsWith('INSERT OR REPLACE INTO outstanding_invitations')) {
        const [invitation_id, scope, issued_at, lifetime, given_name] = params
        rows.set(String(invitation_id), {
          invitation_id,
          scope,
          issued_at,
          lifetime,
          given_name,
        })
        return { rows: [] }
      }
      if (sql.startsWith('DELETE')) {
        rows.delete(String(params[0]))
        return { rows: [] }
      }
      throw new Error(`a statement this fake does not know: ${sql}`)
    },
  }
  return { database, rows }
}

const THREE_DAYS: OutstandingInvitation = {
  invitationId: 'inv-1',
  scope: '!room:x',
  issuedAt: 1_700_000_000_000,
  lifetime: 3 * 86_400_000,
  given: 'Marie',
}

describe('the invitations waiting for somebody to walk through them', () => {
  it('keeps how long each link is good for, and the name typed for whoever comes (#408)', async () => {
    const page = await openOutstanding(fake().database)

    expect(await page.remember(THREE_DAYS)).toBe(true)

    expect(await page.all()).toEqual([THREE_DAYS])
  })

  it('keeps an invitation with no name typed as having none', async () => {
    const { database, rows } = fake()
    const page = await openOutstanding(database)

    await page.remember({ ...THREE_DAYS, given: null })

    // The notebook binds strings and numbers: none is the empty string.
    expect(rows.get('inv-1')?.given_name).toBe('')
    expect((await page.all())[0]?.given).toBeNull()
  })

  it('skips a row of the wrong shape rather than losing the others', async () => {
    const page = await openOutstanding(
      fake([
        {
          invitation_id: 'inv-0',
          scope: '!old:x',
          issued_at: 1_600_000_000_000,
          lifetime: 'an hour',
          given_name: '',
        },
        {
          invitation_id: 'inv-1',
          scope: '!room:x',
          issued_at: 1_700_000_000_000,
          lifetime: 3 * 86_400_000,
          given_name: 'Marie',
        },
      ]).database,
    )

    expect(await page.all()).toEqual([THREE_DAYS])
  })

  it('forgets an invitation', async () => {
    const page = await openOutstanding(fake().database)
    await page.remember(THREE_DAYS)

    expect(await page.forget('inv-1')).toBe(true)

    expect(await page.all()).toEqual([])
  })

  it('a device without a notebook keeps nothing, and says so', async () => {
    const page = forgetfulOutstanding()
    expect(await page.remember(THREE_DAYS)).toBe(false)
    expect(await page.all()).toEqual([])
  })
})

/**
 * SQLite itself, in memory, behind the notebook's port: what the fake above
 * cannot say is what the engine gives the rows written before a column was
 * added, and that is the whole of the migration.
 */
function sqlite() {
  // Required rather than imported: the module exists only under its `node:`
  // name, which the test runner's resolver strips before looking it up.
  const { DatabaseSync } = createRequire(import.meta.url)(
    'node:sqlite',
  ) as typeof import('node:sqlite')
  const engine = new DatabaseSync(':memory:')
  const database: EncryptedDatabase = {
    execute: async (sql, params = []) => {
      const statement = engine.prepare(sql)
      if (sql.trimStart().startsWith('SELECT')) {
        return { rows: statement.all(...params) }
      }
      statement.run(...params)
      return { rows: [] }
    },
  }
  return { database, engine }
}

describe('a notebook written before #408', () => {
  it('reads each invitation it holds as a link of an hour, with no name', async () => {
    // The table as every device had it: three columns, and a link good for
    // the hour every link was good for.
    const { database, engine } = sqlite()
    engine.exec(`CREATE TABLE outstanding_invitations (
      invitation_id TEXT PRIMARY KEY NOT NULL,
      scope TEXT NOT NULL,
      issued_at INTEGER NOT NULL
    )`)
    engine
      .prepare('INSERT INTO outstanding_invitations VALUES (?, ?, ?)')
      .run('inv-0', '!old:x', 1_600_000_000_000)

    const page = await openOutstanding(database)

    expect(await page.all()).toEqual([
      {
        invitationId: 'inv-0',
        scope: '!old:x',
        issuedAt: 1_600_000_000_000,
        lifetime: 3_600_000,
        given: null,
      },
    ])
  })

  it('opens again once migrated, and keeps a link of three days beside it', async () => {
    // The second opening finds both columns there, and its two additions
    // fail, which is the state they were trying to reach.
    const { database } = sqlite()
    await openOutstanding(database)

    const page = await openOutstanding(database)

    expect(await page.remember(THREE_DAYS)).toBe(true)
    expect(await page.all()).toEqual([THREE_DAYS])
  })
})
