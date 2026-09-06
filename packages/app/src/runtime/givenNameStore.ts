import type { GivenNames } from './givenName'

/**
 * The shape of the database this store needs, and nothing more.
 *
 * `@op-engineering/op-sqlite` is a native module: importing it installs a JSI
 * host object as a side effect, which is why every other native surface in
 * this application is reached through an interface like this one and bound in
 * `cryptoPump.ts`. The rule is the same here and for the same reason — a
 * module that named the library could not be tested at all.
 */
export interface EncryptedDatabase {
  readonly execute: (
    sql: string,
    params?: readonly (string | number)[],
  ) => Promise<{ rows: readonly Record<string, unknown>[] }>
}

/**
 * The table. One row per participant, and the participant is the key.
 *
 * `TEXT` rather than a sized type, deliberately: a length limit belongs where
 * the value is normalised (`normaliseGivenName`) and not in a schema that
 * would fail a write instead of shortening it.
 */
const SCHEMA = `CREATE TABLE IF NOT EXISTS given_names (
  participant TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL
)`

/**
 * Opens the notebook. ADR-0010.
 *
 * The database is the application's own, encrypted with a passphrase of its
 * own — not ordinary storage, because a book of who you talk to and what you
 * call them is as revealing as what you said to them, and not the crypto
 * store, because that one belongs to the bridge and owns its schema.
 *
 * Idempotent: creating the table is part of opening, so a first launch and
 * every launch after take the same path. There is no migration step to
 * forget because there is nothing yet to migrate from.
 */
export async function openGivenNames(
  database: EncryptedDatabase,
): Promise<GivenNames> {
  await database.execute(SCHEMA)

  return {
    all: async () => {
      const { rows } = await database.execute(
        'SELECT participant, name FROM given_names',
      )
      const names = new Map<string, string>()
      for (const row of rows) {
        // Read defensively rather than cast. This is a file on a device, and
        // a row of the wrong shape is a row to skip, not a launch to lose.
        if (
          typeof row.participant === 'string' &&
          typeof row.name === 'string' &&
          row.name !== ''
        ) {
          names.set(row.participant, row.name)
        }
      }
      return names
    },

    set: async (participant, name) => {
      try {
        // Upsert rather than delete-then-insert: naming somebody a second
        // time must not have a moment in which they are unnamed.
        await database.execute(
          `INSERT INTO given_names (participant, name) VALUES (?, ?)
           ON CONFLICT(participant) DO UPDATE SET name = excluded.name`,
          [participant, name],
        )
        return true
      } catch {
        // `false` rather than a throw, for the reason the port states: a
        // screen must be able to say the name was not kept, and losing a
        // label is not a reason to lose the gesture that set it.
        return false
      }
    },
  }
}

/**
 * A notebook that forgets, for a launch that could not open the real one.
 *
 * A device whose keystore is locked, or whose database will not open, still
 * has conversations to show — as identifiers rather than names, which is what
 * an unnamed conversation looks like anyway. The alternative is refusing to
 * show a list, which trades a degraded screen for no screen.
 *
 * `set` answers `false`, so the naming gesture says plainly that it did not
 * hold rather than appearing to work until the next launch.
 */
export function forgetfulGivenNames(): GivenNames {
  return {
    all: async () => new Map<string, string>(),
    set: async () => false,
  }
}
