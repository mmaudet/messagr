import type { EncryptedDatabase } from './givenNameStore'

/**
 * How far the other person has read, per conversation.
 *
 * The sixth page of the notebook (ADR-0010), and the exact mirror of
 * `last_read` beside it: that one remembers how far **you** have read, this
 * one how far **they** have.
 *
 * # WHY IT HAS TO BE KEPT AT ALL
 *
 * A Matrix read receipt is **ephemeral and sent once**. A device that was
 * asleep when it passed will never see it -- there is no endpoint to ask for
 * somebody else's receipts, as `receipts.ts` says at the top.
 *
 * So the second tick was held in memory and lost on every relaunch. It came
 * back only when the correspondent read something *new*, which on a quiet
 * conversation is never. Reported twice in the same words -- « j'ai de
 * nouveau perdu l'état de réception des messages » -- and the first fix,
 * which stopped the mark falling *within* a session, did nothing about the
 * fall *between* two.
 *
 * # IT NEVER GOES BACKWARDS, AND THAT RULE LIVES HERE
 *
 * `MAX` rather than an assignment, for the reason `last_read` gives about
 * its own: the writes race. A poll can resolve an older receipt after a
 * newer one has already been recorded, and a mark that moved back would take
 * a tick off a message somebody has plainly read.
 *
 * # WHAT IT PUTS IN THE NOTEBOOK
 *
 * That your correspondent had read up to a given moment. ADR-0010 keeps this
 * file encrypted precisely because facts about your relationships are
 * revealing -- and this is one. It is already on the screen, its mirror is
 * already in the file, and a tick that vanishes on every launch is a product
 * telling you something untrue about a message you sent.
 */

export interface ReadBy {
  /** Every conversation this device knows a mark for. */
  readonly all: () => Promise<ReadonlyMap<string, number>>
  /**
   * Raises the mark, never lowers it. Returns whether it held, the way every
   * page of the notebook does.
   */
  readonly raise: (scope: string, at: number) => Promise<boolean>
}

const SCHEMA = `CREATE TABLE IF NOT EXISTS read_by (
  scope TEXT PRIMARY KEY NOT NULL,
  at INTEGER NOT NULL
)`

export async function openReadBy(database: EncryptedDatabase): Promise<ReadBy> {
  await database.execute(SCHEMA)

  return {
    all: async () => {
      const marks = new Map<string, number>()
      try {
        const { rows } = await database.execute('SELECT scope, at FROM read_by')
        for (const row of rows) {
          // Read defensively rather than cast, for the reason the names store
          // gives: this is a file on a device, and a row of the wrong shape
          // is a row to skip and not a launch to lose.
          const { scope, at } = row as Record<string, unknown>
          if (typeof scope === 'string' && typeof at === 'number') {
            marks.set(scope, at)
          }
        }
      } catch {
        // A page that will not open is a conversation with no second tick,
        // which is what yesterday already looked like. Losing the launch
        // over it would be worse.
      }
      return marks
    },

    raise: async (scope, at) => {
      try {
        await database.execute(
          `INSERT INTO read_by (scope, at) VALUES (?, ?)
           ON CONFLICT(scope) DO UPDATE SET at = MAX(at, excluded.at)`,
          [scope, at],
        )
        return true
      } catch {
        return false
      }
    },
  }
}

/** A page that forgets, for a launch that could not open the notebook. */
export function forgetfulReadBy(): ReadBy {
  return {
    all: async () => new Map<string, number>(),
    raise: async () => false,
  }
}
