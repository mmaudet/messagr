// The one module that names react-native-keychain, kept thin for the same
// reason `cryptoPump.ts` is: it is a native module, so nothing worth testing
// lives here. What it adapts to is `sessionStore.ts`'s `SecretStore`, which
// the tests drive with an ordinary object.
import * as Keychain from 'react-native-keychain'

import { CURRENT_FORM } from './keystoreForm'
import type { SecretStore } from './sessionStore'

/**
 * A named entry in the operating system's own keystore.
 *
 * `service` is the key, and the library's own vocabulary: on Android it names
 * an entry in the Android Keystore, on iOS a keychain item. The value is
 * stored under a fixed username because there is exactly one of each per
 * device — this is not a credential the person chose, it is one the account
 * came with.
 *
 * EVERY WRITE CARRIES ITS ACCESSIBILITY, and the library's default is not
 * kept as a fallback. ADR-0008: `WhenUnlocked`, which is what a write without
 * the option gets, makes an entry unreadable while the screen is off — and a
 * push that wakes the application to decrypt locally (ADR-0009) arrives
 * exactly then. `AfterFirstUnlockThisDeviceOnly` is readable once the device
 * has been unlocked since it was powered on, and never travels into a backup.
 *
 * The option is iOS-only in `react-native-keychain`: Android's own keystore
 * asks no such question, its keys being usable while the screen is off unless
 * something requires otherwise. Passing it unconditionally is deliberate all
 * the same — a platform test here would be a second place for the two
 * platforms to disagree about what this application intends, and the library
 * ignores an option that does not apply.
 *
 * `CURRENT_FORM` is imported rather than restated, so the value written and
 * the value the marker records cannot drift into two different strings.
 */
function keychainStore(service: string): SecretStore {
  return {
    read: async () => {
      const held = await Keychain.getGenericPassword({ service })
      return held === false ? null : held.password
    },
    write: async value => {
      await Keychain.setGenericPassword('messagr', value, {
        service,
        accessible: CURRENT_FORM as Keychain.ACCESSIBLE,
      })
    },
  }
}

/** Where the restored session lives between launches. */
export const sessionSecrets = keychainStore('eu.messagr.session')

/**
 * Where the sign-up marker lives. See signUpMarker.ts: it is the entitlement
 * to make the one destructive call on the crypto library's surface, so it
 * belongs beside the other secrets rather than in ordinary storage anything
 * could write.
 */
export const signUpSecrets = keychainStore('eu.messagr.sign-up')

/** Where the crypto store's passphrase lives. See cryptoMachineConfig.ts. */
export const cryptoStoreSecrets = keychainStore('eu.messagr.crypto-store')

/**
 * Where the live sync loop's cursor lives between launches. See
 * syncCursor.ts: not a secret, but `SecretStore` is the only durable
 * per-device store this application has, and its own entry rather than a
 * field beside the session so that a value rewritten every thirty seconds
 * cannot corrupt the credential whose loss is the loss of the account.
 */
export const syncCursorSecrets = keychainStore('eu.messagr.sync-cursor')

/**
 * Where the note saying the passphrase has moved to the current accessibility
 * lives. See keystoreForm.ts: a keystore cannot be asked what form an entry
 * is in, so the answer is kept beside it.
 *
 * Its own entry rather than a field inside the passphrase, because the one
 * value this application must never corrupt is not the place to keep
 * bookkeeping.
 */
export const cryptoStoreFormMarker = keychainStore(
  'eu.messagr.crypto-store-form',
)
