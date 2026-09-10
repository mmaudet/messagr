import type { EncryptedDatabase } from './givenNameStore'
import type { ConversationSummary } from './conversationList'

/**
 * The conversation list as this device last saw it, so the next launch can
 * draw it before it asks anybody anything.
 *
 * # THE COST ADR-0006 NAMED, AND THE ANSWER IT PRESCRIBED
 *
 * "Nothing decrypted is written to disk" listed its own price plainly: *"A
 * relaunch is slower. The conversation appears after a round trip and a
 * decryption pass rather than instantly."* It then said when to revisit and
 * what the answer would be -- *"probably an encrypted local store keyed from
 * the same keystore secret rather than a cleartext one, which is a different
 * decision from the one taken here, not a reversal of it."*
 *
 * The requirement was stated on 8 September 2026, from the demonstration
 * Pixel, after watching seven seconds of empty screen: « lorsque l'app
 * s'ouvre sur mon pixel, l'écran de conversations s'affiche au bout de
 * plusieurs secondes -- faudrait trouver un moyen que cela s'affiche
 * immédiatement. Cache… »
 *
 * Measured, those seven seconds are: three quarters of a second of
 * JavaScript and keystore, then a client start and an initial sync, then two
 * key queries and an upload, then two `/joined_rooms`, and only then one
 * round trip and one decryption pass per conversation. The list needs none
 * of it to draw what it drew last time.
 *
 * So this is the fifth page of the notebook (ADR-0010), in the same file
 * under the same passphrase as the names, the read marks and the calls.
 *
 * # WHAT IT HOLDS, AND WHY THAT IS NOT A REVERSAL
 *
 * A row's preview is the opening of the last message, which is plaintext.
 * Keeping it here is not "plaintext on disk" in the sense ADR-0006 refuses:
 * that decision was about a cleartext store, and it named this file's own
 * protection -- a 32-byte random passphrase in the operating system's
 * keystore -- as what makes the crypto store acceptable. The same protection
 * covers the same fact here.
 *
 * What is NOT here is the conversation. One line per conversation, the line
 * a list already shows, and nothing behind it: opening a conversation still
 * derives it from ciphertext the way ADR-0005 and ADR-0006 say. An attacker
 * with this file learns the openings of the last messages, which is a real
 * cost and a bounded one, and not the history.
 *
 * # IT IS THE LAST ANSWER, NOT THE TRUTH
 *
 * Everything read from here is superseded within a few seconds by the
 * derivation that was going to happen anyway. Nothing waits on this page and
 * nothing fails if it is empty: a device whose notebook will not open shows
 * what it always showed, which is an empty list for a moment.
 */

export interface ListCache {
  /** What the list looked like last time. Empty when there is nothing kept. */
  readonly all: () => Promise<readonly ConversationSummary[]>
  /**
   * Replaces the whole page with what was just derived.
   *
   * Whole rather than per row, because the derivation is whole: a
   * conversation that has gone from the list must go from here too, and a
   * page updated row by row would keep it for ever. Returns whether it held,
   * the way every other page of the notebook does.
   */
  readonly keep: (summaries: readonly ConversationSummary[]) => Promise<boolean>
}

/**
 * The table. `scope` is the key: one line per conversation, which is what a
 * list is.
 */
const SCHEMA = `CREATE TABLE IF NOT EXISTS list_cache (
  scope TEXT PRIMARY KEY,
  other TEXT,
  preview TEXT,
  reason TEXT,
  last_at INTEGER NOT NULL,
  unread INTEGER NOT NULL
)`

/**
 * The column added when a row learnt to say « personne d'autre ici », and
 * why it is added rather than written into `SCHEMA`.
 *
 * `CREATE TABLE IF NOT EXISTS` does nothing to a table that already exists,
 * so a notebook written before today keeps the six-column shape. The
 * `ALTER TABLE` is the migration, run unguarded with its failure swallowed:
 * the only reason it fails is that the column is already there, which is the
 * state it is trying to reach. See `callLogStore.ts`, which says the same at
 * more length.
 *
 * `-1` rather than `0`: zero is a real answer here -- a conversation this
 * account is alone in -- so a default that collided with it would be a
 * column unable to say it does not know.
 */
const ADD_OTHERS = `ALTER TABLE list_cache ADD COLUMN others INTEGER NOT NULL DEFAULT -1`

export function forgetfulListCache(): ListCache {
  return { all: async () => [], keep: async () => false }
}

export async function openListCache(
  database: EncryptedDatabase,
): Promise<ListCache> {
  await database.execute(SCHEMA)
  // Fails on a notebook that already has the column, which is the state it
  // wants. See `ADD_OTHERS`.
  await database.execute(ADD_OTHERS).catch(() => undefined)

  return {
    all: async () => {
      try {
        const { rows } = await database.execute(
          'SELECT scope, other, preview, reason, last_at, unread, others ' +
            'FROM list_cache ORDER BY last_at DESC',
        )
        const found: ConversationSummary[] = []
        for (const row of rows) {
          // Read defensively rather than cast, for the reason the names store
          // gives: this is a file on a device, and a row of the wrong shape is
          // a row to drop rather than a screen to crash.
          const { scope, other, preview, reason, last_at, unread, others } =
            row as Record<string, unknown>
          if (typeof scope !== 'string' || scope === '') continue
          if (typeof last_at !== 'number' || typeof unread !== 'number')
            continue
          found.push({
            scope,
            other: typeof other === 'string' && other !== '' ? other : null,
            preview:
              typeof preview === 'string' && preview !== '' ? preview : null,
            ...(typeof reason === 'string' && reason !== '' ? { reason } : {}),
            // A row from before the column existed reads `-1`, which is
            // this page saying it does not know -- not a conversation with
            // nobody else in it.
            others: typeof others === 'number' && others >= 0 ? others : null,
            lastAt: last_at,
            unread,
          })
        }
        return found
      } catch {
        return []
      }
    },

    keep: async summaries => {
      try {
        // Emptied first, so a conversation that has left the list leaves this
        // page with it. Not a transaction: `EncryptedDatabase` exposes one
        // statement at a time, and the worst a crash between the two can do
        // is cost one launch its head start.
        await database.execute('DELETE FROM list_cache')
        for (const summary of summaries) {
          await database.execute(
            'INSERT INTO list_cache ' +
              '(scope, other, preview, reason, last_at, unread, others) ' +
              'VALUES (?, ?, ?, ?, ?, ?, ?)',
            // THE EMPTY STRING IS HOW THIS PAGE SPELLS `null`.
            // `EncryptedDatabase.execute` takes strings and numbers, which
            // is the right shape for four of the five pages; widening it so
            // one page can bind SQL NULL would change an interface every
            // test fake implements, to say something `all()` already reads
            // back correctly. A preview that is the empty string and one
            // that is absent draw the same blank line.
            [
              summary.scope,
              summary.other ?? '',
              summary.preview ?? '',
              summary.reason ?? '',
              summary.lastAt,
              summary.unread,
              // `-1` is how this column spells "not known", for the reason
              // the empty string spells it above.
              summary.others ?? -1,
            ],
          )
        }
        return true
      } catch {
        // A notebook that will not take the list is a launch without a head
        // start, not a list that failed. ADR-0010: this page degrades.
        return false
      }
    },
  }
}
