import { describeFile, type PickedDocument } from '../timeline/fileEvent'
import type { Uploaded } from '../timeline/encryptedFile'
import { LARGEST_DOCUMENT_BYTES } from './pickDocument'
import { getErrorMessage } from './errors'
import type { SealedFile } from './sendImage'

/**
 * Sending a document: seal, upload, share the key, encrypt, send.
 *
 * # The same five steps as a photograph, and deliberately not the same module
 *
 * `sendImage.ts` carries a thumbnail through every one of them: it seals two
 * files, uploads two, and describes an event whose `info` holds a second
 * `info` inside it. A document has none of that, and the version of
 * `sendImage` that handled both would be a function with a branch in each
 * step and an argument nobody could follow.
 *
 * What IS shared is the part where a mistake is silent, and it is shared as
 * code rather than as a resemblance: `encryptedFile.ts` builds the object
 * that says where the ciphertext went.
 *
 * # The limit is checked twice, and the second time is not a duplicate
 *
 * `refuseDocument` runs in the picker on the size the picker STATED, which is
 * what keeps a huge file from ever being read. This checks the bytes that
 * actually arrived, because a stated size can be absent on Android and
 * because nothing guarantees the two agree.
 */

export interface SendingFileDeps {
  /** `encryptAttachment`, behind a port so this is testable without a device. */
  readonly seal: (plaintext: Uint8Array) => Promise<SealedFile>
  /** Puts the ciphertext in the media repository and answers its `mxc://`. */
  readonly upload: (ciphertext: Uint8Array) => Promise<string>
  /**
   * Gives every device in the room the group key, and drains what that
   * queues. See `sendImage.ts` for what skipping it cost.
   */
  readonly shareTheKey: (scope: string) => Promise<void>
  readonly machine: {
    readonly encryptEvent: (
      scope: string,
      eventType: string,
      payload: Record<string, unknown>,
    ) => Promise<{ ciphertext: Uint8Array }>
  }
  /** Puts the encrypted event in the conversation and answers its event id. */
  readonly send: (scope: string, wire: string) => Promise<string>
}

export type FileSent =
  | { readonly sent: true; readonly eventId: string }
  | { readonly sent: false; readonly reason: string }

export async function sendFile(
  deps: SendingFileDeps,
  scope: string,
  document: PickedDocument,
): Promise<FileSent> {
  if (document.bytes.length === 0) return { sent: false, reason: 'unreadable' }
  if (document.bytes.length > LARGEST_DOCUMENT_BYTES) {
    return { sent: false, reason: 'too-large' }
  }
  if (document.name === '') return { sent: false, reason: 'unnamed' }

  // NAMED STEPS, for the reason `sendImage.ts` sets out: a failure on a
  // device leaves one line, and that line has to say which of the four
  // operations threw.
  try {
    const uploaded = await sealAndUpload(deps, document.bytes)
    const content = describeFile(document, uploaded)

    await whileDoing('sharing the room key', () => deps.shareTheKey(scope))

    // `m.room.message` inside the ciphertext: `m.file` is a message's
    // `msgtype`, not an event type. The outer type on the wire is
    // `m.room.encrypted`, as for everything else.
    const envelope = await whileDoing('encrypting the event', () =>
      deps.machine.encryptEvent(
        scope,
        'm.room.message',
        content as unknown as Record<string, unknown>,
      ),
    )
    const eventId = await whileDoing('sending the event', () =>
      deps.send(scope, new TextDecoder().decode(envelope.ciphertext)),
    )
    return { sent: true, eventId }
  } catch (cause: unknown) {
    return { sent: false, reason: getErrorMessage(cause) }
  }
}

async function sealAndUpload(
  deps: SendingFileDeps,
  bytes: Uint8Array,
): Promise<Uploaded> {
  const sealed = await whileDoing('sealing the document', () =>
    deps.seal(bytes),
  )
  const url = await whileDoing('uploading the document', () =>
    deps.upload(sealed.ciphertext),
  )
  return { url, secret: sealed.secret }
}

/** Runs one step and, if it throws, says which step that was. */
async function whileDoing<T>(step: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (cause: unknown) {
    throw new Error(`${step}: ${getErrorMessage(cause)}`)
  }
}
