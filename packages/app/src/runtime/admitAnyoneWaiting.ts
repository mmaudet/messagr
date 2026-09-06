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
  readonly entrant: string
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
}

/**
 * How long an invitation stays worth asking about.
 *
 * An hour, because that is what the token is good for and what
 * `invite_ready` tells the inviter. The service is the authority on expiry
 * and this is not a second opinion: it is what lets this side drop a row when
 * the service cannot be reached at all, so a link that died in August is not
 * still being asked about in December.
 *
 * Generous by a minute rather than exact, deliberately. A row dropped a tick
 * early is a person who cannot enter and a link that looked valid --
 * indistinguishable from the defect this replaces -- and a row kept a minute
 * too long costs one request that answers "no".
 */
export const STOP_ASKING_AFTER_MS = 60 * 60 * 1000

export interface AdmissionRound {
  /** Who was let in this time. Usually nobody, which is not a failure. */
  readonly admitted: readonly string[]
  /** How many were dropped for being past what the token can be. */
  readonly expired: number
}

export async function admitAnyoneWaiting(
  asking: Asking,
): Promise<AdmissionRound> {
  const waiting = await asking.outstanding.all()
  const admitted: string[] = []
  let expired = 0

  for (const invitation of waiting) {
    if (asking.now() - invitation.issuedAt > STOP_ASKING_AFTER_MS) {
      expired += 1
      await asking.outstanding.forget(invitation.invitationId)
      continue
    }

    try {
      const answer = await asking.admit(invitation)
      if (answer.admitted) {
        admitted.push(answer.entrant)
        // Forgotten only once somebody is actually in. Anything else -- not
        // yet claimed, a refused invite, a dropped request -- leaves the row,
        // because the next tick is what this whole file is for.
        await asking.outstanding.forget(invitation.invitationId)
      }
    } catch {
      // Deliberately swallowed and deliberately not reported here: the caller
      // logs the round, and a failed ask about one invitation says nothing
      // about the next.
    }
  }

  return { admitted, expired }
}
