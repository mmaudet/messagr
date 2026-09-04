// Type-only, for the reason every module here that names the crypto package
// states: importing it as a value installs its native JSI bootstrap and
// crashes Vitest's parser. The concrete functions are bound in cryptoPump.ts.
import type { IdentityStatus } from 'react-native-matrix-crypto'

import { getErrorMessage } from './errors'
import type { DrainResult } from './pump'

/**
 * Giving this account a cross-signing identity, once, at the moment it is
 * created.
 *
 * # Why the timing is the whole decision
 *
 * Creating an identity over one an account already has **replaces** it, and
 * that resets the trust of every device and every person who ever verified
 * the old one. There is no undo, and — the library is explicit about this —
 * nothing afterwards can detect that it happened: the confirming key query
 * comes back carrying the new identity, it matches the store, and the device
 * reports as perfectly healthy.
 *
 * So the library splits the surface in two and refuses to make the call for
 * anyone. `bootstrapCrossSigning` is safe and belongs on every launch: it
 * publishes or republishes an identity this device already holds.
 * `createCrossSigningIdentity` is the destructive one, and it needs a fact
 * the library cannot have.
 *
 * A `/keys/query` answer is only ever true of the instant the server sent it;
 * between that instant and the call, another device of the same account can
 * publish an identity, and no answer already in hand can say so. The library
 * therefore names what a product may supply instead — "the user has just
 * created the account", "this is the sign-up flow rather than a relaunch" —
 * and warns that answering `identity_not_known` by creating one is exactly
 * the shape the split exists to prevent.
 *
 * **This application has an unusually strong form of that fact.** An entry
 * that claimed an invitation created the account during this very launch, by
 * spending a single-use token. No other device can have published anything,
 * because no other device has ever held this account. That is why the
 * entitlement here is a parameter and not a guess: it comes from
 * `entry.ts`'s `claimed`, and a launch that merely restored a session never
 * carries it.
 *
 * # Accounts that predate this, and why none needs migrating
 *
 * An account created before this existed restores a session rather than
 * claiming, so it never carries the entitlement and is left exactly as it
 * was: no identity, sharing by device, working. It is not broken and it is
 * not silently changed either, which is the safe direction.
 *
 * There are no such accounts outside the bench. The invitation service is not
 * deployed to production yet, so this flow has never created an account
 * anywhere else, and the bench mints fresh ones every run. That is the reason
 * no migration is written here rather than an omission -- and the day one is
 * needed, giving an existing account its first identity is a decision with a
 * person to ask, not a launch-time default.
 *
 * # What changes once it exists
 *
 * The machine starts collecting room-key recipients by identity (MSC4153)
 * instead of by device. `sharingStrategy.ts` reads that out of the machine,
 * so the change is observed rather than asserted.
 */
export interface IdentityMachineOps {
  readonly getIdentityStatus: () => Promise<IdentityStatus>
  readonly bootstrapCrossSigning: () => Promise<void>
  readonly createCrossSigningIdentity: () => Promise<void>
}

export type IdentityReport =
  | {
      readonly established: true
      /**
       * `'published'` republished an identity this device already held and
       * the server already knew. `'created'` made the account's first, which
       * happens exactly once in an account's life. `'resumed'` re-handed a
       * publication this device had created and never seen accepted -- the
       * same identity, not a new one.
       */
      readonly how: 'published' | 'created' | 'resumed'
    }
  | { readonly established: false; readonly reason: string }

/**
 * Bounded because `account_keys_not_fetched` is answered by sending a query
 * and asking again: a machine that never stopped saying it would otherwise
 * loop for as long as the launch lasts.
 */
const MAX_ROUNDS = 4

/**
 * The library brands its errors and exports `isCryptoError` to recognise
 * them, but that is a *value* export from a package this module may not
 * import as a value. Reading the field defensively is what a consumer on
 * this side of an FFI boundary should do anyway: the kinds are an open set,
 * and one this application does not know must not be mistaken for one it
 * does.
 */
function kindOf(cause: unknown): string | null {
  if (!(cause instanceof Error)) {
    return null
  }
  const { kind } = cause as { kind?: unknown }
  return typeof kind === 'string' ? kind : null
}

/**
 * Why a drain that failed did, in the terms of what it was carrying.
 *
 * A refused `signing_keys_upload` is a server asking for user-interactive
 * authentication. Since Matrix 1.11 the first upload for an account that has
 * no identity needs none, which is the only case this application ever makes
 * — and it holds no password to answer a challenge with, having deliberately
 * never kept the one the claim returned. Saying so is what stops a 401 here
 * from reading as a generic upload failure and costing a run to place.
 */
