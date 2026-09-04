import { getErrorMessage } from './errors'
import type { SecretStore } from './sessionStore'

/**
 * The passphrase that encrypts this device's crypto store.
 *
 * The store holds this device's Olm identity, its Megolm sessions and every
 * room key it has ever received. Until now it was opened with a constant
 * written in the source, which meant anyone who could read the repository
 * could open any device's store. That was defensible while the screen had no
 * user, no keystore and no secret of its own -- the code said so in as many
 * words -- and creating an account for a real person removed all three
 * conditions at once.
 *
 * # One per device, minted here, never derived
 *
 * Derived from the device id or the user id it would not be a passphrase but
 * an obfuscation: both are on the server, and one of them travels in the
 * invitation link. So it is random, and it is kept beside the session in the
 * operating system's own keystore.
 *
 * # Why a failure is reported rather than worked around
 *
 * There is exactly one passphrase that opens this store, and a second one is
 * not a second chance: it is a store nobody can open, with every room key
 * this device holds behind the first. So the two ways this can go wrong are
 * reported rather than absorbed.
 *
 * A keystore that **refuses to be read** is not a device without a
 * passphrase. Minting over it would replace one that still exists and orphan
 * the store it opens, which is why the two cases are distinguished at all --
 * `null` is an absent entry, a throw is an unreadable one.
 *
 * A passphrase minted and **not kept** is worse than none: the store would be
 * written with it now and reopened with a different one next launch.
 */
export type Randomness = (byteLength: number) => Uint8Array

export type PassphraseResult =
  | {
      readonly held: true
      readonly passphrase: string
      /** True on the launch that created it, which happens once per device. */
      readonly minted: boolean
    }
  | { readonly held: false; readonly reason: string }

/**
 * 32 bytes, rendered as 64 hexadecimal characters. Hexadecimal rather than
 * base64 because it needs no encoder this runtime may or may not have, and
 * the passphrase is never typed by anyone.
 */
const BYTES = 32

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')

export async function openStorePassphrase(
  secrets: SecretStore,
  random: Randomness,
): Promise<PassphraseResult> {
  let held: string | null
  try {
    held = await secrets.read()
  } catch (cause: unknown) {
    return {
      held: false,
      reason: `the crypto store's passphrase could not be read: ${getErrorMessage(cause)}`,
    }
  }

  if (held !== null && held !== '') {
    return { held: true, passphrase: held, minted: false }
  }

  const minted = toHex(random(BYTES))
  try {
    await secrets.write(minted)
  } catch (cause: unknown) {
    return {
      held: false,
      reason: `a passphrase was minted and could not be kept: ${getErrorMessage(cause)}`,
    }
  }

  return { held: true, passphrase: minted, minted: true }
}
