// The one module that names the file system and the share sheet for the key
// vault, kept thin for the reason `imageLibrary.ts` and `notebook.ts` are:
// these are native modules, so nothing worth unit-testing lives here. The
// sequence, its ordering and its `finally` are in `shareKeyVault.ts`, driven
// by functions a test supplies.
import { Share } from 'react-native'
import {
  TemporaryDirectoryPath,
  unlink,
  writeFile,
} from '@dr.pogodin/react-native-fs'

import type { Vaulting } from './shareKeyVault'

/**
 * The file name a vault leaves under.
 *
 * Dated rather than random, because this one is READ BY A PERSON: it lands
 * in whatever they shared it to, beside whatever else is there, and
 * `messagr-cles-2026-09-11.txt` is findable a year later where
 * `vault-8f2a1c.txt` is not. The temporary path it passes through is never
 * seen — see `shareKeyVault.ts`, which unlinks it whatever happens.
 *
 * `-cles-` and not `-keys-`: the file is named in the language of whoever
 * made it in every other product, and this one has seven of them. Naming it
 * in French is a placeholder, not a decision, and it is written here so the
 * next person sees it is one.
 */
function vaultName(now: Date): string {
  const day = now.toISOString().slice(0, 10)
  return `messagr-cles-${day}`
}

/**
 * What `shareKeyVault` needs from the platform.
 *
 * `create` is not here: it is the bridge's, and a caller that wants the
 * whole gesture binds it in `cryptoPump.ts` where the bridge is already
 * imported. This module knows about files and sheets and nothing else.
 */
export function vaultPlatform(
  create: (passphrase: string) => Promise<string>,
  now: () => Date = () => new Date(),
): Vaulting {
  return {
    create,
    temporary: TemporaryDirectoryPath,
    write: async (path, text) => {
      await writeFile(path, text, 'utf8')
    },
    share: async path => {
      // `url` and not `message`: a vault is megabytes of armour, and a share
      // sheet handed that as a message would put it in a text field. The
      // `file://` prefix is what both platforms expect for a path.
      await Share.share({ url: `file://${path}` })
    },
    forget: async path => {
      await unlink(path)
    },
    name: () => vaultName(now()),
  }
}
