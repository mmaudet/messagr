import type { EncryptedDatabase } from './givenNameStore'

/**
 * The invitations this device has issued and nobody has been let in through
 * yet.
 *
 * # Why this has to exist at all
 *
 * Entry is in two stages (ADR-0004): an entrant's claim *draws* an account
 * and is answered 409, and the link keeps failing until the inviter's
 * application admits that account into the room. Admission was something the
 * inviter did once, for one minute, immediately after issuing the link --
 * thirty polls two seconds apart -- and then never again, on that launch or
 * any later one.
 *
 * So an invitation was admissible only if it was opened within a minute of
 * being created, while `invite_ready` told the inviter it was good for an
 * hour. The case that worked was two phones on a table; the ordinary case --
 * you send somebody a link and they open it when they get to it -- failed
 * permanently, and the person on the far end saw a correct screen saying
 * something true and useless. Watched on two devices, and #118.
 *
 * A minute of polling cannot be made into an hour of polling: an application
 * is not running for an hour, and the one that matters is the one that gets
 * relaunched. What is needed is not a longer wait but a *memory* -- so the
 * question "has anybody claimed this?" can be asked again on every launch and
 * every sync tick, which is what `admitAnyoneWaiting` does with what this
 * holds.
 *
 * # Why it is in the encrypted notebook
 *
 * The third page of it (ADR-0010), and it belongs there for the reason the
 * names and the read marks do: a list of who you have invited and when is a
 * social graph in miniature. It is not ordinary storage.
 */

export interface Outstanding {
  /** Every invitation still waiting for somebody to walk through it. */
  readonly all: () => Promise<readonly OutstandingInvitation[]>
  /** Returns whether it held, the way the other two pages do. */
  readonly remember: (invitation: OutstandingInvitation) => Promise<boolean>
  /** Admitted, revoked, or expired: all three mean stop asking. */
  readonly forget: (invitationId: string) => Promise<boolean>
}

export interface OutstandingInvitation {
  readonly invitationId: string
  /** The room the entrant is to be admitted into. */
  readonly scope: string
  /** When it was issued, so an expired one can be dropped without asking. */
  readonly issuedAt: number
  /**
   * How long its link is good for, in milliseconds as `issuedAt` is: an
   * hour, or three days for a contact absent from Messagr (#408).
   */
  readonly lifetime: number
  /**
   * The name typed for whoever walks through it, or `null`: given to them
   * when they are let in, however late that is (#408).
   */
  readonly name: string | null
}

/**
 * The table. One row per invitation, and the invitation is the key.
 *
 * `issuedAt` is stored rather than derived because the service is the
 * authority on expiry and this side needs an answer when the service cannot
 * be reached -- a row nobody can ask about and that is a day old is a row to
 * drop, not one to keep asking about forever.
 */
const SCHEMA = `CREATE TABLE IF NOT EXISTS outstanding_invitations (
  invitation_id TEXT PRIMARY KEY NOT NULL,
  scope TEXT NOT NULL,
  issued_at INTEGER NOT NULL
)`

/**
 * The two columns added for #408, migrated as `callLogStore.ts`'s are: run
 * unguarded, and their failure swallowed, since the only reason either fails
 * is that the column is already there.
 *
 * Each default is the truth about every row written before it. Every link
 * issued until then was good for an hour, and no name was kept: the name
 * typed for whoever came was given only if they came within the minute
 * after issuing, and lost otherwise. A three-day link is nearly always
 * walked through later than that.
 */
const ADD_LIFETIME = `ALTER TABLE outstanding_invitations ADD COLUMN lifetime INTEGER NOT NULL DEFAULT 3600000`
const ADD_GIVEN_NAME = `ALTER TABLE outstanding_invitations ADD COLUMN given_name TEXT NOT NULL DEFAULT ''`

export async function openOutstanding(
  database: EncryptedDatabase,
): Promise<Outstanding> {
  await database.execute(SCHEMA)
  await database.execute(ADD_LIFETIME).catch(() => undefined)
  await database.execute(ADD_GIVEN_NAME).catch(() => undefined)

  return {
    all: async () => {
      const { rows } = await database.execute(
        'SELECT invitation_id, scope, issued_at, lifetime, given_name ' +
          'FROM outstanding_invitations',
      )
      const held: OutstandingInvitation[] = []
      for (const row of rows) {
        // Read defensively rather than cast, for the reason the names store
        // gives: this is a file on a device, and a row of the wrong shape is
        // a row to skip and not a launch to lose.
        if (
          typeof row.invitation_id === 'string' &&
          typeof row.scope === 'string' &&
          typeof row.issued_at === 'number' &&
          typeof row.lifetime === 'number' &&
          typeof row.given_name === 'string'
        ) {
          held.push({
            invitationId: row.invitation_id,
            scope: row.scope,
            issuedAt: row.issued_at,
            lifetime: row.lifetime,
            name: row.given_name === '' ? null : row.given_name,
          })
        }
      }
      return held
    },

    remember: async invitation => {
      try {
        // `OR REPLACE` rather than a plain insert: issuing is idempotent from
        // this side's point of view, and a second row for one invitation
        // would make the same person admitted twice.
        await database.execute(
          `INSERT OR REPLACE INTO outstanding_invitations
             (invitation_id, scope, issued_at, lifetime, given_name)
             VALUES (?, ?, ?, ?, ?)`,
          [
            invitation.invitationId,
            invitation.scope,
            invitation.issuedAt,
            invitation.lifetime,
            // Strings and numbers only, as `listCacheStore.ts` says.
            invitation.name ?? '',
          ],
        )
        return true
      } catch {
        // Reported by the caller, not thrown here. An invitation that could
        // not be written down is still a valid invitation: what is lost is
        // the retry after a relaunch, not the link.
        return false
      }
    },

    forget: async invitationId => {
      try {
        await database.execute(
          'DELETE FROM outstanding_invitations WHERE invitation_id = ?',
          [invitationId],
        )
        return true
      } catch {
        return false
      }
    },
  }
}

/**
 * What to use when the notebook did not open.
 *
 * The application runs without it -- see `notebook.ts` -- and an invitation
 * issued on such a launch is admissible for as long as that launch lives,
 * which is what the one-minute poll already gave. Degraded, not broken.
 */
export function forgetfulOutstanding(): Outstanding {
  return {
    all: async () => [],
    remember: async () => false,
    forget: async () => false,
  }
}
