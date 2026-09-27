import { bytesOf } from './base64'
import type { DiscoveryResults, Remembered } from './findContacts'
import type { EncryptedDatabase } from './givenNameStore'
import { numberFingerprint } from './numberFingerprint'
import { base64Of } from './receiveImage'

/**
 * What looking for one's contacts found (#402, #392), kept so that the next
 * look masks only the numbers not gone through yet.
 *
 * A page of the notebook (ADR-0010), and it belongs there for the reason the
 * others do: which people of an address book are on Messagr is a record of
 * relationships, as revealing as anything else on these pages.
 *
 * # NO NUMBER ON THE PAGE, AND WHAT THAT IS WORTH
 *
 * Each row is found again by a fingerprint of the number
 * (`numberFingerprint.ts`): a keyed hash, under a key this page mints for
 * itself and keeps beside the rows. The same number has another fingerprint
 * on another device, and numbers hashed anywhere else match nothing here.
 * A reader who opens the notebook has the key as well, and can try a
 * numbering plan number by number: that reader holds every page of the
 * notebook already, which is ADR-0010's threat model, and ADR-0008's
 * `ThisDeviceOnly` passphrase is what answers it.
 *
 * # THE NAME OF A CARD FOUND, AND NOTHING ELSE OF IT
 *
 * Beside the fingerprint of a number that led to an account, the name of its
 * card, as the look found it (#407): what lets an invitation from that
 * account read « Paul (dans votre carnet) » without the address book being
 * read again, which only a look the person starts may do (#392, story 30).
 * A number that changed hands keeps the name for the account it first led
 * to, and the new one gets none. Never a number, never another field of the
 * card.
 *
 * Beside each fingerprint, the key number, the mask under that key, and the
 * reference the mask led to, or none. The service, which holds the key, could
 * tell which number a mask is; the page alone cannot.
 *
 * # ONE ROW PER NUMBER AND PER KEY
 *
 * While two keys serve (#409), a number has a mask under each, and a row
 * under one key never overwrites the row under another.
 *
 * # THE ADDRESS BOOK AS IT STANDS
 *
 * A number that has left the address book leaves the page at the next look
 * (`forgetAllBut`): a page that only grows would keep for ever what the
 * person took away, which `listCacheStore.ts` refuses for its own rows.
 *
 * # GONE WITH THE NOTEBOOK
 *
 * Its two tables are in the notebook's one file, which leaving the account
 * erases (`forgetNotebook`), key included.
 */

/** The page's own key: 32 bytes, minted by the first look that keeps. */
const KEY_BYTES = 32

/**
 * How many rows one statement writes. `EncryptedDatabase` runs one statement
 * at a time, and a first look can keep five thousand numbers: a row per
 * statement would be as many commits. Four values a row keeps a statement
 * under SQLite's oldest limit of 999 bound values.
 */
const ROWS_PER_STATEMENT = 200

/** How many fingerprints one statement forgets, under the same limit. */
const FORGOTTEN_PER_STATEMENT = 900

