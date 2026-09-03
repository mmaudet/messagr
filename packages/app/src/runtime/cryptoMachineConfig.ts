/**
 * `createCryptoMachine`'s config, derived from the restored session and a
 * directory the host handed to JavaScript at launch.
 *
 * `storePath` is required, not optional, on the library's own type: a crypto
 * library that chose its own on-disk location would write somewhere the
 * product did not agree to, so it chooses none, and React Native itself
 * exposes no path API to fill the gap. Following
 * `linagora/react-native-matrix-crypto`'s own example app exactly: the host's
 * private files directory travels in as an initial prop (see App.tsx,
 * MainActivity.kt) rather than through a dependency this workspace does not
 * otherwise need.
 */
import type { DeviceIdentity } from './deviceIdentity'

export interface CryptoMachineConfig {
  readonly userId: string
  readonly deviceId: string
  readonly storePath: string
  readonly storePassphrase: string | null
}

// Not a secret, and not to be read as an example of choosing one: this
// screen has no user, no keychain and no secret of its own to protect, the
// same reasoning the library's own example app states for its literal demo
// passphrase. A real passphrase policy is product work, and belongs to
// whichever ticket first gives this screen a person to protect.
const SCAFFOLD_PASSPHRASE = 'messagr-scaffold-crypto-store'

/**
 * `null` when the host supplied no writable directory: reported as a defect
 * rather than a store silently opened somewhere nobody agreed to.
 *
 * Keyed by device id rather than by launch time: unlike the library's own
 * example app, this device id is not regenerated on every run — it is the
 * one #10's provisioning minted and #11 restored a session for — so the
 * store this config names is the one that device's identity actually
 * belongs to, and reusing the path across a relaunch of the same device is
 * correct rather than accidental.
 */
export function computeCryptoMachineConfig(
  session: DeviceIdentity,
  storeDir: string,
): CryptoMachineConfig | null {
  if (storeDir === '') {
    return null
  }
  return {
    userId: session.userId,
    deviceId: session.deviceId,
    storePath: `${storeDir}/crypto/${session.deviceId}`,
    storePassphrase: SCAFFOLD_PASSPHRASE,
  }
}
