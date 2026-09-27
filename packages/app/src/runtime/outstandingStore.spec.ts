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
  name: 'Marie',
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

    await page.remember({ ...THREE_DAYS, name: null })

    // The notebook binds strings and numbers: none is the empty string.
    expect(rows.get('inv-1')?.given_name).toBe('')
    expect((await page.all())[0]?.name).toBeNull()
  })

  it('reads a row from before either column as an hour’s link, with no name', async () => {
    // Every link issued before #408 was good for an hour, and the name was
    // never kept: the columns' defaults say exactly that.
    const page = await openOutstanding(
      fake([
        {
          invitation_id: 'inv-0',
          scope: '!old:x',
          issued_at: 1_600_000_000_000,
          lifetime: 3_600_000,
          given_name: '',
        },
      ]).database,
    )

    expect(await page.all()).toEqual([
      {
        invitationId: 'inv-0',
        scope: '!old:x',
        issuedAt: 1_600_000_000_000,
        lifetime: 3_600_000,
        name: null,
      },
    ])
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
