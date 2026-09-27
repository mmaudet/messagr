import { describe, expect, it } from 'vitest'

import type { EncryptedDatabase } from './givenNameStore'
import {
  forgetfulSentInvitations,
  openSentInvitations,
} from './sentInvitationStore'

/**
 * A database that answers what SQLite would for the statements this page
 * runs, as `favouriteStore.spec.ts` does.
 */
function fake(refuse: 'none' | 'read' | 'write' = 'none') {
  const rows = new Map<string, Record<string, unknown>>()
  const database: EncryptedDatabase = {
    execute: async (sql, params = []) => {
      if (sql.startsWith('CREATE')) return { rows: [] }
      if (refuse === 'read' && sql.startsWith('SELECT')) {
        throw new Error('the notebook is unreadable')
      }
      if (refuse === 'write' && !sql.startsWith('SELECT')) {
        throw new Error('the notebook is read-only')
      }
      if (sql.startsWith('SELECT')) return { rows: [...rows.values()] }
      if (sql.startsWith('INSERT OR REPLACE')) {
        const [invitation_id, scope, expires_at, given] = params
        rows.set(String(invitation_id), {
          invitation_id,
          scope,
          expires_at,
          given,
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

const SENT = {
  invitationId: 'inv-1',
  scope: '!room:x',
  expiresAt: 1_790_604_800_000,
  given: 'Paul',
}

describe('the invitations this device delivered (#404)', () => {
  it('reads back what it kept, the name typed included', async () => {
    const page = await openSentInvitations(fake().database)

    expect(await page.remember(SENT)).toBe(true)
    expect(
      await page.remember({ ...SENT, invitationId: 'inv-2', given: null }),
    ).toBe(true)

    expect(await page.all()).toEqual([
      SENT,
      { ...SENT, invitationId: 'inv-2', given: null },
    ])
  })

  it('forgets one, and keeping one twice keeps it once', async () => {
    const { database, rows } = fake()
    const page = await openSentInvitations(database)
    await page.remember(SENT)
    await page.remember(SENT)
    expect(rows.size).toBe(1)

    expect(await page.forget('inv-1')).toBe(true)
    expect(await page.all()).toEqual([])
  })

  it('drops a row of the wrong shape rather than failing a tick', async () => {
    const { database, rows } = fake()
    const page = await openSentInvitations(database)
    await page.remember(SENT)
    rows.set('bad', {
      invitation_id: 'bad',
      scope: 42,
      expires_at: 1,
      given: '',
    })

    expect(await page.all()).toEqual([SENT])
  })

  it('asks about nothing when the page will not open, and says a write did not hold', async () => {
    expect(
      await (await openSentInvitations(fake('read').database)).all(),
    ).toEqual([])
    expect(
      await (await openSentInvitations(fake('write').database)).remember(SENT),
    ).toBe(false)
  })

  it('a device without a notebook keeps nothing and says so', async () => {
    const page = forgetfulSentInvitations()
    expect(await page.remember(SENT)).toBe(false)
    expect(await page.all()).toEqual([])
  })
})