/**
 * The tables. A number and a key are the key of a row, so keeping a number
 * twice under one key keeps it once. `reference` is the empty string while
 * the mask led to no account: `EncryptedDatabase` binds strings and numbers,
 * as `listCacheStore.ts` says.
 */
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS discovery_results (
  fingerprint TEXT NOT NULL,
  key_number INTEGER NOT NULL,
  mask TEXT NOT NULL,
  reference TEXT NOT NULL,
  PRIMARY KEY (fingerprint, key_number)
)`,
  `CREATE TABLE IF NOT EXISTS discovery_fingerprint_key (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  key TEXT NOT NULL
)`,
  `CREATE TABLE IF NOT EXISTS discovery_found_names (
  fingerprint TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL
)`,
]

export function forgetfulDiscoveryResults(): DiscoveryResults {
  return {
    recall: async () => new Map(),
    keep: async () => false,
    forgetAllBut: async () => false,
    keepNames: async () => false,
    nameOf: async () => null,
  }
}

export async function openDiscoveryResults(
  database: EncryptedDatabase,
  random: (byteLength: number) => Uint8Array = byteLength =>
    crypto.getRandomValues(new Uint8Array(byteLength)),
): Promise<DiscoveryResults> {
  for (const statement of SCHEMA) await database.execute(statement)

  /** The page's key, or `null` before any look has kept anything. */
  const keptKey = async (): Promise<Uint8Array | null> => {
    const { rows } = await database.execute(
      'SELECT key FROM discovery_fingerprint_key WHERE id = 1',
    )
    const key = (rows[0] as Record<string, unknown> | undefined)?.key
    return typeof key === 'string' && key !== '' ? bytesOf(key) : null
  }

  /**
   * The page's key, minted by the first writer. A second writer keeps the
   * first key rather than replacing it, which would orphan every row before
   * it.
   */
  const theKey = async (): Promise<Uint8Array | null> => {
    if ((await keptKey()) === null) {
      await database.execute(
        'INSERT OR IGNORE INTO discovery_fingerprint_key (id, key) ' +
          'VALUES (1, ?)',
        [base64Of(random(KEY_BYTES))],
      )
    }
    return keptKey()
  }

  return {
    recall: async (keyNumber, numbers) => {
      try {
        const key = await keptKey()
        if (key === null) return new Map()
        const wanted = new Map(
          numbers.map(number => [numberFingerprint(key, number), number]),
        )
        const { rows } = await database.execute(
          'SELECT fingerprint, mask, reference FROM discovery_results ' +
            'WHERE key_number = ?',
          [keyNumber],
        )
        const recalled = new Map<string, Remembered>()
        for (const row of rows) {
          // Read defensively, for the reason the names store gives: a row of
          // the wrong shape is a row to drop, not a look to fail.
          const { fingerprint, mask, reference } = row as Record<
            string,
            unknown
          >
          const number =
            typeof fingerprint === 'string'
              ? wanted.get(fingerprint)
              : undefined
          if (
            number === undefined ||
            typeof mask !== 'string' ||
            mask === '' ||
            typeof reference !== 'string'
          ) {
            continue
          }
          recalled.set(number, {
            mask,
            reference: reference === '' ? null : reference,
          })
        }
        return recalled
      } catch {
        // A page that will not open recalls nothing: every number is masked,
        // as on the first look.
        return new Map()
      }
    },

    keep: async (keyNumber, remembered) => {
      if (remembered.size === 0) return true
      try {
        const key = await theKey()
        if (key === null) return false
        const rows = [...remembered].map(([number, one]) => [
          numberFingerprint(key, number),
          keyNumber,
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
        // and the next look masks these numbers again.
        return false
      }
    },

    forgetAllBut: async numbers => {
      try {
        const key = await keptKey()
        if (key === null) return true
        const held = new Set(
          numbers.map(number => numberFingerprint(key, number)),
        )
        const { rows } = await database.execute(
          'SELECT fingerprint FROM discovery_results ' +
            'UNION SELECT fingerprint FROM discovery_found_names',
        )
        const gone = rows
          .map(row => (row as Record<string, unknown>).fingerprint)
          .filter(
            (fingerprint): fingerprint is string =>
              typeof fingerprint === 'string' && !held.has(fingerprint),
          )
        for (let at = 0; at < gone.length; at += FORGOTTEN_PER_STATEMENT) {
          const some = gone.slice(at, at + FORGOTTEN_PER_STATEMENT)
          const listed = some.map(() => '?').join(', ')
          await database.execute(
            `DELETE FROM discovery_results WHERE fingerprint IN (${listed})`,
            some,
          )
          await database.execute(
            `DELETE FROM discovery_found_names WHERE fingerprint IN (${listed})`,
            some,
          )
        }
        return true
      } catch {
        // Kept a little longer: the next look forgets them.
        return false
      }
    },

    keepNames: async named => {
      if (named.size === 0) return true
      try {
        const key = await theKey()
        if (key === null) return false
        const rows = [...named].map(([number, name]) => [
          numberFingerprint(key, number),
          name,
        ])
        for (let at = 0; at < rows.length; at += ROWS_PER_STATEMENT) {
          const some = rows.slice(at, at + ROWS_PER_STATEMENT)
          await database.execute(
            'INSERT OR REPLACE INTO discovery_found_names (fingerprint, name) ' +
              'VALUES ' +
              some.map(() => '(?, ?)').join(', '),
            some.flat(),
          )
        }
        return true
      } catch {
        return false
      }
    },

    nameOf: async reference => {
      try {
        const { rows } = await database.execute(
          'SELECT n.name AS name FROM discovery_found_names n ' +
            'JOIN discovery_results r ON r.fingerprint = n.fingerprint ' +
            'WHERE r.reference = ? LIMIT 1',
          [reference],
        )
        const name = (rows[0] as Record<string, unknown> | undefined)?.name
        return typeof name === 'string' && name !== '' ? name : null
      } catch {
        return null
      }
    },
  }
}
