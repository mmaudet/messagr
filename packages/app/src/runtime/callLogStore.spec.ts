import { describe, expect, it } from 'vitest'

import { forgetfulCallLog, openCallLog } from './callLogStore'
import type { EncryptedDatabase } from './givenNameStore'

/**
 * A database that answers what SQLite would, for the four statements this
 * page runs. Not a SQLite: what is being tested is the reading, the
 * defensive drops and the two-step settle, none of which need a real engine
 * -- and a real one would test SQLite rather than this file.
 */
function fake(
  rows: Record<string, unknown>[] = [],
  refuse: 'insert' | 'select' | 'none' = 'none',
) {
  const ran: { sql: string; params?: readonly (string | number)[] }[] = []
  const database: EncryptedDatabase = {
    execute: async (sql, params) => {
      ran.push({ sql, params })
      if (refuse === 'insert' && sql.startsWith('INSERT')) {
        throw new Error('the notebook is read-only')
      }
      if (refuse === 'select' && sql.startsWith('SELECT id')) {
        throw new Error('the notebook is unreadable')
      }
      if (sql.startsWith('SELECT id')) {
        return { rows: rows.length > 0 ? [{ id: 7 }] : [] }
      }
      return { rows: sql.startsWith('SELECT') ? rows : [] }
    },
  }
  return { database, ran }
}

const ROW = {
  scope: '!a:x',
  peer: '@her:x',
  at: 1_700_000_000_000,
  direction: 'in',
  outcome: 'missed',
}

describe('the call log', () => {
  it('reads a call back as it was written', async () => {
    const { database } = fake([ROW])
    expect(await (await openCallLog(database)).recent()).toEqual([
      {
        scope: '!a:x',
        peerUserId: '@her:x',
        at: 1_700_000_000_000,
        direction: 'in',
        outcome: 'missed',
      },
    ])
  })

  it('drops a row of the wrong shape rather than crashing the screen', async () => {
    // This is a file on a device. A row written by another version, or a
    // damaged one, is a line missing from a list -- not a list nobody can
    // open.
    const { database } = fake([
      { ...ROW, direction: 'sideways' },
      { ...ROW, at: 'yesterday' },
      { ...ROW, outcome: 'shrugged' },
      ROW,
    ])
    expect(await (await openCallLog(database)).recent()).toHaveLength(1)
  })

  it('asks for the newest first, because that is how a list is read', async () => {
    const { database, ran } = fake()
    await (await openCallLog(database)).recent(20)
    const read = ran.find(call => call.sql.includes('FROM call_log'))
    expect(read?.sql).toContain('ORDER BY at DESC')
    expect(read?.params).toEqual([20])
  })

  it('answers false when the notebook will not take the row', async () => {
    // ADR-0010: this page degrades. A call that happened is not undone by a
    // notebook that would not write it down.
    const { database } = fake([], 'insert')
    const log = await openCallLog(database)
    expect(
      await log.add({
        scope: '!a:x',
        peerUserId: '@her:x',
        at: 1,
        direction: 'out',
        outcome: 'answered',
      }),
    ).toBe(false)
  })

  it('settles the newest call of a conversation and says it found one', async () => {
    const { database, ran } = fake([ROW])
    expect(await (await openCallLog(database)).settle('!a:x', 'answered')).toBe(
      true,
    )
    const update = ran.find(call => call.sql.startsWith('UPDATE'))
    expect(update?.params).toEqual(['answered', 7])
  })

  it('says so when there was no call to settle', async () => {
    const { database, ran } = fake([])
    expect(await (await openCallLog(database)).settle('!a:x', 'answered')).toBe(
      false,
    )
    expect(ran.some(call => call.sql.startsWith('UPDATE'))).toBe(false)
  })

  it('does not update anything when it could not look first', async () => {
    const { database, ran } = fake([ROW], 'select')
    expect(await (await openCallLog(database)).settle('!a:x', 'answered')).toBe(
      false,
    )
    expect(ran.some(call => call.sql.startsWith('UPDATE'))).toBe(false)
  })
})

describe('two writers, one call', () => {
  // The wake records a ring in a headless process; the runtime records the
  // same call once the application starts. Neither can see the other, and a
  // lock between two processes is a lock held by whichever dies first.
  const at = 1_700_000_000_000
  const pair = (
    first: Record<string, unknown>,
    second: Record<string, unknown>,
  ) => fake([first, second]).database

  it('folds two rows of the same call into one line', async () => {
    const log = await openCallLog(
      pair(
        { ...ROW, at, outcome: 'answered' },
        { ...ROW, at: at - 3_000, outcome: 'missed' },
      ),
    )
    const recent = await log.recent()
    expect(recent).toHaveLength(1)
    expect(recent[0]?.outcome).toBe('answered')
  })

  it('keeps two calls that are far enough apart to be two', async () => {
    const log = await openCallLog(
      pair({ ...ROW, at }, { ...ROW, at: at - 600_000 }),
    )
    expect(await log.recent()).toHaveLength(2)
  })

  it('carries what either row knows across the fold', async () => {
    // The newer write wins the row, and for a while it won the whole row --
    // so a picture or a duration the older one held was lost to a fold
    // nobody can see.
    const log = await openCallLog(
      pair(
        { ...ROW, at, outcome: 'answered' },
        { ...ROW, at: at - 3_000, video: 1, seconds: 222 },
      ),
    )
    const recent = await log.recent()
    expect(recent).toHaveLength(1)
    expect(recent[0]?.video).toBe(true)
    expect(recent[0]?.seconds).toBe(222)
  })

  it('keeps a call out and a call in, however close together', async () => {
    // Calling somebody back a second after they rang is two calls, and the
    // arrows point opposite ways.
    const log = await openCallLog(
      pair(
        { ...ROW, at, direction: 'out' },
        { ...ROW, at: at - 1_000, direction: 'in' },
      ),
    )
    expect(await log.recent()).toHaveLength(2)
  })
})

