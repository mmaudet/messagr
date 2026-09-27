import type { EncryptedDatabase } from './givenNameStore'

/**
 * The accounts this device knows through its address book (#407): an account
 * whose invitation delivered inside Messagr came from a number this device
 * had found on a card of its address book, and that this account joined.
 * Beside each, the name of that card as it was when the invitation was
 * accepted, never read again (#392, story 60).
 *
 * What the product calls « recognized » (§4.4): matched through the address
 * book, never verified. `Trust.tsx` says what that establishes and what it
 * does not, in words that are neither of those two, which the catalogue's
 * guards forbid.
 *
 * A page of the notebook (ADR-0010), for the reason the names are: which of
 * one's contacts is behind which account is a record of relationships.
 */
export interface RecognizedAccounts {
  /** Every account known through the address book, with its card's name. */
  readonly all: () => Promise<ReadonlyMap<string, string>>
  /**
   * `userId` joined through an invitation from the card `cardName`. A later
   * one replaces it: it is the card of the latest acceptance. Whether it
   * held.
   */
  readonly recognize: (userId: string, cardName: string) => Promise<boolean>
}

const SCHEMA = `CREATE TABLE IF NOT EXISTS recognized_accounts (
  user_id TEXT PRIMARY KEY NOT NULL,
  card_name TEXT NOT NULL
)`

export async function openRecognizedAccounts(
  database: EncryptedDatabase,
): Promise<RecognizedAccounts> {
  await database.execute(SCHEMA)

  return {
    all: async () => {
      const { rows } = await database.execute(
        'SELECT user_id, card_name FROM recognized_accounts',
      )
      const known = new Map<string, string>()
      for (const row of rows) {
        // Read defensively, for the reason the names store gives: a row of
        // the wrong shape is a row to skip, not a launch to lose.
        const { user_id: userId, card_name: cardName } = row as Record<
          string,
          unknown
        >
        if (
          typeof userId === 'string' &&
          typeof cardName === 'string' &&
          cardName !== ''
        ) {
          known.set(userId, cardName)
        }
      }
      return known
    },

    recognize: async (userId, cardName) => {
      try {
        await database.execute(
          'INSERT OR REPLACE INTO recognized_accounts (user_id, card_name) ' +
            'VALUES (?, ?)',
          [userId, cardName],
        )
        return true
      } catch {
        return false
      }
    },
  }
}

/** A page that forgets, for a launch that could not open the notebook. */
export function forgetfulRecognizedAccounts(): RecognizedAccounts {
  return {
    all: async () => new Map<string, string>(),
    recognize: async () => false,
  }
}
