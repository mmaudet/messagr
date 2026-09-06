import type { EncryptedDatabase } from './givenNameStore'

/**
 * How far this device has read each conversation.
 *
 * The second page of the application's own encrypted notebook (ADR-0010), and
 * it is in that notebook for the same reason the names are: a list of which
 * conversations you have looked at, and when, is as revealing as a list of
 * who you talk to. It is not ordinary storage.
 *
 * `unread.ts` says why the mark is kept here rather than taken from the
 * homeserver's own count.
 */

export interface LastRead {
  /** Every mark, by conversation. Absent means never opened here. */
  readonly all: () => Promise<ReadonlyMap<string, number>>
  /** Returns whether it held, the way `GivenNames.set` does. */
  readonly set: (scope: string, at: number) => Promise<boolean>
}

/**
 * The table. One row per conversation, and the conversation is the key.
 *
 * `INTEGER` because the value is the homeserver's millisecond timestamp,
 * which is the only ordering `mergeTimeline`, `receipts.ts` and this agree
 * on.
 */
const SCHEMA = `CREATE TABLE IF NOT EXISTS last_read (
  scope TEXT PRIMARY KEY NOT NULL,
  at INTEGER NOT NULL
)`

export async function openLastRead(
  database: EncryptedDatabase,
): Promise<LastRead> {
  await database.execute(SCHEMA)

  return {
    all: async () => {
      const { rows } = await database.execute('SELECT scope, at FROM last_read')
      const marks = new Map<string, number>()
      for (const row of rows) {
        // Read defensively rather than cast, for the reason the names store
        // gives: this is a file on a device, and a row of the wrong shape is
        // a row to skip and not a launch to lose.
        if (typeof row.scope === 'string' && typeof row.at === 'number') {
          marks.set(row.scope, row.at)
        }
      }
      return marks
    },

    set: async (scope, at) => {
      try {
        // A HIGH-WATER MARK NEVER GOES BACKWARDS.
        //
        // `MAX` rather than a plain assignment, because the writes race: the
        // live loop can deliver an older event after a newer one has already
        // been marked read, and a mark that moved back would resurrect a
        // badge on a conversation somebody has just finished reading.
        await database.execute(
          `INSERT INTO last_read (scope, at) VALUES (?, ?)
           ON CONFLICT(scope) DO UPDATE SET at = MAX(at, excluded.at)`,
          [scope, at],
        )
        return true
      } catch {
        // `false` rather than a throw. Losing a mark costs a badge that
        // lingers, which is a great deal less than losing the launch.
        return false
      }
    },
  }
}

/** A page that forgets, for a launch that could not open the notebook. */
export function forgetfulLastRead(): LastRead {
  return {
    all: async () => new Map<string, number>(),
    set: async () => false,
  }
}
