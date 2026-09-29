import type { EncryptedDatabase } from './givenNameStore'

/**
 * The account's ignored list as its homeserver last said it (#469). A page of
 * the notebook (ADR-0010).
 *
 * # A CACHE OF WHAT THE HOMESERVER HOLDS, NOT A REGISTER OF DECISIONS
 *
 * The list is `m.ignored_user_list`, the account's global account data, and
 * what leaves the screens derives from it (`block.ts`). This page decides
 * nothing: it is written only from what the homeserver said -- a read at
 * launch, a sync that carried the list, or this device's own write once the
 * homeserver accepted it -- and replaced whole each time, so a list emptied
 * elsewhere empties it too. It never outlives what it copies.
 *
 * # WHY A COPY AT ALL
 *
 * Until the homeserver answers, a launch knew no list, and read that as
 * nobody blocked: the conversation list and the conversations drawn from this
 * device's own notebook -- with no network, or before it answers -- gave back
 * what a blocked account wrote, and another device of the account showed the
 * blocked conversation from its own copy of the list. Read before anything is
 * drawn, this page is what a launch hides with until the homeserver speaks.
 *
 * Who somebody blocked is a fact about their relationships, which is what
 * the notebook holds and why it is encrypted (ADR-0010).
 */
export interface IgnoredList {
  /** The list as last said, or `null` when this device was never told. */
  readonly read: () => Promise<ReadonlySet<string> | null>
  /** What the homeserver says now, in place of what it said before. */
  readonly keep: (ignored: ReadonlySet<string>) => Promise<boolean>
}

/**
 * One row, the whole list as a JSON array: written in one statement, so a
 * list is never kept in half.
 */
const SCHEMA = `CREATE TABLE IF NOT EXISTS ignored_list (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  accounts TEXT NOT NULL
)`

export async function openIgnoredList(
  database: EncryptedDatabase,
): Promise<IgnoredList> {
  await database.execute(SCHEMA)

  return {
    read: async () => {
      try {
        const { rows } = await database.execute(
          'SELECT accounts FROM ignored_list WHERE id = 1',
        )
        const accounts = (rows[0] as Record<string, unknown> | undefined)
          ?.accounts
        if (typeof accounts !== 'string') return null
        const said = JSON.parse(accounts) as unknown
        if (!Array.isArray(said)) return null
        // Read defensively, for the reason the names store gives: an entry
        // of the wrong shape is one to drop, not a launch to lose.
        return new Set(
          said.filter(
            (one): one is string => typeof one === 'string' && one !== '',
          ),
        )
      } catch {
        // A page that will not open, or a row that is not a list: this
        // device was told nothing it can use, and waits for the homeserver.
        return null
      }
    },

    keep: async ignored => {
      try {
        await database.execute(
          'INSERT OR REPLACE INTO ignored_list (id, accounts) VALUES (1, ?)',
          [JSON.stringify([...ignored])],
        )
        return true
      } catch {
        return false
      }
    },
  }
}

/** What to use when the notebook did not open: nothing kept, nothing known. */
export function forgetfulIgnoredList(): IgnoredList {
  return { read: async () => null, keep: async () => false }
}
