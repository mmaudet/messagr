# The store passphrase survives a locked screen

The passphrase that opens the crypto store is kept in the operating system's
keystore with `AfterFirstUnlockThisDeviceOnly` accessibility: readable once the
device has been unlocked at least since it was powered on, including while the
screen is locked, and excluded from backups.

## Why

The application decides that a push notification carries no content and wakes
the application to decrypt locally (ADR-0009). That decision is worth nothing
unless the wake can open the crypto store, and a store is opened with a
passphrase from the keystore.

`react-native-keychain`'s default is `WhenUnlocked`. Under it, a notification
arriving on a locked phone reaches an application that cannot read its own
passphrase, cannot open its own store, and cannot decrypt anything. The
degraded fallback ADR-0009 provides for — a visible notification that says
nothing — would then be the _normal_ case rather than the exception, on every
device whose screen is off, which is most of them most of the time.

`AfterFirstUnlock` is the smallest change that makes background decryption
possible at all. It is not a weakening of encryption: the store stays
encrypted, and the passphrase stays in hardware-backed storage. What changes is
the window in which the operating system will hand it back.

## The cost, stated plainly

**A device stolen while powered on but locked gives up the passphrase.** Under
`WhenUnlocked` it does not: the secret is unreachable until somebody
authenticates. That is a real reduction and it is the whole trade-off. It is
accepted because the alternative is a messenger that cannot tell you a message
arrived, which is the thing a messenger does.

A device stolen while powered _off_ is unaffected: nothing is readable until
the first unlock, which is what the `AfterFirstUnlock` half means.

**`ThisDeviceOnly` settles a question that was open and undecided.** The crypto
store lives in Application Support, which is included in iCloud and iTunes
backups; the passphrase now is not. So a device restored from a backup holds a
store it cannot open. That is not a regression introduced here — it was
already true in every combination where the keychain item did not travel — but
it stops being accidental. A restored device has no history, and the recovery
path for that is ADR-0004's cross-signing and #57's secret storage, not a
backup.

The alternative, letting the passphrase into backups, would put the key to
every conversation a device can read into whatever protects an iCloud account.
That is a worse trade than losing history on restore.

## The migration, and its own trap

Changing the option does not rewrite an entry already stored. Every existing
installation keeps `WhenUnlocked` silently, and would keep failing exactly as
before while the code claimed otherwise. So the passphrase is read and written
back the first time a launch sees the old form.

**That migration can only run in the foreground.** Reading the old value
requires the device unlocked, which is precisely what the old accessibility
means — so a launch woken by a push cannot perform it, and must not try. A
migration attempted on a background wake fails, and a failure there is
indistinguishable from a device that has not been unlocked since boot.

## Consequences

`deviceSecrets.ts` passes an explicit accessibility to
`Keychain.setGenericPassword`, where it passes none today. The default is not
kept as a fallback: a value written without the option is the old form, and
the migration exists to find those.

The given-name store (ADR-0010) has its own keychain entry with the same
accessibility, and not a shared passphrase: one secret protecting two stores
means compromising one gives the other.
