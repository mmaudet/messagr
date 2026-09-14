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

/**
 * `null` when the host supplied no writable directory, or when the device id
 * names no store: reported as a defect rather than a store silently opened
 * somewhere nobody agreed to.
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
  storePassphrase: string,
): CryptoMachineConfig | null {
  const storePath = cryptoStorePath(storeDir, session.deviceId)
  if (storePath === null) {
    return null
  }
  return {
    userId: session.userId,
    deviceId: session.deviceId,
    storePath,
    // Handed in rather than chosen here: it is per-device, random, and kept
    // in the operating system's keystore. See storePassphrase.ts for why a
    // second one is not a second chance.
    storePassphrase,
  }
}

/**
 * Where a device's crypto store lives: `<storeDir>/crypto/<deviceId>`.
 *
 * # ONE FUNCTION FOR ITS THREE READERS
 *
 * The configuration above, the question a launch asks about a reinstall
 * (`homeserverCalls.ts`) and the erasure leaving an account makes
 * (`leavingThisDevice.ts`) all name this directory. They spelled it each for
 * themselves until #304 made the third one a deletion, and a path spelled
 * three times is a path that can differ once.
 *
 * # A DEVICE ID THAT WOULD LEAVE `crypto/` NAMES NO STORE
 *
 * The device id is whatever a homeserver sent. Empty, `.` or `..`, or carrying
 * a separator or a control character, it could name `crypto/` itself, the
 * notebook beside it or anything above -- so it names nothing, and `null` is an
 * answer every caller already has for a store that is not there.
 */
export function cryptoStorePath(
  storeDir: string,
  deviceId: string,
): string | null {
  if (storeDir === '') return null
  if (deviceId === '' || deviceId === '.' || deviceId === '..') return null
  if ([...deviceId].some(isSeparatorOrControl)) return null
  return `${storeDir}/crypto/${deviceId}`
}

/** A character that could end a path segment, or cut a path short in native code. */
function isSeparatorOrControl(character: string): boolean {
  const code = character.charCodeAt(0)
  return character === '/' || character === '\\' || code < 0x20 || code === 0x7f
}
