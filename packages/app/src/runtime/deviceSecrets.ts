// The one module that names react-native-keychain, kept thin for the same
// reason `cryptoPump.ts` is: it is a native module, so nothing worth testing
// lives here. What it adapts to is `sessionStore.ts`'s `SecretStore`, which
// the tests drive with an ordinary object.
import * as Keychain from 'react-native-keychain'

import type { SecretStore } from './sessionStore'

/**
 * A named entry in the operating system's own keystore.
 *
 * `service` is the key, and the library's own vocabulary: on Android it names
 * an entry in the Android Keystore, on iOS a keychain item. The value is
 * stored under a fixed username because there is exactly one of each per
 * device — this is not a credential the person chose, it is one the account
 * came with.
 */
function keychainStore(service: string): SecretStore {
  return {
    read: async () => {
      const held = await Keychain.getGenericPassword({ service })
      return held === false ? null : held.password
    },
    write: async value => {
      await Keychain.setGenericPassword('messagr', value, { service })
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