describe('a device with no notebook', () => {
  it('has no history and says every write failed', async () => {
    const log = forgetfulCallLog()
    expect(await log.recent()).toEqual([])
    expect(
      await log.add({
        scope: '!a:x',
        peerUserId: '@her:x',
        at: 1,
        direction: 'in',
        outcome: 'missed',
      }),
    ).toBe(false)
    expect(await log.settle('!a:x', 'answered')).toBe(false)
  })
})

describe('whether a call carried a picture', () => {
  it('writes the bit with the row', async () => {
    const { database, ran } = fake()
    const log = await openCallLog(database)
    await log.add({
      scope: '!a:x',
      peerUserId: '@her:x',
      at: 1,
      direction: 'in',
      outcome: 'answered',
      video: true,
    })
    const insert = ran.find(one => one.sql.startsWith('INSERT'))
    expect(insert?.params?.slice(-1)).toEqual([1])
  })

  it('writes zero for a call with no picture', async () => {
    const { database, ran } = fake()
    const log = await openCallLog(database)
    await log.add({
      scope: '!a:x',
      peerUserId: '@her:x',
      at: 1,
      direction: 'in',
      outcome: 'answered',
    })
    const insert = ran.find(one => one.sql.startsWith('INSERT'))
    expect(insert?.params?.slice(-1)).toEqual([0])
  })

  it('reads the bit back', async () => {
    const log = await openCallLog(fake([{ ...ROW, video: 1 }]).database)
    expect((await log.recent())[0]?.video).toBe(true)
  })

  it('reads a row from before the column existed as an audio call', async () => {
    // `ALTER TABLE ... DEFAULT 0` gives those rows a zero, and zero is the
    // truth about them: the application could not place any other kind.
    const log = await openCallLog(fake([{ ...ROW, video: 0 }]).database)
    expect((await log.recent())[0]?.video).toBeUndefined()
  })

  it('marks the newest call of a conversation', async () => {
    const { database, ran } = fake([ROW])
    const log = await openCallLog(database)
    expect(await log.sawVideo('!a:x')).toBe(true)
    expect(
      ran.some(one => one.sql.startsWith('UPDATE call_log SET video')),
    ).toBe(true)
  })

  it('says so when there is no call to mark', async () => {
    const log = await openCallLog(fake([]).database)
    expect(await log.sawVideo('!a:x')).toBe(false)
  })

  it('a device without a notebook says the mark did not hold', async () => {
    expect(await forgetfulCallLog().sawVideo('!a:x')).toBe(false)
  })
})

describe('how long the call lasted', () => {
  // Allowed on 10 September 2026, amending ADR-0010. The file says why.
  it('reads a duration back', async () => {
    const log = await openCallLog(fake([{ ...ROW, seconds: 222 }]).database)
    expect((await log.recent())[0]?.seconds).toBe(222)
  })

  it('reads a row from before the column existed as having no duration', async () => {
    // `-1` is the default, and it is the column saying it does not know --
    // which is not the same as a call that lasted no time.
    const log = await openCallLog(fake([{ ...ROW, seconds: -1 }]).database)
    expect((await log.recent())[0]?.seconds).toBeUndefined()
  })

  it('keeps a zero, because a call can end in the second it began', async () => {
    const log = await openCallLog(fake([{ ...ROW, seconds: 0 }]).database)
    expect((await log.recent())[0]?.seconds).toBe(0)
  })

  it('drops a duration of the wrong shape rather than printing it', async () => {
    const log = await openCallLog(
      fake([{ ...ROW, seconds: 'a while' }]).database,
    )
    expect((await log.recent())[0]?.seconds).toBeUndefined()
  })

  it('writes the duration onto the newest call of a conversation', async () => {
    const { database, ran } = fake([ROW])
    const log = await openCallLog(database)
    expect(await log.lasted('!a:x', 222.4)).toBe(true)
    const written = ran.find(one =>
      one.sql.startsWith('UPDATE call_log SET seconds'),
    )
    // Rounded on the way in: a column of whole seconds is what the screen
    // reads back.
    expect(written?.params).toEqual([222, 7])
  })

  it('refuses a duration a clock could not have produced', async () => {
    // Both ends of the measurement are read from this device's own clock,
    // so a negative one is a clock that went backwards. `-1` is how the
    // column says it does not know, and a row must not claim to know
    // something absurd.
    const { database, ran } = fake([ROW])
    const log = await openCallLog(database)
    expect(await log.lasted('!a:x', -3)).toBe(false)
    expect(await log.lasted('!a:x', Number.NaN)).toBe(false)
    expect(
      ran.some(one => one.sql.startsWith('UPDATE call_log SET seconds')),
    ).toBe(false)
  })

  it('says so when there is no call to write it onto', async () => {
    const log = await openCallLog(fake([]).database)
    expect(await log.lasted('!a:x', 30)).toBe(false)
  })

  it('a device without a notebook says the duration did not hold', async () => {
    expect(await forgetfulCallLog().lasted('!a:x', 30)).toBe(false)
  })
})
