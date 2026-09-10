import type { EncryptedDatabase } from './givenNameStore'

/**
 * The messages somebody marked as worth finding again.
 *
 * The eighth page of the notebook (ADR-0010), and it belongs there for the
 * reason the names do, word for word:
 *
 * > *a book of who you talk to and what you call them is as revealing as
 * > what you said to them, and often more — it survives when the messages
 * > are gone, it is short enough to read at a glance, and it is exactly what
 * > somebody holding the device would look for first.*
 *
 * "Which messages matter to you" is the same family. The alternative —
 * server-side `account_data`, which is where every other client puts starred
 * messages — would carry them between a person's devices at the price of
 * teaching the homeserver which handful of messages they went back to. Out
 * of everything a conversation contains, that is a sharper thing to know
 * than most of the content.
 *
 * # WHAT IT COSTS, AND THE SCREEN SAYS IT TOO
 *
 * A favourite does not follow the person to another telephone and does not
 * survive a reinstall (#190 recovers an account, never its notebook). That
 * is the honest consequence of keeping it here, and it is written where
 * somebody marks their first one rather than only in this file.
 *
 * # WHY THE SCOPE IS CARRIED
 *
 * `hiddenStore.ts` keeps one for a list it does not yet have. This one needs
 * it immediately: a favourite is read on a screen that spans every
 * conversation, and a row that could not say which conversation it came from
 * would be a line nobody could open.
 */

/** A message somebody kept, and where it was said. */
export interface Favourite {
  readonly eventId: string
  readonly scope: string
  /** This device's clock, so the newest kept is the first shown. */
  readonly at: number
}

export interface Favourites {
  /** Newest first, which is the order a list of kept things is read in. */
  readonly all: () => Promise<readonly Favourite[]>
  /** Just the identifiers, for filtering a timeline in one pass. */
  readonly marks: () => Promise<ReadonlySet<string>>
  /** Returns whether it held, the way every page of the notebook does. */
  readonly keep: (
    scope: string,
    eventIds: readonly string[],
  ) => Promise<boolean>
  /** The same gesture again takes the mark back. */
  readonly drop: (eventIds: readonly string[]) => Promise<boolean>
}

/**
 * The table. `event_id` is the key: keeping twice is keeping once, which is
 * what makes the gesture idempotent without the caller checking first.
 */
const SCHEMA = `CREATE TABLE IF NOT EXISTS favourites (
  event_id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  at INTEGER NOT NULL
)`

export function forgetfulFavourites(): Favourites {
  return {
    all: async () => [],
    marks: async () => new Set(),
    keep: async () => false,
    drop: async () => false,
  }
}

export async function openFavourites(
  database: EncryptedDatabase,
  now: () => number = Date.now,
): Promise<Favourites> {
  await database.execute(SCHEMA)

  const read = async (): Promise<readonly Favourite[]> => {
    try {
      const { rows } = await database.execute(
        'SELECT event_id, scope, at FROM favourites ORDER BY at DESC',
      )
      const found: Favourite[] = []
      for (const row of rows) {
        // Read defensively rather than cast, for the reason the names store
        // gives: this is a file on a device, and a row of the wrong shape is
        // a row to drop rather than a screen to crash.
        const { event_id: eventId, scope, at } = row as Record<string, unknown>
        if (typeof eventId !== 'string' || eventId === '') continue
        if (typeof scope !== 'string' || scope === '') continue
        if (typeof at !== 'number') continue
        found.push({ eventId, scope, at })
      }
      return found
    } catch {
      // A page that will not open keeps nothing, which shows an empty screen
      // rather than no screen. ADR-0010: this notebook degrades.
      return []
    }
  }

  return {
    all: read,
    marks: async () => new Set((await read()).map(one => one.eventId)),

    keep: async (scope, eventIds) => {
      if (eventIds.length === 0) return true
      try {
        const at = now()
        for (const eventId of eventIds) {
          // `INSERT OR REPLACE` rather than a check: keeping something twice
          // is keeping it once, and the second mark refreshes when it was
          // kept, which is the order the screen reads in.
          await database.execute(
            'INSERT OR REPLACE INTO favourites (event_id, scope, at) ' +
              'VALUES (?, ?, ?)',
            [eventId, scope, at],
          )
        }
        return true
      } catch {
        return false
      }
    },

    drop: async eventIds => {
      if (eventIds.length === 0) return true
      try {
        for (const eventId of eventIds) {
          await database.execute('DELETE FROM favourites WHERE event_id = ?', [
            eventId,
          ])
        }
        return true
      } catch {
        return false
      }
    },
  }
}
