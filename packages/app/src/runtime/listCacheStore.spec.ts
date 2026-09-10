import { describe, expect, it } from 'vitest'

import { forgetfulListCache, openListCache } from './listCacheStore'
import type { ConversationSummary } from './conversationList'
import type { EncryptedDatabase } from './givenNameStore'

/**
 * A database that answers what SQLite would, for the four statements this
 * page runs. Not a SQLite, for the reason the call log's fake gives: what is
 * being tested is the reading, the defensive drops and the null spelling,
 * none of which need a real engine.
 */
function fake(
  rows: Record<string, unknown>[] = [],
  refuse: 'write' | 'read' | 'none' = 'none',
) {
  const ran: { sql: string; params?: readonly (string | number)[] }[] = []
  const database: EncryptedDatabase = {
    execute: async (sql, params) => {
      ran.push({ sql, params })
      if (
        refuse === 'write' &&
        !sql.startsWith('SELECT') &&
        !sql.startsWith('CREATE')
      ) {
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

const ROW = {
  scope: '!a:x',
  other: '@her:x',
  preview: 'à tout à l’heure',
  reason: '',
  last_at: 1_700_000_000_000,
  unread: 2,
}

const SUMMARY: ConversationSummary = {
  scope: '!a:x',
  other: '@her:x',
  // A row written before the column existed. `-1` on the way out of SQLite,
  // `null` on the way into a summary: the page does not know.
  others: null,
  preview: 'à tout à l’heure',
  lastAt: 1_700_000_000_000,
  unread: 2,
}

describe('the remembered conversation list', () => {
  it('reads a count of other members back', async () => {
    const cache = await openListCache(fake([{ ...ROW, others: 0 }]).database)
    // Zero is a real answer -- a conversation this account is alone in --
    // and the row says « personne d'autre ici » rather than a room id.
    expect((await cache.all())[0]?.others).toBe(0)
  })

  it('reads a row from before the column existed as not knowing', async () => {
    const cache = await openListCache(fake([{ ...ROW, others: -1 }]).database)
    expect((await cache.all())[0]?.others).toBeNull()
  })

  it('reads a row back as it was written', async () => {
    const cache = await openListCache(fake([ROW]).database)
    expect(await cache.all()).toEqual([SUMMARY])
  })

  it('spells an absent other, preview and reason as the empty string', async () => {
    const { database, ran } = fake()
    const cache = await openListCache(database)
    await cache.keep([
      {
        scope: '!b:x',
        other: null,
        others: null,
        preview: null,
        lastAt: 0,
        unread: 0,
      },
    ])
    const insert = ran.find(one => one.sql.startsWith('INSERT'))
    expect(insert?.params).toEqual(['!b:x', '', '', '', 0, 0, -1])
  })

  it('reads those empty strings back as nothing', async () => {
    const cache = await openListCache(
      fake([
        {
          scope: '!b:x',
          other: '',
          preview: '',
          reason: '',
          last_at: 0,
          unread: 0,
        },
      ]).database,
    )
    expect(await cache.all()).toEqual([
      {
        scope: '!b:x',
        other: null,
        others: null,
        preview: null,
        lastAt: 0,
        unread: 0,
      },
    ])
  })

  it('carries the reason a row has no preview', async () => {
    const cache = await openListCache(
      fake([{ ...ROW, preview: '', reason: 'unreadable' }]).database,
    )
    expect(await cache.all()).toEqual([
      { ...SUMMARY, preview: null, reason: 'unreadable' },
    ])
  })

  it('drops a row of the wrong shape rather than crashing a screen', async () => {
    const cache = await openListCache(
      fake([
        { ...ROW, scope: 42 },
        { ...ROW, scope: '' },
        { ...ROW, last_at: 'hier' },
        { ...ROW, unread: null },
        ROW,
      ]).database,
    )
    expect(await cache.all()).toEqual([SUMMARY])
  })

  it('empties the page before writing, so a departed conversation leaves', async () => {
    const { database, ran } = fake()
    const cache = await openListCache(database)
    await cache.keep([SUMMARY])
    const order = ran.map(one => one.sql.split(' ')[0])
    expect(order.indexOf('DELETE')).toBeLessThan(order.indexOf('INSERT'))
  })

  it('answers empty rather than throwing when the page will not open', async () => {
    const cache = await openListCache(fake([], 'read').database)
    expect(await cache.all()).toEqual([])
  })

  it('says so when the list could not be kept', async () => {
    // Survivable: the screen has the list either way, and what is lost is the
    // next launch's head start.
    const cache = await openListCache(fake([], 'write').database)
    expect(await cache.keep([SUMMARY])).toBe(false)
  })

  it('a device without a notebook remembers nothing and says the write failed', async () => {
    const cache = forgetfulListCache()
    expect(await cache.all()).toEqual([])
    expect(await cache.keep([SUMMARY])).toBe(false)
  })
})
