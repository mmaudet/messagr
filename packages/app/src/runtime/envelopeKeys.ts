import { bytesOf } from './base64'
import { generateKeyPair, publicKeyOf, type KeyPair } from './hpke'
import { base64Of } from './receiveImage'
import type { SecretStore } from './sessionStore'

/**
 * The envelope keys of this device (#405): the X25519 pairs whose public half
 * a proof publishes, which the directory lists with the reference, and whose
 * secret half opens the names inviters seal for this account
 * (`sealedName.ts`). Kept in the operating system's keystore with the
 * account's other secrets, and forgotten with them (`deviceSecrets.ts`).
 *
 * # KEPT BEFORE IT LEAVES
 *
 * The service publishes a key the moment the proof it came with holds,
 * whether or not this device hears the answer: the journey may have been
 * closed meanwhile, the answer lost, the application stopped. So the pair is
 * written to the keystore before its public half leaves, as waiting, and a
 * waiting key opens names like any other. The next proof takes the same one
 * again rather than a new one each attempt. A keystore that will not keep it
 * gives nothing to publish: no key sends no name, where a key nobody holds
 * would lose every name sealed for it.
 *
 * # A NEW PAIR FOR EACH PROOF, AND THE OTHERS THIRTY DAYS
 *
 * Once a proof holds with a pair, every other key is replaced. A replaced key
 * still opens names for thirty days, then leaves the keystore: an invitation
 * is good a week from when it is sent, but it can be sealed for the key an
 * inviter read before the renewal, since a renewal keeps the reference, and
 * thirty days is how long the service keeps what a proof leaves behind
 * (#398).
 */

/** How long a replaced key still opens names. */
export const REPLACED_KEPT_MS = 30 * 86_400_000

export interface EnvelopeKeys {
  /**
   * The pair to publish with the proof about to be finished, already in the
   * keystore: the one a proof took with it and never heard back about, or a
   * fresh one. `null` when the keystore would not keep it.
   */
  readonly toPublish: () => Promise<KeyPair | null>
  /**
   * The proof held with `pair`: it is the key the directory lists now, and
   * every other one is replaced from now.
   */
  readonly published: (pair: KeyPair) => Promise<void>
  /** The secret keys this device opens sealed names with, newest first. */
  readonly secrets: () => Promise<readonly Uint8Array[]>
}

/** A secret key as the keystore holds it. */
interface Held {
  /** Base64. */
  readonly secret: string
  /** Taken with a proof not known to have held. */
  readonly waiting: boolean
  /** Milliseconds since the epoch, or `null` while it is not replaced. */
  readonly replacedAt: number | null
}

function isHeld(value: unknown): value is Held {
  if (typeof value !== 'object' || value === null) return false
  const { secret, waiting, replacedAt } = value as Record<string, unknown>
  return (
    typeof secret === 'string' &&
    typeof waiting === 'boolean' &&
    (replacedAt === null || typeof replacedAt === 'number')
  )
}

export function envelopeKeysIn(
  store: SecretStore,
  now: () => number,
): EnvelopeKeys {
  const write = async (all: readonly Held[]): Promise<boolean> => {
    try {
      await store.write(JSON.stringify(all))
      return true
    } catch {
      return false
    }
  }
  // What the keystore holds, the keys replaced more than thirty days ago
  // taken out of the keystore itself as they are found. An entry that will
  // not read is no key rather than no keyring: names sealed for it are shown
  // without a name, as #405 asks of any envelope that will not open.
  const held = async (): Promise<Held[]> => {
    let all: Held[]
    try {
      const value = await store.read()
      const parsed: unknown =
        value === null || value === '' ? [] : JSON.parse(value)
      all = Array.isArray(parsed) ? parsed.filter(isHeld) : []
    } catch {
      return []
    }
    const live = all.filter(
      one =>
        one.replacedAt === null || now() - one.replacedAt < REPLACED_KEPT_MS,
    )
    if (live.length < all.length) await write(live)
    return live
  }
  const pairOf = (secret: string): KeyPair => {
    const secretKey = bytesOf(secret)
    return { secretKey, publicKey: publicKeyOf(secretKey) }
  }
  return {
    toPublish: async () => {
      const all = await held()
      const waiting = all.find(one => one.waiting && one.replacedAt === null)
      if (waiting !== undefined) {
        try {
          return pairOf(waiting.secret)
        } catch {
          // Unreadable: a fresh one, below.
        }
      }
      const fresh = generateKeyPair()
      const kept = await write([
        { secret: base64Of(fresh.secretKey), waiting: true, replacedAt: null },
        ...all,
      ])
      return kept ? fresh : null
    },
    published: async pair => {
      const at = now()
      const secret = base64Of(pair.secretKey)
      const all = await held()
      await write([
        { secret, waiting: false, replacedAt: null },
        ...all
          .filter(one => one.secret !== secret)
          .map(one =>
            one.replacedAt === null ? { ...one, replacedAt: at } : one,
          ),
      ])
    },
    secrets: async () =>
      (await held()).flatMap(one => {
        try {
          return [bytesOf(one.secret)]
        } catch {
          return []
        }
      }),
  }
}
