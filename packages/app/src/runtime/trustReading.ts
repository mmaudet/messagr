import type { TrustState } from 'react-native-matrix-crypto'

/**
 * What is actually known about the person on the other side, and what is not.
 *
 * The conversation labels their messages *« se présente comme »*, and the
 * word for confirming an identity appears nowhere in this application's copy
 * — `copy.spec.ts` fails the build if it ever does. That restraint is right
 * and it is cryptic: somebody reading *« se présente comme »* has no way to
 * find out what would change it. This is the reading the screen that explains
 * it is built on.
 *
 * # Three facts, and they are not one scale
 *
 * A badge would have to rank them. They do not rank, because they come from
 * three different places and any of them can be true without the others:
 *
 * - **What their own account asserts.** A device reported `recognized` was
 *   signed by that person's own cross-signing identity: *they* have said this
 *   device is theirs. It says nothing about whether the account is who you
 *   think, and an attacker who held the account would sign their own device
 *   exactly the same way.
 * - **What your side asserts.** A device reported `verified` was confirmed
 *   from here, by comparing something in person. Nothing in this lot builds
 *   that act, so in practice this is zero — and the screen says so rather
 *   than offering a button that does nothing.
 * - **What a person judged.** Somebody already inside answered for them. That
 *   is the vouching gesture, and it is read from the conversation's power
 *   levels rather than remembered separately, because the promotion *is* the
 *   vouching: `vouch.ts` grants the level, and the room state is the record.
 *   It proves nothing cryptographically and the screen must not let it look
 *   as though it does.
 *
 * # Why devices are counted rather than summarised
 *
 * A person with three devices where one is confirmed and two are not is in a
 * different position from a person with one confirmed device, and a single
 * word for both would hide the difference. The count is the honest surface.
 */

export interface TrustReading {
  /** How many devices this person has that this account knows of. */
  readonly devices: number
  /** How many of them were confirmed from here, in person. */
  readonly confirmedHere: number
  /** How many of them that person's own account has signed as theirs. */
  readonly claimedByThem: number
  /**
   * Whether somebody already inside answered for them.
   *
   * Read from the power levels rather than stored: the promotion is the
   * vouching, so the conversation's own state is the record and there is no
   * second copy to disagree with it.
   */
  readonly vouchedFor: boolean
}

/**
 * Folds what the crypto machine reports, plus one fact from the conversation,
 * into the three counts a screen shows.
 *
 * A device whose state this build does not know is counted in `devices` and
 * in neither of the other two. That is deliberate: `TrustState` is a closed
 * union today and a later version of the library may append to it, and the
 * safe reading of an unknown state is "not established" rather than a guess
 * in either direction.
 */
export function readWhatIsKnown(
  statuses: readonly { readonly trust: TrustState }[],
  vouchedFor: boolean,
): TrustReading {
  return {
    devices: statuses.length,
    confirmedHere: statuses.filter(status => status.trust === 'verified')
      .length,
    claimedByThem: statuses.filter(status => status.trust === 'recognized')
      .length,
    vouchedFor,
  }
}

/**
 * The one sentence a conversation header can carry, chosen from the reading.
 *
 * Deliberately not a ranking. The order below is the order in which a fact
 * changes what somebody should do: a confirmed device settles the question, a
 * vouch is a person's judgement worth knowing about, and everything else is
 * the ordinary starting state — which the prototype is emphatic about not
 * dramatising. Encryption is already there; what is missing is certainty
 * about the person.
 */
export type TrustHeadline = 'confirmed' | 'vouched' | 'nothing-yet'

export function headlineOf(reading: TrustReading): TrustHeadline {
  if (reading.confirmedHere > 0) return 'confirmed'
  if (reading.vouchedFor) return 'vouched'
  return 'nothing-yet'
}
