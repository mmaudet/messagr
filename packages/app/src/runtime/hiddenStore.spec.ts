import { describe, expect, it } from 'vitest'

import type { EncryptedDatabase } from './givenNameStore'
import { forgetfulHidden, openHidden } from './hiddenStore'

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

describe('what this device has been told not to draw', () => {
  it('reads back what was hidden', async () => {
    const hidden = await openHidden(
      fake([{ event_id: '$a' }, { event_id: '$b' }]).database,
    )
    expect([...(await hidden.all())]).toEqual(['$a', '$b'])
  })

  it('writes one row per event, with its conversation and the hour', async () => {
    const { database, ran } = fake([], 'none')
    const hidden = await openHidden(database, () => 1_700_000_000_000)
    expect(await hidden.hide('!r:x', ['$a', '$b'])).toBe(true)
    const inserts = ran.filter(one => one.sql.startsWith('INSERT'))
    expect(inserts).toHaveLength(2)
    expect(inserts[0]?.params).toEqual(['$a', '!r:x', 1_700_000_000_000])
  })

  it('hiding twice is hiding once', async () => {
    const { database, ran } = fake()
    const hidden = await openHidden(database)
    await hidden.hide('!r:x', ['$a'])
    await hidden.hide('!r:x', ['$a'])
    // The key does the work; the statement says so rather than the caller.
    expect(
      ran.filter(one => one.sql.startsWith('INSERT OR REPLACE')),
    ).toHaveLength(2)
  })

  it('hiding nothing holds, without touching the notebook', async () => {
    const { database, ran } = fake()
    const hidden = await openHidden(database)
    expect(await hidden.hide('!r:x', [])).toBe(true)
    expect(ran.filter(one => one.sql.startsWith('INSERT'))).toHaveLength(0)
  })

  it('drops a row of the wrong shape rather than crashing a screen', async () => {
    const hidden = await openHidden(
      fake([{ event_id: 42 }, { event_id: '' }, { event_id: '$a' }]).database,
    )
    expect([...(await hidden.all())]).toEqual(['$a'])
  })

  it('hides nothing rather than throwing when the page will not open', async () => {
    // Showing a message somebody asked not to see is bad; refusing to draw
    // the conversation loses every other message to save one.
    const hidden = await openHidden(fake([], 'read').database)
    expect((await hidden.all()).size).toBe(0)
  })

  it('says so when the hiding could not be kept', async () => {
    const hidden = await openHidden(fake([], 'write').database)
    expect(await hidden.hide('!r:x', ['$a'])).toBe(false)
  })

  it('a device without a notebook hides nothing and says the write failed', async () => {
    const hidden = forgetfulHidden()
    expect((await hidden.all()).size).toBe(0)
    expect(await hidden.hide('!r:x', ['$a'])).toBe(false)
  })
})
