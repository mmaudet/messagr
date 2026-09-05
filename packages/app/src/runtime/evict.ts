import type { CryptoMachine, HttpRequester } from './pump'
import { drainOutgoingRequests } from './pump'

/**
 * Removing somebody from a conversation, and the rotation without which it is
 * theatre.
 *
 * # Why the rotation is the feature
 *
 * Removing a member removes their right to *write*. It does not take back the
 * room key they already hold, and Megolm keys do not expire: with no
 * rotation they go on reading everything sent afterwards, from a conversation
 * they are no longer in, and nothing anywhere tells anyone. ADR-0004 names
 * this as the detail most often left out, and the ticket asks the test to
 * assert the rotation rather than the membership change for exactly that
 * reason -- the membership change is the part that always works and never
 * proves anything.
 *
 * # The ordering, and why it is the mirror of vouching
 *
 * **Remove first, rotate second.** No new key is made by the rotation:
 * `discardScopeKey` invalidates the current session, and the replacement is
 * created at the next `shareScopeKey`, which shares it with the users *that*
 * call names. So rotating before the removal has landed, and sending in
 * between, hands the fresh key to the very person it was rotated away from.
 *
 * `vouch.ts` runs the opposite order for the mirror-image reason: there, the
 * keys must arrive before the power level says they have; here, the departure
 * must land before the key that excludes them exists.
 *
 * # What this cannot do, and the product has to say so
 *
 * **Everything they already read, they keep.** Every message delivered to
 * their device, and every key that opened it, is theirs now. This bounds the
 * future and cannot touch the past -- no call in the crypto library, on the
 * homeserver, or anywhere else can. The gesture that offers this owes its
 * user that sentence before they use it, not after.
 *
 * **In a group, this is one participant's share.** Every other member
 * encrypts with their own key, and the departed party keeps reading theirs
 * until each of them rotates too. For a conversation of two -- which is all
 * this product has -- that is the whole of it.
 */

/** What this gesture needs from the crypto library. */
export interface RotatingMachine extends CryptoMachine {
  /**
   * Invalidates this scope's outbound session. `false` means there was none
   * of this device's to invalidate, which is not a failure.
   */
  readonly discardScopeKey: (scope: string) => Promise<boolean>
}

/** How far the gesture got, named so a failure can say what did happen. */
export type EvictStage = 'removing' | 'rotating' | 'settling'

export type EvictOutcome =
  | {
      readonly evicted: true
      /**
       * Whether a key of this device's existed and was replaced.
       *
       * `false` is not a failure: this device had not encrypted in the
       * conversation, so no key out there came from here and the next send
       * makes a fresh one regardless. It is reported because "the key was
       * rotated" and "there was no key of ours to rotate" are different facts
       * about the conversation, and a test asserting the first must not pass
       * on the second.
       */
      readonly rotated: boolean
    }
  | {
      readonly evicted: false
      readonly stage: EvictStage
      readonly reason: string
      /**
       * Whether the key was rotated anyway.
       *
       * A removal that failed leaves nothing to clean up. A removal that
       * succeeded and a rotation that did not is the state worth naming: the
       * person is out of the conversation and still holds a working key, so
       * a caller has something to retry rather than something to undo.
       */
      readonly rotated: boolean
    }

function why(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/**
 * Removes `memberId` from `scope` and rotates the key behind them.
 *
 * Works on a promoted member and on an entrant alike: `kick` needs the power
 * to remove, which the inviter has, and nothing here reads the target's own
 * level. There is no separate demotion, because there is nothing left to
 * demote once somebody is out of the conversation.
 */
export async function evictFrom(
  http: HttpRequester,
  machine: RotatingMachine,
  scope: string,
  memberId: string,
): Promise<EvictOutcome> {
  try {
    await http.authedRequest(
      'POST',
      `/_matrix/client/v3/rooms/${encodeURIComponent(scope)}/kick`,
      {},
      JSON.stringify({ user_id: memberId }),
    )
  } catch (cause) {
    // Nothing has changed and nothing needs undoing: the rotation has not
    // run, so the conversation is exactly as it was.
    return {
      evicted: false,
      stage: 'removing',
      reason: why(cause),
      rotated: false,
    }
  }

  let rotated = false
  try {
    rotated = await machine.discardScopeKey(scope)
  } catch (cause) {
    // The dangerous half-state, and the reason the outcome carries `rotated`
    // rather than implying it: the member is out and still holds a working
    // key. Retrying the rotation alone fixes it; nothing here should be
    // undone.
    return {
      evicted: false,
      stage: 'rotating',
      reason: why(cause),
      rotated: false,
    }
  }

  // Drained so the removal and anything the rotation left queued actually
  // leave this device before the caller is told it is done. Not fatal on its
  // own -- the rotation is local and has already happened -- but a caller
  // told "evicted" while requests sit in a queue would be told something
  // that is not yet true of the conversation.
  try {
    await drainOutgoingRequests(http, machine)
  } catch (cause) {
    return { evicted: false, stage: 'settling', reason: why(cause), rotated }
  }

  return { evicted: true, rotated }
}
