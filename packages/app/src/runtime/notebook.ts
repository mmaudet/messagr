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
import { forgetfulLastRead, openLastRead, type LastRead } from './lastReadStore'
import {
  forgetfulOutstanding,
  openOutstanding,
  type Outstanding,
} from './outstandingStore'
import { forgetfulCallLog, openCallLog, type CallLog } from './callLogStore'
import { openStorePassphrase } from './storePassphrase'

/** What became of the notebook on this launch. Reported, not assumed. */
export interface NotebookOpening {
  readonly names: GivenNames
  /** How far each conversation has been read here. */
  readonly lastRead: LastRead
  /** Invitations issued here that nobody has been let in through yet. */
  readonly outstanding: Outstanding
  /** Every call, which is the most revealing page of the four. */
  readonly calls: CallLog
  readonly opened: boolean
  /** Why it did not open, when it did not. */
  readonly reason?: string
  /** Whether this launch minted the passphrase or reopened with the old one. */
  readonly minted?: boolean
}

/**
 * Opens the application's own encrypted notebook. ADR-0010.
 *
 * # Four pages, one file
 *
 * Who you call what (`given_names`), how far you have read (`last_read`),
 * and who you have invited and not yet let in
 * (`outstanding_invitations`). They are the same kind of fact -- a record of
 * your relationships that is as revealing as the messages themselves -- so
 * they share one encrypted file and one passphrase rather than multiplying
 * either.
 *
 * The third arrived with #118: admission used to be a poll that ran for one
 * minute after a link was issued and then stopped, which made an invitation
 * usable only if it was opened inside that minute. Asking again on the next
 * launch needs the question to survive the launch, and this is where it
 * survives.
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
export async function openNotebook(storeDir: string): Promise<NotebookOpening> {
  if (storeDir === '') {
    return {
      names: forgetfulGivenNames(),
      lastRead: forgetfulLastRead(),
      outstanding: forgetfulOutstanding(),
      calls: forgetfulCallLog(),
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
      lastRead: forgetfulLastRead(),
      outstanding: forgetfulOutstanding(),
      calls: forgetfulCallLog(),
      opened: false,
      reason: passphrase.reason,
    }
  }

  try {
    const database = open({
      // The file keeps its first page's name. Renaming it would leave every
      // device that has one holding a notebook nothing opens any more, which
      // is a data migration wearing a tidy-up's clothes.
      name: 'given-names.sqlite',
      location: storeDir,
      encryptionKey: passphrase.passphrase,
    })
    const page = {
      execute: async (sql: string, params?: readonly (string | number)[]) =>
        database.execute(sql, params === undefined ? undefined : [...params]),
    }
    return {
      names: await openGivenNames(page),
      lastRead: await openLastRead(page),
      outstanding: await openOutstanding(page),
      calls: await openCallLog(page),
      opened: true,
      minted: passphrase.minted,
    }
  } catch (cause: unknown) {
    // The likeliest cause by far is a passphrase that does not open the file
    // that is there — which is not recoverable by retrying and must not be
    // "fixed" by deleting the database. Somebody's notebook is in it.
    return {
      names: forgetfulGivenNames(),
      lastRead: forgetfulLastRead(),
      outstanding: forgetfulOutstanding(),
      calls: forgetfulCallLog(),
      opened: false,
      reason: getErrorMessage(cause),
      minted: passphrase.minted,
    }
  }
}
