// The second module that names `@react-native-documents/picker`, and the
// only one that names its save half. Thin for the reason `documentFile.ts`
// and `imageLibrary.ts` are: native modules, nothing here worth a unit test,
// and what it adapts to -- `DocumentPicker` and `KeepingDocument` -- is
// driven by functions in the tests.
import {
  pick,
  saveDocuments,
  errorCodes,
  isErrorWithCode,
} from '@react-native-documents/picker'
import {
  readFile,
  writeFile,
  unlink,
  TemporaryDirectoryPath,
} from '@dr.pogodin/react-native-fs'

import type { DocumentChoice } from './pickDocument'
import { refuseDocument } from './pickDocument'
import type { KeepingDocument } from './keepDocument'

/** What a file is when nothing says otherwise. */
const ASSUMED_TYPE = 'application/octet-stream'

/**
 * Choosing any file, and reading its bytes.
 *
 * # `mode: 'open'` rather than `'import'`
 *
 * `'import'` copies the file into this application's own storage before
 * handing it over, and that copy is a file this application caused to exist:
 * ADR-0006's clarification of 10 September 2026 says plainly that such a
 * directory « is this application's disk ». `'open'` reads where the file
 * already is, and the plaintext goes from there into the bridge without a
 * copy of its own.
 *
 * # Refused on the stated size, before a byte is read
 *
 * `refuseDocument` answers from what the picker says about the file, which
 * is the point of taking a stated size rather than bytes: a file too large
 * to seal is refused without ever being held.
 */
export async function pickAnyDocument(): Promise<DocumentChoice> {
  try {
    const [chosen] = await pick({ mode: 'open' })
    if (chosen === undefined) return { chose: false, because: null }

    const stated = {
      name: chosen.name ?? '',
      mimeType: chosen.type ?? ASSUMED_TYPE,
      size: chosen.size ?? null,
    }
    const refusal = refuseDocument(stated)
    if (refusal !== null) return { chose: false, because: refusal }

    const base64 = await readFile(chosen.uri, 'base64')
    return {
      chose: true,
      document: {
        bytes: bytesOf(base64),
        mimeType: stated.mimeType,
        name: stated.name,
      },
    }
  } catch (cause: unknown) {
    // Somebody who opens the picker and changes their mind has done a normal
    // thing, and the screen must not show them a failure for it.
    if (
      isErrorWithCode(cause) &&
      cause.code === errorCodes.OPERATION_CANCELED
    ) {
      return { chose: false, because: null }
    }
    return { chose: false, because: 'unreadable' }
  }
}

/**
 * What `keepDocument` needs from the platform.
 *
 * `saveDocuments` is the system's own « save as »: the person chooses the
 * destination, so nothing lands anywhere they did not pick. What this module
 * provides is the temporary file it copies FROM, and the `unlink` that
 * removes it -- `keepDocument.ts` owns the order and the `finally`.
 */
export function documentPlatform(): KeepingDocument {
  return {
    temporary: TemporaryDirectoryPath,
    write: async (path, base64) => {
      await writeFile(path, base64, 'base64')
    },
    save: async (path, name) => {
      try {
        await saveDocuments({
          sourceUris: [`file://${path}`],
          copy: true,
          fileName: name,
        })
        return 'saved'
      } catch (cause: unknown) {
        // Refermer la fenêtre est un geste ordinaire, et la bibliothèque le
        // signale par un code plutôt que par un message. Tout le reste
        // remonte comme une vraie panne.
        if (
          isErrorWithCode(cause) &&
          cause.code === errorCodes.OPERATION_CANCELED
        ) {
          return 'cancelled'
        }
        throw cause
      }
    },
    forget: async path => {
      await unlink(path)
    },
    // The temporary file's name has to differ per call: two saves in the same
    // second would otherwise write the same path, and the first `unlink`
    // would take the second one's bytes.
    name: () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
  }
}

/**
 * Base64 to bytes, written out for the reason `imageLibrary.ts` writes it
 * out: React Native has `atob` and no `Buffer`, and a one-line dependency
 * for this would be a dependency for this.
 */
function bytesOf(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let at = 0; at < binary.length; at += 1) {
    bytes[at] = binary.charCodeAt(at)
  }
  return bytes
}
