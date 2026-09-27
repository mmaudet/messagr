import { bytesOf } from './base64'
import { generateKeyPair, type KeyPair } from './hpke'
import { base64Of } from './receiveImage'
import type { SecretStore } from './sessionStore'

/**
 * The envelope keys of this device (#405): the X25519 pairs whose public half
 * a proof publishes, which the directory lists with the reference, and whose
 * secret half opens the names inviters seal for this account
 * (`sealedName.ts`). Kept in the operating system's keystore with the
 * account's other secrets, and forgotten with them (`deviceSecrets.ts`).
 *
 * # A NEW PAIR FOR EACH PROOF, AND THE ONE BEFORE FOR A WEEK
 *
 * Each proof, a renewal included, publishes a fresh public key, which
 * replaces the last one in the directory. An invitation sealed for the last
 * one may still be waiting, for it is good seven days: so a secret key stays
 * seven days after it is replaced, then goes.
 *
 * KEPT ONCE THE PROOF HOLDS, and not before: a proof refused leaves the key
 * the directory still lists, and its secret, exactly as they were.
 */

/** How long a secret key outlives its replacement: an invitation's life. */
export const REPLACED_KEPT_MS = 7 * 86_400_000

export interface EnvelopeKeys {
  /** A fresh pair, for a proof about to be finished. Nothing is kept yet. */
  readonly fresh: () => KeyPair
  /**
   * The proof holds: `pair` is the one published now, and the last one is
   * replaced. Whether the keystore took it.
   */
  readonly keep: (pair: KeyPair) => Promise<boolean>
  /** The secret keys this device opens sealed names with, newest first. */
  readonly secrets: () => Promise<readonly Uint8Array[]>
}

/** A secret key as the keystore holds it. */
interface Held {
  /** Base64. */
  readonly secret: string
  /** Milliseconds since the epoch, or `null` for the key published now. */
  readonly replacedAt: number | null
}

function isHeld(value: unknown): value is Held {
  if (typeof value !== 'object' || value === null) return false
  const { secret, replacedAt } = value as Record<string, unknown>
  return (
    typeof secret === 'string' &&
    (replacedAt === null || typeof replacedAt === 'number')
  )
}

export function envelopeKeysIn(
  store: SecretStore,
  now: () => number,
): EnvelopeKeys {
  // What the keystore holds, a week's replaced keys included. An entry that
  // will not read is no key rather than no keyring: names sealed for it are
  // shown without a name, as the ticket asks of any envelope that will not
  // open.
  const held = async (): Promise<Held[]> => {
    try {
      const value = await store.read()
      const parsed: unknown =
        value === null || value === '' ? [] : JSON.parse(value)
      const all = Array.isArray(parsed) ? parsed.filter(isHeld) : []
      return all.filter(
        one =>
          one.replacedAt === null || now() - one.replacedAt < REPLACED_KEPT_MS,
      )
    } catch {
      return []
    }
  }
  return {
    fresh: generateKeyPair,
    keep: async pair => {
      const at = now()
      const next: Held[] = [
        { secret: base64Of(pair.secretKey), replacedAt: null },
        ...(await held()).map(one =>
          one.replacedAt === null ? { ...one, replacedAt: at } : one,
        ),
      ]
      try {
        await store.write(JSON.stringify(next))
        return true
      } catch {
        return false
      }
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
