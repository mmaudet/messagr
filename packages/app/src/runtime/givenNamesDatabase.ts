// The one module that names @op-engineering/op-sqlite, kept thin for the
// reason `deviceSecrets.ts` and `cryptoPump.ts` are: it is a native module, so
// nothing worth unit-testing lives here. What it adapts to is
// `givenNameStore.ts`'s `EncryptedDatabase`, which the tests drive with an
// ordinary object.
import { open } from '@op-engineering/op-sqlite'

import { givenNamesSecrets } from './deviceSecrets'
import { getErrorMessage } from './errors'
import type { GivenNames } from './givenName'
import { forgetfulGivenNames, openGivenNames } from './givenNameStore'
import { openStorePassphrase } from './storePassphrase'

/** What became of the notebook on this launch. Reported, not assumed. */
export interface GivenNamesOpening {
  readonly names: GivenNames
  readonly opened: boolean
  /** Why it did not open, when it did not. */
  readonly reason?: string
  /** Whether this launch minted the passphrase or reopened with the old one. */
  readonly minted?: boolean
}

/**
 * Opens the application's own encrypted notebook. ADR-0010.
 *
 * # A second passphrase, deliberately
 *
 * Not the crypto store's. One secret for two stores means compromising either
 * gives both, which trades a real property for the convenience of one fewer
 * keystore entry. It is minted the same way and kept the same way — including
 * the accessibility ADR-0008 settled, since `deviceSecrets.ts` writes every
 * entry with it.
 *
 * # Beside the crypto store, and that is not sharing
 *
 * The file sits in the same directory the host hands the application at
 * launch, because that is the one directory this process is promised it may
 * write to. Two files, two passphrases, one directory: what ADR-0010 refuses
 * is a shared *database*, not a shared parent folder.
 *
 * # It degrades rather than failing
 *
 * A launch that cannot open the notebook still has conversations to show, as
 * identifiers rather than names — which is what an unnamed conversation looks
 * like anyway. Refusing to show a list would trade a degraded screen for no
 * screen. What it must not do is pretend: `forgetfulGivenNames` answers
 * `false` to every write, so the naming gesture says at the time that it did
 * not hold.
 */
export async function openGivenNamesDatabase(
  storeDir: string,
): Promise<GivenNamesOpening> {
  if (storeDir === '') {
    return {
      names: forgetfulGivenNames(),
      opened: false,
      reason: 'no writable directory was supplied at launch',
    }
  }

  const passphrase = await openStorePassphrase(givenNamesSecrets, byteLength =>
    crypto.getRandomValues(new Uint8Array(byteLength)),
  )
  if (!passphrase.held) {
    return {
      names: forgetfulGivenNames(),
      opened: false,
      reason: passphrase.reason,
    }
  }

  try {
    const database = open({
      name: 'given-names.sqlite',
      location: storeDir,
      encryptionKey: passphrase.passphrase,
    })
    return {
      names: await openGivenNames({
        execute: async (sql, params) =>
          database.execute(sql, params === undefined ? undefined : [...params]),
      }),
      opened: true,
      minted: passphrase.minted,
    }
  } catch (cause: unknown) {
    // The likeliest cause by far is a passphrase that does not open the file
    // that is there — which is not recoverable by retrying and must not be
    // "fixed" by deleting the database. Somebody's notebook is in it.
    return {
      names: forgetfulGivenNames(),
      opened: false,
      reason: getErrorMessage(cause),
      minted: passphrase.minted,
    }
  }
}
