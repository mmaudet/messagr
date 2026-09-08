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

/**
 * The pushkey this device last registered a pusher under.
 *
 * WITHOUT IT, A GHOST IS PUSHED TO FOR EVER. A pusher is keyed by its token,
 * and nothing in the Matrix data model says which device a pusher belongs
 * to -- so when a device's token changes, its old pusher stays on the
 * account and every message costs a failed push to a token nobody holds.
 *
 * Measured on the tester's telephone: sixteen `BadDeviceToken` in two hours,
 * all for one token minted by a build whose entitlement was still
 * `development`, months after that build was replaced.
 *
 * This device writing down its own key is the only thing that can say "that
 * one was mine, and it is not any more". A `SecretStore` because it is the
 * only durable per-device store this application has, not because a pushkey
 * is a secret -- it is on the homeserver already.
 */
export const pushkeySecrets = keychainStore('eu.messagr.pushkey')

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

/**
 * Where the note saying this device has been shown the promise lives. See
 * promiseSeen.ts: not a secret, and here only because `SecretStore` is the
 * one durable per-device store this application has today.
 */
export const promiseSecrets = keychainStore('eu.messagr.promise')

/**
 * The language this device speaks. Not a secret, and kept here for the
 * reason `promiseSeen.ts` gives about its own flag: this is the only durable
 * per-device store that exists before the notebook opens, and the language
 * has to be known before anything else is -- it is what the first screen is
 * written in.
 */
export const languageSecrets = keychainStore('eu.messagr.language')

/**
 * Where the given-names notebook's passphrase lives. See ADR-0010: its own
 * entry rather than the crypto store's, because one secret for two stores
 * means compromising either gives both.
 */
export const givenNamesSecrets = keychainStore('eu.messagr.given-names')

/**
 * Where the read-receipt choice lives. See receiptSetting.ts: not a secret,
 * and off unless somebody turned it on.
 */
export const receiptSecrets = keychainStore('eu.messagr.read-receipts')

/** Whether this device asks to be woken when a message arrives. */
export const wakeSecrets = keychainStore('eu.messagr.wake')

/**
 * Which published conditions were accepted, by the date they carry. A version
 * rather than a flag, so a revision can re-ask -- see `termsAccepted.ts`.
 */
export const termsSecrets = keychainStore('eu.messagr.terms')

/**
 * Where this installation keeps its stores. Not a secret, and here because a
 * headless wake is handed no initial properties and has nowhere else to
 * learn it -- see `storeDirectory.ts`.
 */
export const storeDirectorySecrets = keychainStore('eu.messagr.store-dir')
