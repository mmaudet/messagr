import type { EncryptedDatabase } from './givenNameStore'

/**
 * The events this device has been told not to draw.
 *
 * The sixth page of the notebook (ADR-0010), and the one that exists because
 * of what ADR-0006 refuses.
 *
 * # "DELETE FOR ME" CANNOT MEAN WHAT IT MEANS ELSEWHERE
 *
 * §13.7 asks for two scopes, *« pour moi, pour tout le monde »*. In every
 * other messenger the first one erases a local copy. There is no local copy
 * here: ADR-0006 keeps nothing decrypted on disk and derives the
 * conversation from ciphertext on every launch. Erasing what is not stored
 * is not an operation.
 *
 * So "for me" means what it can honestly mean: **this device is told not to
 * draw that event again**. The event stays on the homeserver, the other
 * person keeps their copy, and the timeline is still derived exactly as
 * before -- with one line skipped.
 *
 * # AND IT DOES NOT TRAVEL, WHICH THE SCREEN MUST SAY
 *
 * A hiding is a row in this device's own notebook. Another telephone of the
 * same account draws the message; a reinstall brings it back (#190). That is
 * the honest consequence of keeping it local, and the alternative -- putting
 * it in the account's server-side data -- would tell the homeserver which
 * messages somebody wanted out of their sight, which is a sharper thing to
 * know than most message content.
 *
 * # WHY NOT A REDACTION WITH NOBODY TOLD
 *
 * Because there is no such thing. A redaction is the protocol's erasure and
 * everybody sees it. "For me" that redacted would be "for everyone" wearing
 * the wrong label, which is the one mistake §13.7's *« sans euphémisme »*
 * exists to prevent.
 */

export interface Hidden {
  /** Every event this device hides, so a timeline can be filtered in one pass. */
  readonly all: () => Promise<ReadonlySet<string>>
  /** Returns whether it held, the way every page of the notebook does. */
  readonly hide: (
    scope: string,
    eventIds: readonly string[],
  ) => Promise<boolean>
}

/**
 * The table. `event_id` is the key: hiding twice is hiding once.
 *
 * `scope` is carried although nothing reads by it yet -- a row that could not
 * say which conversation it belongs to could never be shown in a list of what
 * this device is hiding, and that list is the only honest way to undo one.
 */
const SCHEMA = `CREATE TABLE IF NOT EXISTS hidden_events (
  event_id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  at INTEGER NOT NULL
)`

export function forgetfulHidden(): Hidden {
  return { all: async () => new Set(), hide: async () => false }
}

export async function openHidden(
  database: EncryptedDatabase,
  now: () => number = Date.now,
): Promise<Hidden> {
  await database.execute(SCHEMA)

  return {
    all: async () => {
      try {
        const { rows } = await database.execute(
          'SELECT event_id FROM hidden_events',
        )
        const found = new Set<string>()
        for (const row of rows) {
          // Read defensively rather than cast, for the reason the names store
          // gives: this is a file on a device, and a row of the wrong shape
          // is a row to drop rather than a screen to crash.
          const { event_id } = row as Record<string, unknown>
          if (typeof event_id === 'string' && event_id !== '') {
            found.add(event_id)
          }
        }
        return found
      } catch {
        // A page that will not open hides nothing, which shows a message
        // somebody asked not to see. The alternative -- refusing to draw the
        // conversation -- loses every other message to save one.
        return new Set()
      }
    },

    hide: async (scope, eventIds) => {
      if (eventIds.length === 0) return true
      try {
        const at = now()
        for (const eventId of eventIds) {
          await database.execute(
            'INSERT OR REPLACE INTO hidden_events (event_id, scope, at) ' +
              'VALUES (?, ?, ?)',
            [eventId, scope, at],
          )
        }
        return true
      } catch {
        // The screen must say so: unlike every other page, a hiding that did
        // not hold is a message still on screen after somebody asked for it
        // to go, and pretending otherwise is the worst of both.
        return false
      }
    },
  }
}
