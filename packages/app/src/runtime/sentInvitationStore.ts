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
 * spells `null`, and `expired` is 1 once the service said it ran out: the
 * list says so, until the thirty days the service keeps it have passed.
 */
const SCHEMA = `CREATE TABLE IF NOT EXISTS invitations_delivered_from_here (
  invitation_id TEXT PRIMARY KEY NOT NULL,
  scope TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  given TEXT NOT NULL,
  expired INTEGER NOT NULL
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
          'SELECT invitation_id, scope, expires_at, given, expired ' +
            'FROM invitations_delivered_from_here',
        )
        const held: SentInvitation[] = []
        for (const row of rows) {
          // Read defensively, for the reason the names store gives: a row of
          // the wrong shape is a row to skip, not a tick to fail.
          const { invitation_id, scope, expires_at, given, expired } =
            row as Record<string, unknown>
          if (
            typeof invitation_id === 'string' &&
            invitation_id !== '' &&
            typeof scope === 'string' &&
            scope !== '' &&
            typeof expires_at === 'number' &&
            typeof given === 'string' &&
            (expired === 0 || expired === 1)
          ) {
            held.push({
              invitationId: invitation_id,
              scope,
              expiresAt: expires_at,
              given: given === '' ? null : given,
              expired: expired === 1,
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
          'INSERT OR REPLACE INTO invitations_delivered_from_here ' +
            '(invitation_id, scope, expires_at, given, expired) ' +
            'VALUES (?, ?, ?, ?, ?)',
          [
            sent.invitationId,
            sent.scope,
            sent.expiresAt,
            sent.given ?? '',
            sent.expired ? 1 : 0,
          ],
        )
        return true
      } catch {
        // Reported by the caller: the invitation is good all the same, and
        // this launch still lets its recipient in (`keptThisLaunchToo`); a
        // relaunch will not know of it.
        return false
      }
    },

    forget: async invitationId => {
      try {
        await database.execute(
          'DELETE FROM invitations_delivered_from_here WHERE invitation_id = ?',
          [invitationId],
        )
        return true
      } catch {
        return false
      }
    },
  }
}
