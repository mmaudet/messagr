import type { EncryptedDatabase } from './givenNameStore'

/**
 * Every call this device took part in, or was rung about.
 *
 * The fourth page of the application's own encrypted notebook (ADR-0010),
 * and it belongs there for the reason the names and the read marks do: **a
 * list of who you telephone and when is the most revealing thing this
 * product holds.** It is the shape of a life -- who at nine in the morning,
 * who at midnight, who every day and who once. The homeserver already sees
 * that a call happened; it must not be the thing this device asks when it
 * wants to draw the list.
 *
 * # WHY IT IS KEPT RATHER THAN DERIVED
 *
 * The events are in the conversations and could be read back. Three reasons
 * not to:
 *
 * A missed call is the case that matters most and the one derivation is
 * worst at -- the device learnt about it in a headless wake, from a poll
 * whose cursor it deliberately did not advance, and by the time anybody
 * opens a screen the invitation is long expired and indistinguishable from
 * one that was answered elsewhere.
 *
 * `buildTimeline` deliberately draws no bubble for `m.call.*`, so the
 * conversation this application derives does not contain the calls at all --
 * on purpose, since signalling is not speech.
 *
 * And a list of recent calls across every conversation would be one round
 * trip per conversation to draw one screen.
 *
 * # WHAT A ROW IS NOT
 *
 * No duration, and no content of any kind. What happened inside a call is
 * not this device's business to keep, and a duration is the one field that
 * would make a stolen notebook say how long two people spoke.
 */

/** Which way the call went. */
export type CallDirection = 'in' | 'out'

/**
 * How it finished.
 *
 * `missed` and `declined` are kept apart because they are different facts
 * about the same person: one is a call that arrived while nobody could take
 * it, the other is somebody deciding not to. A screen that collapsed them
 * would tell whoever reads the list something untrue about a conversation.
 *
 * `unplaced` is a call that never left this device -- no relay, no
 * microphone. It is in the log because "I tried to call you" is a fact, and
 * because a person seeing three of them in a row is looking at a
 * misconfigured homeserver rather than at somebody avoiding them.
 */
export type CallOutcome = 'answered' | 'missed' | 'declined' | 'unplaced'

export interface CallRecord {
  readonly scope: string
  /** Who the call was with, as an identifier. Names live in their own page. */
  readonly peerUserId: string
  /** This device's clock, in milliseconds. See `missedNotification`. */
  readonly at: number
  readonly direction: CallDirection
  readonly outcome: CallOutcome
  /**
   * Whether a picture ever went either way.
   *
   * "SOME VIDEO WENT THROUGH", NOT "IT WAS PLACED AS A VIDEO CALL". #201
   * lets a camera come on halfway, so the second sentence would be false
   * about half the calls it described. A row says what the call turned out
   * to be.
   *
   * ADR-0010 refuses a duration, because it "would make a stolen notebook
   * say how long two people spoke". This bit was weighed the same way: it
   * says nothing about duration or content, it is what the row would show
   * anyway, and « appel vidéo à 21 h » tells a reader of the notebook
   * almost nothing that « appel à 21 h » did not. Unlike a duration, it is
   * also the difference between a truthful row and a misleading one.
   *
   * Absent on every row written before this existed, and those are audio
   * calls -- the application could not place any other kind.
   */
  readonly video?: boolean
}

export interface CallLog {
  /** Newest first, which is the order a list of recent calls is read in. */
  readonly recent: (limit?: number) => Promise<readonly CallRecord[]>
  /** Returns whether it held, the way every other page of the notebook does. */
  readonly add: (record: CallRecord) => Promise<boolean>
  /**
   * Changes how the newest call in a conversation finished.
   *
   * A call is written the moment it begins -- otherwise a device that dies
   * mid-call has no record of it at all -- and its outcome is only known
   * later. `true` when a row was found and changed.
   */
  readonly settle: (scope: string, outcome: CallOutcome) => Promise<boolean>
  /**
   * Marks the newest call in a conversation as having carried a picture.
   *
   * Separate from `settle` because it happens at a different moment and can
   * happen more than once: a call is written when it begins, its outcome is
   * known when it ends, and a camera can come on at any point between.
   * `true` when a row was found and changed.
   */
  readonly sawVideo: (scope: string) => Promise<boolean>
}

/**
 * The table. `at` is not the key: two calls in the same conversation in one
 * minute are two rows, and a person who called twice wants to see twice.
 */
const SCHEMA = `CREATE TABLE IF NOT EXISTS call_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL,
  peer TEXT NOT NULL,
  at INTEGER NOT NULL,
  direction TEXT NOT NULL,
  outcome TEXT NOT NULL
)`

/**
 * The column added for #203, and why it is added rather than in `SCHEMA`.
 *
 * `CREATE TABLE IF NOT EXISTS` does nothing to a table that already exists,
 * so a notebook written before today keeps the four-column shape. `ALTER
 * TABLE ... ADD COLUMN` is the migration, and it is run unguarded and its
 * failure swallowed: the only reason it fails is that the column is already
 * there, which is exactly the state it is trying to reach. Reading
 * `PRAGMA table_info` first would be a second way of asking the same
 * question, and two ways of asking is how they come to disagree.
 */
const ADD_VIDEO = `ALTER TABLE call_log ADD COLUMN video INTEGER NOT NULL DEFAULT 0`

const DIRECTIONS = new Set<string>(['in', 'out'])
const OUTCOMES = new Set<string>(['answered', 'missed', 'declined', 'unplaced'])