function describeFailedDrain(drained: DrainResult): string {
  const challenged = drained.failures.find(
    failure => failure.kind === 'signing_keys_upload' && failure.status === 401,
  )
  if (challenged !== undefined) {
    return (
      'the server asked for interactive authentication to publish the ' +
      'signing keys, which this application cannot answer'
    )
  }
  return `the identity's own requests could not be sent: ${drained.failures
    .map(failure => `${failure.kind} (${String(failure.status)})`)
    .join(', ')}`
}

export async function establishCrossSigningIdentity(
  machine: IdentityMachineOps,
  drain: () => Promise<DrainResult>,
  accountCreatedByThisLaunch: boolean,
): Promise<IdentityReport> {
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    let refusal: unknown = null
    try {
      await machine.bootstrapCrossSigning()
    } catch (cause: unknown) {
      refusal = cause
    }

    if (refusal === null) {
      // Published, or republished. Either way the batch is in the machine and
      // nothing has left the device until it is sent.
      const drained = await drain()
      return drained.failed > 0
        ? { established: false, reason: describeFailedDrain(drained) }
        : { established: true, how: 'published' }
    }

    switch (kindOf(refusal)) {
      case 'account_keys_not_fetched': {
        // Two situations wear this refusal and only one of them is worth
        // retrying. The library says to read the other field to tell them
        // apart: when the answer came back and still did not settle the
        // question, asking again does exactly the same thing forever.
        const status = await machine.getIdentityStatus()
        if (status.accountKeysAnswerUnsettled) {
          return {
            established: false,
            reason:
              'the server answered about this account and the answer still ' +
              'did not say whether it has an identity, so asking again ' +
              'cannot change it; the reachable cause is a user id whose ' +
              'server name differs in case from the homeserver own',
          }
        }
        // Not a failure: the call queued the key query on its way out. Send
        // it and ask again.
        const drained = await drain()
        if (drained.failed > 0) {
          return { established: false, reason: describeFailedDrain(drained) }
        }
        continue
      }

      case 'identity_not_known': {
        // The server was asked and named no identity for this account -- but
        // that is two situations, and the second one is a device this
        // application itself left half-finished.
        const status = await machine.getIdentityStatus()
        if (status.identityPublicationPending) {
          // This device created an identity and never saw a homeserver
          // accept it: the store survived, the publication did not. The
          // library's remedy is to make the same call again, deliberately,
          // and it hands back the publication that was lost rather than
          // minting a second identity. Without this an account interrupted
          // mid-creation stays unpublished for good, because every later
          // launch is a restore and no restore is entitled to create.
          return publishHeldIdentity(machine, drain, 'resumed')
        }
        if (!accountCreatedByThisLaunch) {
          return {
            established: false,
            reason:
              'this account has no identity, and a launch that only restored ' +
              'a session is not entitled to create one',
          }
        }
        return publishHeldIdentity(machine, drain, 'created')
      }

      case 'identity_already_exists':
        // This device joins that identity; it does not replace it. Joining is
        // a verification and another ticket. Refusing here is what keeps this
        // one from destroying an identity somebody already trusts.
        return {
          established: false,
          reason:
            "the account's identity belongs to another device, which this " +
            'one must join rather than replace',
        }

      default:
        // An unrecognised refusal is not an absence, and must never be read
        // as permission to create.
        return { established: false, reason: getErrorMessage(refusal) }
    }
  }

  return {
    established: false,
    reason: `the identity never settled after ${String(MAX_ROUNDS)} rounds`,
  }
}

/**
 * The destructive call, made only where one of two entitlements holds: this
 * launch created the account, or this device is finishing a publication it
 * had already created and never saw accepted. `how` records which, because
 * they are the same call and a very different event.
 */
async function publishHeldIdentity(
  machine: IdentityMachineOps,
  drain: () => Promise<DrainResult>,
  how: 'created' | 'resumed',
): Promise<IdentityReport> {
  try {
    await machine.createCrossSigningIdentity()
  } catch (cause: unknown) {
    return { established: false, reason: getErrorMessage(cause) }
  }

  const drained = await drain()
  return drained.failed > 0
    ? { established: false, reason: describeFailedDrain(drained) }
    : { established: true, how }
}
