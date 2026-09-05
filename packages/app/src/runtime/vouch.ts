import type { CryptoMachine, HttpRequester } from './pump'
import { drainOutgoingRequests } from './pump'
import { grantPower, type PowerReading } from './powerLevels'

/**
 * Vouching for an entrant, and promoting them.
 *
 * # What vouching is, and what it is not
 *
 * After a few exchanges the inviter says: this is the person I meant to
 * invite. That is a human judgement about a human, and it proves nothing
 * cryptographically. It is deliberately not *verification*, which is
 * comparing a short string or scanning a code, and deliberately not
 * *recognition*, which the glossary reserves for reaching a trust state
 * through the address book.
 *
 * It answers what the pinned fingerprint cannot. The pin proves which
 * *account* issued an invitation and says nothing about which *human* holds
 * it: an inviter's stolen phone produces an invitation that pins perfectly.
 * Only somebody reading how the newcomer writes catches that.
 *
 * It needs no cooperation from the entrant, which is what lets it happen
 * whenever the inviter is ready rather than requiring both people at once.
 *
 * # The ordering, which is the whole point
 *
 * **Share the history keys first. Raise the power level after.**
 *
 * A power level is public room state, and it is what the invitation service
 * reads to decide whether somebody may invite. Raising it first would
 * announce a promotion whose history is still in flight, so a client reading
 * the level would be told the keys had arrived when they had not. Raising it
 * last inverts that into a guarantee: the level a client can see means the
 * keys already went out.
 *
 * "Went out" is checked rather than hoped for, and that is the step it would
 * be easiest to skip. `shareHistoryBundle` only *queues* the announcement --
 * every outbound message this library produces is queued for the product to
 * send. Promoting after the call but before the drain would raise the level
 * while the announcement still sat in a queue, which is the exact inversion
 * this ordering exists to prevent, arrived at by a route that looks correct.
 * So this waits for a drain that actually reports a `to_device` request sent.
 *
 * # Every failure leaves the entrant un-promoted, and that is the safe way
 *
 * Promotion is last, so anything that goes wrong stops before it. The
 * entrant may then hold history without the power level, which costs
 * nothing: history they can read and no right they should not have. The
 * reverse -- the level without the history -- is the state this order makes
 * unreachable.
 *
 * A vouching that failed can simply be tried again. The second run builds a
 * fresh bundle and announces it again, which is wasteful and harmless: the
 * recipient imports the same sessions twice and nothing else changes.
 */

/** What this gesture needs to put bytes into the media repository. */
export interface MediaUploader {
  /** Uploads `bytes` and answers with the `mxc://` URI they landed at. */
  readonly upload: (bytes: Uint8Array, contentType: string) => Promise<string>
}

/** What this gesture needs from the crypto library. */
export interface HistoryMachine extends CryptoMachine {
  readonly buildHistoryBundle: (scope: string) => Promise<{
    readonly ciphertext: Uint8Array
    readonly secret: string
    readonly shared: number
    readonly withheld: number
  }>
  readonly shareHistoryBundle: (
    scope: string,
    userId: string,
    url: string,
    secret: string,
  ) => Promise<void>
}

/**
 * How far the gesture got. Named rather than numbered so a failure can say
 * what did and did not happen, which is the difference between "try again"
 * and "something is wrong with your homeserver".
 */
export type VouchStage =
  'assembling' | 'uploading' | 'announcing' | 'sending' | 'promoting'

export type VouchOutcome =
  | {
      readonly vouched: true
      /** How many sessions of history the entrant was given. */
      readonly shared: number
      /** How many were deliberately left out. */
      readonly withheld: number
      /** What the conversation says the entrant now holds, read back. */
      readonly power: PowerReading
    }
  | {
      readonly vouched: false
      readonly stage: VouchStage
      readonly reason: string
      /**
       * Always `false`, and stated rather than implied: the promotion is the
       * last step, so no failure can leave it half-done. A caller can say
       * "nothing changed for them" without having to reason about ordering.
       */
      readonly promoted: false
    }

/**
 * The level a promoted member holds.
 *
 * 50 because that is what a conversation this product creates requires to
 * invite, and the invitation service reads the same event rather than taking
 * this application's word for it. It is not a constant those two share in
 * code, which is a seam worth knowing about: they agree because both read
 * the room, and this number is what makes the room say yes.
 */
export const PROMOTED_LEVEL = 50

function why(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/**
 * Vouches for `entrantId` in `scope`: gives them the conversation's history,
 * then raises them to a member who may invite.
 *
 * One gesture from the caller's side, five steps underneath, and the caller
 * is told which one stopped if any did.
 */
export async function vouchFor(
  http: HttpRequester,
  machine: HistoryMachine,
  media: MediaUploader,
  scope: string,
  entrantId: string,
): Promise<VouchOutcome> {
  let bundle
  try {
    bundle = await machine.buildHistoryBundle(scope)
  } catch (cause) {
    return {
      vouched: false,
      stage: 'assembling',
      reason: why(cause),
      promoted: false,
    }
  }

  // An empty bundle is not a failure and does not stop the gesture. A
  // conversation nothing has been said in yet has no past to hand over, and
  // the entrant should still be promoted -- refusing here would make
  // vouching depend on whether anybody had spoken.
  let url: string
  try {
    url = await media.upload(bundle.ciphertext, 'application/octet-stream')
  } catch (cause) {
    return {
      vouched: false,
      stage: 'uploading',
      reason: why(cause),
      promoted: false,
    }
  }

  try {
    await machine.shareHistoryBundle(scope, entrantId, url, bundle.secret)
  } catch (cause) {
    return {
      vouched: false,
      stage: 'announcing',
      reason: why(cause),
      promoted: false,
    }
  }

  // The step that makes the ordering real. `shareHistoryBundle` queued the
  // announcement; this is what sends it, and the promotion below must not
  // happen until it has.
  let drained
  try {
    drained = await drainOutgoingRequests(http, machine)
  } catch (cause) {
    return {
      vouched: false,
      stage: 'sending',
      reason: why(cause),
      promoted: false,
    }
  }
  if (!drained.sentKinds.includes('to_device')) {
    // Deliberately a refusal rather than a warning. A drain that sent no
    // to-device request sent no announcement, and promoting anyway would
    // publish a power level whose history is still in a queue -- the one
    // state this gesture's order exists to make unreachable.
    const refused = drained.failures
      .map(failure => `${failure.kind} (${failure.status})`)
      .join(', ')
    return {
      vouched: false,
      stage: 'sending',
      reason:
        refused === ''
          ? 'the history announcement was not sent, and nothing reported why'
          : `the history announcement was not sent: ${refused}`,
      promoted: false,
    }
  }

  try {
    const power = await grantPower(http, scope, entrantId, PROMOTED_LEVEL)
    return {
      vouched: true,
      shared: bundle.shared,
      withheld: bundle.withheld,
      power,
    }
  } catch (cause) {
    return {
      vouched: false,
      stage: 'promoting',
      reason: why(cause),
      promoted: false,
    }
  }
}
