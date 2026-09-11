// The one module that names `@react-native-documents/picker`, kept thin for
// the reason `imageLibrary.ts` is: it is a native module, so nothing worth
// unit-testing lives here. What it adapts to is `openVault.ts`'s `Opening`,
// which the tests drive with functions.
import {
  pick,
  errorCodes,
  isErrorWithCode,
} from '@react-native-documents/picker'
import { readFile } from '@dr.pogodin/react-native-fs'

/**
 * Choosing a file and reading it as text.
 *
 * # WHY A PICKER AND NOT « OUVRIR AVEC MESSAGR »
 *
 * The first plan was to declare that this application can open a text file,
 * so somebody would share the vault to it from their file manager. Zero new
 * dependency, and the link machinery already exists for invitations.
 *
 * It was abandoned on one fact: **Android cannot filter a `content://` URI
 * on its extension.** An intent filter is declared on a MIME type, a vault
 * is `text/plain`, and Messagr would therefore have offered itself for every
 * text file on the telephone — every log, every note, every export from
 * anything else. Not dangerous, and exactly the kind of noise a product that
 * asks for nothing should not make.
 *
 * A picker claims nothing from the system and opens where it is told. It is
 * also what #111 will need to attach a document to a message, so the
 * dependency is spent once and used twice.
 *
 * # THE CANCEL IS NOT AN ERROR
 *
 * Somebody who opens the picker and changes their mind has done a normal
 * thing, and the screen must not show them a failure for it. The library
 * signals it with a code rather than a message, which is the one part of its
 * surface worth naming here.
 */
export type PickedText =
  | { readonly picked: true; readonly text: string }
  /** The picker was dismissed. Nothing to report and nothing to do. */
  | { readonly picked: false; readonly cancelled: true }
  | {
      readonly picked: false
      readonly cancelled: false
      readonly reason: string
    }

export async function pickTextFile(): Promise<PickedText> {
  try {
    const [chosen] = await pick({ mode: 'open', type: ['text/plain'] })
    if (chosen === undefined) {
      return { picked: false, cancelled: true }
    }
    const text = await readFile(chosen.uri, 'utf8')
    return { picked: true, text }
  } catch (cause: unknown) {
    if (
      isErrorWithCode(cause) &&
      cause.code === errorCodes.OPERATION_CANCELED
    ) {
      return { picked: false, cancelled: true }
    }
    return {
      picked: false,
      cancelled: false,
      reason: cause instanceof Error ? cause.message : String(cause),
    }
  }
}