/** How many rows a screen asks for when it does not say. */
const A_SCREENFUL = 100

/**
 * How close together two rows have to be to be one call.
 *
 * TWO THINGS WRITE THIS PAGE AND NEITHER CAN SEE THE OTHER. A call that
 * arrives while the application is asleep is recorded by the wake, in a
 * headless process; one that arrives while it is open is recorded by the
 * call runtime. The two overlap exactly when somebody answers from a
 * notification -- the wake writes the ring, the application starts, and the
 * runtime writes the same call again.
 *
 * Deduplicating on the way out rather than coordinating on the way in: the
 * two writers are in different processes with different lifetimes, and a
 * lock between them would be a lock held by whichever one dies first. One
 * call is one line, and this is where that is decided.
 */
const ONE_CALL_MS = 90_000

export async function openCallLog(
  database: EncryptedDatabase,
): Promise<CallLog> {
  await database.execute(SCHEMA)
  // Fails on a notebook that already has the column, which is the state it
  // wants. See `ADD_VIDEO`.
  await database.execute(ADD_VIDEO).catch(() => undefined)

  return {
    recent: async (limit = A_SCREENFUL) => {
      const { rows } = await database.execute(
        'SELECT scope, peer, at, direction, outcome, video FROM call_log ' +
          'ORDER BY at DESC, id DESC LIMIT ?',
        [limit],
      )
      const found: CallRecord[] = []
      for (const row of rows) {
        // Read defensively rather than cast, for the reason the names store
        // gives: this is a file on a device, and a row of the wrong shape is
        // a row to drop rather than a screen to crash.
        const { scope, peer, at, direction, outcome, video } = row as Record<
          string,
          unknown
        >
        if (typeof scope !== 'string' || typeof peer !== 'string') continue
        if (typeof at !== 'number') continue
        if (typeof direction !== 'string' || !DIRECTIONS.has(direction))
          continue
        if (typeof outcome !== 'string' || !OUTCOMES.has(outcome)) continue
        found.push({
          scope,
          peerUserId: peer,
          at,
          direction: direction as CallDirection,
          outcome: outcome as CallOutcome,
          // SQLite has no boolean. A row from before the column existed
          // reads as `0`, which is the truth about it: the application could
          // not place a video call then.
          ...(video === 1 || video === true ? { video: true } : {}),
        })
      }
      return collapsed(found)
    },

    add: async record => {
      try {
        await database.execute(
          'INSERT INTO call_log (scope, peer, at, direction, outcome, video) ' +
            'VALUES (?, ?, ?, ?, ?, ?)',
          [
            record.scope,
            record.peerUserId,
            record.at,
            record.direction,
            record.outcome,
            record.video === true ? 1 : 0,
          ],
        )
        return true
      } catch {
        // A notebook that will not take a row is a list that is missing a
        // line, not a call that failed. ADR-0010: this page degrades.
        return false
      }
    },

    settle: async (scope, outcome) => {
      try {
        // Found, then changed, rather than one statement with a subquery:
        // `EncryptedDatabase.execute` answers rows and nothing else -- no
        // count of what it touched -- so the only way to know whether a call
        // was there is to have looked at it.
        const { rows } = await database.execute(
          'SELECT id FROM call_log WHERE scope = ? ORDER BY at DESC, id DESC LIMIT 1',
          [scope],
        )
        const id = (rows[0] as { id?: unknown } | undefined)?.id
        if (typeof id !== 'number') return false
        await database.execute('UPDATE call_log SET outcome = ? WHERE id = ?', [
          outcome,
          id,
        ])
        return true
      } catch {
        return false
      }
    },

    sawVideo: async scope => {
      try {
        // The same two steps `settle` explains: `EncryptedDatabase.execute`
        // answers rows and no count of what it touched, so the only way to
        // know a call was there is to have looked.
        const { rows } = await database.execute(
          'SELECT id FROM call_log WHERE scope = ? ORDER BY at DESC, id DESC LIMIT 1',
          [scope],
        )
        const id = (rows[0] as { id?: unknown } | undefined)?.id
        if (typeof id !== 'number') return false
        await database.execute('UPDATE call_log SET video = 1 WHERE id = ?', [
          id,
        ])
        return true
      } catch {
        return false
      }
    },
  }
}

/**
 * Rows that are the same call, folded into one.
 *
 * Newest first on the way in, so the first of a pair is the later write --
 * which is the runtime's, and the one that knows how the call finished. The
 * outcome that survives is the more decisive of the two: `missed` is what
 * every row starts as, so anything else is news.
 */
function collapsed(rows: readonly CallRecord[]): readonly CallRecord[] {
  const kept: CallRecord[] = []
  for (const row of rows) {
    const last = kept[kept.length - 1]
    const sameCall =
      last !== undefined &&
      last.scope === row.scope &&
      last.direction === row.direction &&
      last.at - row.at < ONE_CALL_MS
    if (!sameCall) {
      kept.push(row)
      continue
    }
    if (last.outcome === 'missed' && row.outcome !== 'missed') {
      kept[kept.length - 1] = { ...last, outcome: row.outcome }
    }
  }
  return kept
}

/** What a device with no notebook answers. See `notebook.ts`'s own note. */
export function forgetfulCallLog(): CallLog {
  return {
    recent: async () => [],
    add: async () => false,
    settle: async () => false,
    sawVideo: async () => false,
  }
}
