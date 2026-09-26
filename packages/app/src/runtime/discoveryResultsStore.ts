import { bytesOf } from './base64'
import type { DiscoveryResults, Remembered } from './findContacts'
import type { EncryptedDatabase } from './givenNameStore'
import { base64Of } from './receiveImage'

/**
 * What looking for one's contacts found (#402, #392), kept so that the next
 * search masks only the numbers it has not gone through yet.
 *
 * A page of the notebook (ADR-0010), and it belongs there for the reason the
 * others do: which of the people in an address book are on Messagr is a
 * record of relationships, as revealing as anything else on these pages.
 *
 * # NO NUMBER ON THE PAGE
 *
 * Each row is found again by a fingerprint of the number: a keyed hash under
 * a key this page mints for itself and never lets out. A number alone does
 * not give its fingerprint: the same number has another one on another
 * device, and a list of phone numbers hashed elsewhere matches nothing here.
 * The names stay in the address book, where they were read.
 *
 * What the page does hold is, for each number gone through, its mask, the key
 * it was made under and the reference it led to: what the service lists in
 * its directory for everyone, joined to nothing else.
 *
 * # GONE WITH THE NOTEBOOK
 *
 * The page is a table of the notebook's one file, which leaving the account
 * erases (`forgetNotebook`), key included.
 */

/**
 * A number's fingerprint under this page's key, in a form that fits a text
 * column. Injected: the page decides what is kept, not how it is hashed.
 */
export type Fingerprint = (key: Uint8Array, number: string) => string

/** The page's own key: 32 bytes, minted on the first search. */
const KEY_BYTES = 32

/**
 * How many rows one statement writes. `EncryptedDatabase` runs one statement
 * at a time, and a first search can keep five thousand numbers: a row per
 * statement would be as many commits. Four values a row keeps a statement
 * under SQLite's oldest limit of 999 bound values.
 */
const ROWS_PER_STATEMENT = 200

/**
 * The tables. The fingerprint is the key, so keeping a number twice keeps it
 * once. `reference` is the empty string while the mask led to no account:
 * `EncryptedDatabase` binds strings and numbers, as `listCacheStore.ts` says.
 */
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS discovery_results (
  fingerprint TEXT PRIMARY KEY,
  key_number INTEGER NOT NULL,
  mask TEXT NOT NULL,
  reference TEXT NOT NULL
)`,
  `CREATE TABLE IF NOT EXISTS discovery_fingerprint_key (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  key TEXT NOT NULL
)`,
]

export function forgetfulDiscoveryResults(): DiscoveryResults {
  return { recall: async () => new Map(), keep: async () => false }
}

export async function openDiscoveryResults(
  database: EncryptedDatabase,
  fingerprint: Fingerprint,
  random: (byteLength: number) => Uint8Array = byteLength =>
    crypto.getRandomValues(new Uint8Array(byteLength)),
): Promise<DiscoveryResults> {
  for (const statement of SCHEMA) await database.execute(statement)

  const keyKept = async (): Promise<Uint8Array | null> => {
    const { rows } = await database.execute(
      'SELECT key FROM discovery_fingerprint_key WHERE id = 1',
    )
    const key = (rows[0] as Record<string, unknown> | undefined)?.key
    return typeof key === 'string' && key !== '' ? bytesOf(key) : null
  }

  return {
    recall: async numbers => {
      try {
        // No key, nothing kept: the first search has not written yet.
        const key = await keyKept()
        if (key === null) return new Map()
        const wanted = new Map(
          numbers.map(number => [fingerprint(key, number), number]),
        )
        const { rows } = await database.execute(
          'SELECT fingerprint, key_number, mask, reference ' +
            'FROM discovery_results',
        )
        const recalled = new Map<string, Remembered>()
        for (const row of rows) {
          // Read defensively, for the reason the names store gives: a row of
          // the wrong shape is a row to drop, not a search to fail.
          const {
            fingerprint: kept,
            key_number,
            mask,
            reference,
          } = row as Record<string, unknown>
          const number = typeof kept === 'string' ? wanted.get(kept) : undefined
          if (
            number === undefined ||
            typeof key_number !== 'number' ||
            typeof mask !== 'string' ||
            mask === '' ||
            typeof reference !== 'string'
          ) {
            continue
          }
          recalled.set(number, {
            keyNumber: key_number,
            mask,
            reference: reference === '' ? null : reference,
          })
        }
        return recalled
      } catch {
        // A page that will not open recalls nothing: the search masks every
        // number, as the first one did.
        return new Map()
      }
    },

    keep: async remembered => {
      if (remembered.size === 0) return true
      try {
        // THE KEY IS MINTED ONCE, and a second writer keeps the first key
        // rather than replacing it, which would orphan every row before it.
        if ((await keyKept()) === null) {
          await database.execute(
            'INSERT OR IGNORE INTO discovery_fingerprint_key (id, key) ' +
              'VALUES (1, ?)',
            [base64Of(random(KEY_BYTES))],
          )
        }
        const key = await keyKept()
        if (key === null) return false
        const rows = [...remembered].map(([number, one]) => [
          fingerprint(key, number),
          one.keyNumber,
          one.mask,
          one.reference ?? '',
        ])
        for (let at = 0; at < rows.length; at += ROWS_PER_STATEMENT) {
          const some = rows.slice(at, at + ROWS_PER_STATEMENT)
          await database.execute(
            'INSERT OR REPLACE INTO discovery_results ' +
              '(fingerprint, key_number, mask, reference) VALUES ' +
              some.map(() => '(?, ?, ?, ?)').join(', '),
            some.flat(),
          )
        }
        return true
      } catch {
        // Nothing to say on screen: what was found is shown all the same,
        // and the next search masks these numbers again.
        return false
      }
    },
  }
}
