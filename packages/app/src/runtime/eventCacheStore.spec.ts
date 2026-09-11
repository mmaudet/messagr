import { describe, expect, it } from 'vitest'

import { forgetfulEventCache, openEventCache } from './eventCacheStore'
import type { EncryptedDatabase } from './givenNameStore'

/**
 * A database that answers what SQLite would for the three statements this
 * page runs. Not a SQLite, for the reason the other pages' fakes give: what
 * is under test is the reading, the defensive drops and the refusals, none
 * of which need an engine.
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

/** What the homeserver sends: an event whose content is opaque. */
const ENCRYPTED = {
  type: 'm.room.encrypted',
  event_id: '$one',
  sender: '@her:x',
  origin_server_ts: 1_700_000_000_000,
  content: { algorithm: 'm.megolm.v1.aes-sha2', ciphertext: 'AwgAEn…' },
}

describe('keeping the ciphertext a conversation was built from', () => {
  it('writes the chunk under the conversation, with when', async () => {
    const { database, ran } = fake()
    const cache = await openEventCache(database, () => 1_757_000_000_000)

    expect(await cache.keep('!a:x', [ENCRYPTED])).toBe(true)

    const write = ran.find(one => one.sql.startsWith('INSERT'))
    expect(write?.params).toEqual([
      '!a:x',
      JSON.stringify([ENCRYPTED]),
      1_757_000_000_000,
    ])
  })

  it('keeps an empty chunk, which is a true answer', async () => {
    // A conversation everything was removed from answers `[]`. Refusing to
    // keep it would leave the previous chunk standing, and the next launch
    // with no network would show messages that are gone. A FAILED fetch
    // never reaches here: it throws, which is the caller's business -- the
    // same distinction `mergeSummaries.ts` had to draw for the list.
    const { database, ran } = fake()
    const cache = await openEventCache(database)

    expect(await cache.keep('!a:x', [])).toBe(true)
    expect(ran.find(one => one.sql.startsWith('INSERT'))?.params?.[1]).toBe(
      '[]',
    )
  })

  it('says so rather than pretending when the notebook refuses', async () => {
    const { database } = fake([], 'write')
    const cache = await openEventCache(database)

    expect(await cache.keep('!a:x', [ENCRYPTED])).toBe(false)
  })
})

describe('reading it back', () => {
  it('answers with the events, as they were sent', async () => {
    const { database } = fake([{ chunk: JSON.stringify([ENCRYPTED]) }])
    const cache = await openEventCache(database)

    expect(await cache.of('!a:x')).toEqual([ENCRYPTED])
  })

  it('answers nothing for a conversation never opened', async () => {
    const cache = await openEventCache(fake([]).database)

    expect(await cache.of('!never:x')).toEqual([])
  })

  it('drops a row that is not an array, rather than handing it on', async () => {
    // A file on a device. A chunk that parses to an object would reach
    // `toTimelineEntries` as something it cannot iterate, and the screen
    // that fails would be the conversation rather than this line.
    const { database } = fake([{ chunk: '{"not":"an array"}' }])
    const cache = await openEventCache(database)

    expect(await cache.of('!a:x')).toEqual([])
  })

  it('drops a row that is not JSON at all', async () => {
    const { database } = fake([{ chunk: 'truncated…' }])
    const cache = await openEventCache(database)

    expect(await cache.of('!a:x')).toEqual([])
  })

  it('answers nothing when the notebook will not be read', async () => {
    const { database } = fake([{ chunk: '[]' }], 'read')
    const cache = await openEventCache(database)

    expect(await cache.of('!a:x')).toEqual([])
  })
})

describe('the notebook that would not open', () => {
  it('answers nothing and keeps nothing, without failing', async () => {
    // The shape every page of this notebook takes when the file is
    // unusable: a device that cannot remember still works, it just does not
    // remember. Nothing here may throw, because the conversation screen has
    // no branch for a cache that raises.
    const cache = forgetfulEventCache()

    expect(await cache.of('!a:x')).toEqual([])
    expect(await cache.keep('!a:x', [ENCRYPTED])).toBe(false)
  })
})
