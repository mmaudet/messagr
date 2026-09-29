import type { EncryptedDatabase } from './givenNameStore'

/**
 * The accounts this device blocked and the invitation service has not heard
 * of yet (#469). A page of the notebook (ADR-0010).
 *
 * # WHAT IT IS FOR, AND WHAT IT IS NOT
 *
 * A block is the account's ignored list on the homeserver first, and the
 * service's record second (`block.ts`). When the list is written and the
 * service cannot be reached, the block holds -- the homeserver hides the
 * account -- and what is left to do is tell the service, which is what keeps
 * the account's invitations delivered inside Messagr from arriving and what
 * the operator's daily count reads. This page is how that is asked again at
 * each launch until the service has heard it, and forgotten then.
 *
 * It hides nothing. What leaves the screens derives from the ignored list the
 * homeserver keeps and every device of the account syncs, never from here: a
 * page of this device's own would leave the account's other devices showing
 * what this one hides.
 *
 * # IN THE NOTEBOOK, FOR THE NOTEBOOK'S REASON
 *
 * Who somebody blocked is a fact about their relationships, as revealing as
 * the names they give (ADR-0010). It stays only until the service has it.
 */
export interface UntoldBlocks {
  /** Every account whose block the service has not heard of yet. */
  readonly all: () => Promise<readonly string[]>
  /** Returns whether it held, the way every page of the notebook does. */
  readonly remember: (account: string) => Promise<boolean>
  /** Once the service has heard of it. Returns whether it held. */
  readonly forget: (account: string) => Promise<boolean>
}

/** The table. The account is the key: remembering twice is remembering once. */
const SCHEMA = `CREATE TABLE IF NOT EXISTS untold_blocks (
  account TEXT PRIMARY KEY NOT NULL,
  at INTEGER NOT NULL
)`

export async function openUntoldBlocks(
  database: EncryptedDatabase,
  now: () => number = Date.now,
): Promise<UntoldBlocks> {
  await database.execute(SCHEMA)

  return {
    all: async () => {
      try {
        const { rows } = await database.execute(
          'SELECT account, at FROM untold_blocks ORDER BY at',
        )
        const found: string[] = []
        for (const row of rows) {
          // Read defensively rather than cast, for the reason the names
          // store gives: a row of the wrong shape is one to drop, not a
          // request to send with it.
          const { account } = row as Record<string, unknown>
          if (typeof account === 'string' && account !== '') found.push(account)
        }
        return found
      } catch {
        // A page that will not open asks nothing: the block holds on the
        // homeserver all the same, and only the service's record waits.
        return []
      }
    },

    remember: async account => {
      try {
        await database.execute(
          'INSERT OR REPLACE INTO untold_blocks (account, at) VALUES (?, ?)',
          [account, now()],
        )
        return true
      } catch {
        return false
      }
    },

    forget: async account => {
      try {
        await database.execute('DELETE FROM untold_blocks WHERE account = ?', [
          account,
        ])
        return true
      } catch {
        return false
      }
    },
  }
}

/**
 * What to use when the notebook did not open: nothing is kept, and the
 * gesture says so when the service could not be reached (`block.ts`).
 */
export function forgetfulUntoldBlocks(): UntoldBlocks {
  return {
    all: async () => [],
    remember: async () => false,
    forget: async () => false,
  }
}
