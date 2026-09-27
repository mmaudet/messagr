import type { Outstanding, OutstandingInvitation } from './outstandingStore'

/**
 * Letting in anybody who has walked through an invitation since last time.
 *
 * # What this replaces
 *
 * Admission used to happen once, in the minute after a link was issued:
 * thirty polls two seconds apart, and then never again. An invitation opened
 * later than that could not be walked through at all, on that launch or any
 * other, while the inviter's screen said the link was good for an hour. See
 * `outstandingStore.ts` for what was watched, and #118.
 *
 * A minute cannot be made into an hour by waiting longer -- an application is
 * not running for an hour, and the launch that matters is the next one. So
 * the question is asked again instead: on every launch, and on every tick of
 * the sync loop (ADR-0007), for every invitation this device has issued and
 * not yet seen anybody come through.
 *
 * # The one-shot poll after issuing stays
 *
 * It is what makes two phones on a table instant, and this is what makes
 * every other case possible. Neither is the other's replacement.
 *
 * # Nothing here throws
 *
 * It runs on a tick, with nobody watching. A rejected request is not an
 * answer -- the row is kept and asked about again -- and one invitation that
 * failed must not leave the next one unasked.
 */

export interface Admitted {
  readonly admitted: true
  readonly entrants: readonly string[]
}
export interface NotAdmitted {
  readonly admitted: false
  readonly reason: string
}

export interface Asking {
  readonly outstanding: Outstanding
  /** `admitEntrant`, behind a port, so this file names no transport. */
  readonly admit: (
    invitation: OutstandingInvitation,
  ) => Promise<Admitted | NotAdmitted>
  readonly now: () => number
  /**
   * Gives the name typed at invite time to whoever came in (#408), as the
   * minute after issuing does. It may throw: the admission stands anyway.
   */
  readonly giveName: (who: string, name: string) => Promise<void>
}

export interface AdmissionRound {
  /** Who was let in this time. Usually nobody, which is not a failure. */
  readonly admitted: readonly string[]
  /** How many were dropped for being past what the token can be. */
  readonly expired: number
}

/**
 * Who a name typed at invite time belongs to, of the accounts let in through
 * one link: the last, not the first. On a link opened by somebody who already
 * has an account there are two, the account the service drew, which cedes
 * its place and deactivates itself, and then the real person. Naming the
 * drawn one would put the name on an account that no longer exists.
 */
export function lastIn(entrants: readonly string[]): string | undefined {
  return entrants[entrants.length - 1]
}

export async function admitAnyoneWaiting(
  asking: Asking,
): Promise<AdmissionRound> {
  const waiting = await asking.outstanding.all()
  const admitted: string[] = []
  let expired = 0

  for (const invitation of waiting) {
    // HOW LONG AN INVITATION STAYS WORTH ASKING ABOUT: as long as its link
    // is good for, an hour or three days (#408), as this device wrote it
    // down. The service is the authority on expiry and this is not a second
    // opinion: it is what lets this side drop a row when the service cannot
    // be reached at all, so a link that died in August is not still being
    // asked about in December.
    //
    // Generous rather than exact: `issuedAt` is noted once the service has
    // answered, a little after its own clock started. A row dropped a tick
    // early is a person who cannot enter and a link that looked valid --
    // indistinguishable from the defect this replaces -- and a row kept a
    // little too long costs one request that answers "no".
    if (asking.now() - invitation.issuedAt > invitation.lifetime) {
      expired += 1
      await asking.outstanding.forget(invitation.invitationId)
      continue
    }

    try {
      const answer = await asking.admit(invitation)
      if (answer.admitted) {
        admitted.push(...answer.entrants)
        // Forgotten only once somebody is actually in. Anything else -- not
        // yet claimed, a refused invite, a dropped request -- leaves the row,
        // because the next tick is what this whole file is for.
        await asking.outstanding.forget(invitation.invitationId)
        // NAMED AFTER THE ROW IS FORGOTTEN, so that a name which does not
        // hold never has the same person let in twice.
        const who = lastIn(answer.entrants)
        if (invitation.given !== null && who !== undefined) {
          await asking.giveName(who, invitation.given)
        }
      }
    } catch {
      // Deliberately swallowed and deliberately not reported here: the caller
      // logs the round, and a failed ask about one invitation says nothing
      // about the next.
    }
  }

  return { admitted, expired }
}
