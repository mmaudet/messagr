// The one module that names react-native-keychain, kept thin for the same
// reason `cryptoPump.ts` is: it is a native module, so nothing worth testing
// lives here. What it adapts to is `sessionStore.ts`'s `SecretStore`, which
// the tests drive with an ordinary object.
import * as Keychain from 'react-native-keychain'

import { CURRENT_FORM } from './keystoreForm'
import type { SecretStore } from './sessionStore'

/**
 * Whose an entry is. The account's goes when this device leaves its account;
 * the device's stays. See `forgetAccountSecrets` at the end of this file.
 */
type Whose = 'account' | 'device'

/**
 * Every entry, with its service and whose it is, in the order declared: the
 * session first. Keyed by the store itself, so leaving can name the entries it
 * spares with the very objects it was handed.
 */
const entries = new Map<
  SecretStore,
  { readonly service: string; readonly whose: Whose }
>()

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
 *
 * WHOSE IT IS, SAID WHERE IT IS DECLARED (#304). Leaving an account for an
 * invitation into another server forgets what this device keeps of that
 * account and keeps what belongs to the device itself. The second argument is
 * that answer, so no entry can be declared without giving it, and each entry's
 * own note says why it is the answer.
 */
function keychainStore(service: string, whose: Whose): SecretStore {
  const store: SecretStore = {
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
  entries.set(store, { service, whose })
  return store
}

/**
 * Where the restored session lives between launches.
 *
 * The account's, and the first thing leaving it forgets: a device interrupted
 * straight afterwards holds no account to come back to, rather than half of
 * one.
 */
export const sessionSecrets = keychainStore('eu.messagr.session', 'account')

/**
 * Where the sign-up marker lives. See signUpMarker.ts: it is the entitlement
 * to make the one destructive call on the crypto library's surface, so it
 * belongs beside the other secrets rather than in ordinary storage anything
 * could write.
 *
 * The account's. It entitles a launch to create that account's identity, and
 * a marker left behind would hand the entitlement to whichever account came
 * next.
 */
export const signUpSecrets = keychainStore('eu.messagr.sign-up', 'account')

/**
 * The password this account was created with, kept so a reinstalled device
 * can come back as a NEW device rather than republishing keys under a dead
 * identifier (#190).
 *
 * Its own entry rather than a field of the session, for the reason
 * `recoverySecret.ts` gives at length: the session is what restores, this is
 * what replaces, and `RestoreCredentials` must not carry a credential the
 * SDK is never meant to see.
 *
 * It is the heaviest thing this application keeps. A password makes devices
 * at will and cannot be revoked device by device, so whoever defeats the
 * keystore gets the account rather than a session. Weighed and accepted on
 * 10 September 2026 against somebody being locked out by a reinstall they
 * did nothing wrong to cause.
 *
 * The account's, and the entry that most has to go: left behind, it would be
 * an account nobody on this device can see and anybody who defeats the
 * keystore can use.
 */
export const recoverySecrets = keychainStore('eu.messagr.recovery', 'account')

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
 *
 * The account's. It names a pusher on that account's server, which leaving
 * reads it to take away, and afterwards it would describe a pusher this device
 * has nothing more to do with.
 */
export const pushkeySecrets = keychainStore('eu.messagr.pushkey', 'account')

/**
 * What this device needs in order to keep writing to its key backup: the
 * sealing key and the version, as one value. See backupCommitment.ts.
 *
 * Its own entry rather than a field of the session, for `recoverySecrets`'
 * reason one level along: the session is what restores this account, and a
 * value rewritten whenever a backup version changes has no business sharing
 * an entry with the credential whose loss is the loss of the account.
 *
 * **The restore key is not here, and is nowhere.** ADR-0013 keeps only the
 * public half on the device — it encrypts and cannot decrypt, so whoever
 * defeats this keystore gets the ability to add to a backup they still
 * cannot read. The secret is shown once and leaves.
 *
 * The account's: the key and the version belong to that account's backup, on
 * that account's server.
 */
export const backupSecrets = keychainStore('eu.messagr.backup', 'account')

/**
 * Whether this device has ever put the backup question. See backupPrompt.ts:
 * a refusal is recorded for good, so this is what stops the product asking
 * twice.
 *
 * Its own entry rather than a field beside the commitment, because the two
 * are written at unrelated moments by unrelated code and either can be true
 * without the other: sharing one would let a message arriving rewrite the
 * record of what somebody answered.
 *
 * The account's, although it reads like a preference. What was answered was
 * whether to back up that account's keys. The next account's keys have not
 * been asked about, and keeping the answer would silence the one offer that
 * protects them.
 */
export const backupAskedSecrets = keychainStore(
  'eu.messagr.backup-asked',
  'account',
)

/**
 * Whether a message from somebody else has ever arrived on this device.
 *
 * Received, not sent, and `offerBackup.ts` carries the reason: sending
 * proves the account works, receiving is the first time this device holds a
 * key nobody else has. Not a secret; here because `SecretStore` is the only
 * durable per-device store this application has.
 *
 * The account's: what arrived, arrived for that account. Kept, it would offer
 * a backup to an account that has not yet received anything to lose.
 */
export const backupReceivedSecrets = keychainStore(
  'eu.messagr.backup-received',
  'account',
)

/**
 * Whether this device has already offered to bring a past back.
 *
 * Its own entry, and not the backup's: the two questions are asked of
 * different devices in opposite situations. `backup-asked` is a device that
 * has keys and is offered somewhere to put them; this is a device that has
 * lost them and is offered a way to get them back. Somebody who refused the
 * first has not answered the second, and a device that reinstalled has
 * neither flag — sharing one entry would make a refusal on a telephone that
 * no longer exists silence the offer that matters most.
 *
 * The account's, for `backup-asked`'s reason: it answered a question about
 * that account's past.
 */
export const restoreAskedSecrets = keychainStore(
  'eu.messagr.restore-asked',
  'account',
)

/**
 * Where the crypto store's passphrase lives. See cryptoMachineConfig.ts.
 *
 * The account's: it opens that account's store, which leaving erases. The
 * next store is given a passphrase of its own, which is what
 * `storePassphrase.ts` asks of every store.
 */
export const cryptoStoreSecrets = keychainStore(
  'eu.messagr.crypto-store',
  'account',
)

/**
 * Where the live sync loop's cursor lives between launches. See
 * syncCursor.ts: not a secret, but `SecretStore` is the only durable
 * per-device store this application has, and its own entry rather than a
 * field beside the session so that a value rewritten every thirty seconds
 * cannot corrupt the credential whose loss is the loss of the account.
 *
 * The account's: a position in that account's sync, on that server. Handed to
 * another account, it would start the first sync from somewhere that account
 * has never been.
 */
export const syncCursorSecrets = keychainStore(
  'eu.messagr.sync-cursor',
  'account',
)

/**
 * Where the note saying the passphrase has moved to the current accessibility
 * lives. See keystoreForm.ts: a keystore cannot be asked what form an entry
 * is in, so the answer is kept beside it.
 *
 * Its own entry rather than a field inside the passphrase, because the one
 * value this application must never corrupt is not the place to keep
 * bookkeeping.
 *
 * The account's, with the passphrase it describes: a marker kept for an entry
 * that is gone would be true of nothing.
 */
export const cryptoStoreFormMarker = keychainStore(
  'eu.messagr.crypto-store-form',
  'account',
)

/**
 * Where the note saying this device has been shown the promise lives. See
 * promiseSeen.ts: not a secret, and here only because `SecretStore` is the
 * one durable per-device store this application has today.
 *
 * The device's. Whoever holds this telephone has read the promise, and leaving
 * an account does not unread it.
 */
export const promiseSecrets = keychainStore('eu.messagr.promise', 'device')

/**
 * The language this device speaks. Not a secret, and kept here for the
 * reason `promiseSeen.ts` gives about its own flag: this is the only durable
 * per-device store that exists before the notebook opens, and the language
 * has to be known before anything else is -- it is what the first screen is
 * written in.
 *
 * The device's: the person who reads this screen reads the next one too,
 * whichever account the next one belongs to.
 */
export const languageSecrets = keychainStore('eu.messagr.language', 'device')

/**
 * Where the given-names notebook's passphrase lives. See ADR-0010: its own
 * entry rather than the crypto store's, because one secret for two stores
 * means compromising either gives both.
 *
 * The account's: it opens the notebook, which holds that account's names, its
 * reading and its conversation list, and which leaving erases.
 */
export const givenNamesSecrets = keychainStore(
  'eu.messagr.given-names',
  'account',
)

/**
 * Where the read-receipt choice lives. See receiptSetting.ts: not a secret,
 * and off unless somebody turned it on.
 *
 * The device's: a choice about how this telephone behaves, made by whoever
 * holds it, and nothing in it names an account.
 */
export const receiptSecrets = keychainStore(
  'eu.messagr.read-receipts',
  'device',
)

/**
 * Whether this device asks to be woken when a message arrives.
 *
 * The device's, for the reason the receipts give: whether this telephone asks
 * to be woken is not a fact about an account.
 */
export const wakeSecrets = keychainStore('eu.messagr.wake', 'device')

/**
 * Whether every photograph drawn goes into the photothèque. #208, and off
 * unless somebody turned it on: see `keepEverySetting.ts`, and ADR-0006's
 * amendment of 12 September 2026 for why the default is the decision.
 *
 * The device's: it is about this telephone's photothèque, which stays.
 */
export const keepEverySecrets = keychainStore('eu.messagr.keep-every', 'device')

/**
 * Which published conditions were accepted, by the date they carry. A version
 * rather than a flag, so a revision can re-ask -- see `termsAccepted.ts`.
 *
 * The device's: they were accepted on this telephone before any account
 * existed, since the promise comes before the first link.
 */
export const termsSecrets = keychainStore('eu.messagr.terms', 'device')

/**
 * Where this installation keeps its stores. Not a secret, and here because a
 * headless wake is handed no initial properties and has nowhere else to
 * learn it -- see `storeDirectory.ts`.
 *
 * The device's: where this installation writes, whoever it writes for.
 */
export const storeDirectorySecrets = keychainStore(
  'eu.messagr.store-dir',
  'device',
)

/**
 * Erases every entry declared the account's except those in `keeping`, and
 * none of the device's. #304: what leaving an account takes from the keystore.
 *
 * `keeping` is what the next account has already written -- its session, its
 * sign-up marker and its password -- which belong to it by then, and not to
 * the account being left. `entry.ts` says why they are written before this
 * runs.
 */
export async function forgetAccountSecrets(
  keeping: readonly SecretStore[],
): Promise<{ readonly forgotten: number; readonly refused: number }> {
  const theAccounts = [...entries]
    .filter(([, entry]) => entry.whose === 'account')
    .map(([store]) => store)
    .filter(store => !keeping.includes(store))
  return forgetSecrets(theAccounts)
}

/**
 * Erases the entries named, which must be entries this module declared.
 *
 * Every entry is attempted whatever the one before answered, and one the
 * keystore would not erase -- or one this module never declared -- is counted
 * rather than retried.
 */
export async function forgetSecrets(
  stores: readonly SecretStore[],
): Promise<{ readonly forgotten: number; readonly refused: number }> {
  let forgotten = 0
  let refused = 0
  for (const store of stores) {
    const entry = entries.get(store)
    try {
      if (entry === undefined) throw new Error('not an entry of this keystore')
      await Keychain.resetGenericPassword({ service: entry.service })
      forgotten += 1
    } catch {
      refused += 1
    }
  }
  return { forgotten, refused }
}
