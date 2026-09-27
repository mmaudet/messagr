import type { SentInvitation, SentInvitations } from './deliveredInvitations'
import type { EncryptedDatabase } from './givenNameStore'

/**
 * The invitations this device delivered inside the application (#404), until
 * somebody is let in through them or they run out.
 *
 * A page of the notebook (ADR-0010), beside `outstanding_invitations`, which
 * keeps a link's for the hour it is good. Its own page rather than a column
 * there, because the two differ in all that is asked of them: a week rather
 * than an hour, another route to ask, and the name typed in « Qui
 * invitez-vous ? » kept until the account it is for comes through, days
 * later. A link's name is given within the minute or not at all.
 *
 * What it holds is what the service must never learn, the conversation each
 * invitation leads to, and the name this device will give its recipient.
 * `given` is the empty string when none was typed, as `listCacheStore.ts`
 * spells `null`.
 */
const SCHEMA = `CREATE TABLE IF NOT EXISTS delivered_sent (
  invitation_id TEXT PRIMARY KEY NOT NULL,
  scope TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  given TEXT NOT NULL
)`

export function forgetfulSentInvitations(): SentInvitations {
  return {
    all: async () => [],
    remember: async () => false,
    forget: async () => false,
  }
}

export async function openSentInvitations(
  database: EncryptedDatabase,
): Promise<SentInvitations> {
  await database.execute(SCHEMA)

  return {
    all: async () => {
      try {
        const { rows } = await database.execute(
          'SELECT invitation_id, scope, expires_at, given FROM delivered_sent',
        )
        const held: SentInvitation[] = []
        for (const row of rows) {
          // Read defensively, for the reason the names store gives: a row of
          // the wrong shape is a row to skip, not a tick to fail.
          const { invitation_id, scope, expires_at, given } = row as Record<
            string,
            unknown
          >
          if (
            typeof invitation_id === 'string' &&
            invitation_id !== '' &&
            typeof scope === 'string' &&
            scope !== '' &&
            typeof expires_at === 'number' &&
            typeof given === 'string'
          ) {
            held.push({
              invitationId: invitation_id,
              scope,
              expiresAt: expires_at,
              given: given === '' ? null : given,
            })
          }
        }
        return held
      } catch {
        // A page that will not open asks about nothing this tick: the
        // invitations are still good, and the next tick asks again.
        return []
      }
    },

    remember: async sent => {
      try {
        await database.execute(
          'INSERT OR REPLACE INTO delivered_sent ' +
            '(invitation_id, scope, expires_at, given) VALUES (?, ?, ?, ?)',
          [sent.invitationId, sent.scope, sent.expiresAt, sent.given ?? ''],
        )
        return true
      } catch {
        // Reported by the caller: the invitation is good all the same, but
        // nobody will be let in through it after a relaunch.
        return false
      }
    },

    forget: async invitationId => {
      try {
        await database.execute(
          'DELETE FROM delivered_sent WHERE invitation_id = ?',
          [invitationId],
        )
        return true
      } catch {
        return false
      }
    },
  }
}
