import { describeImage, type Uploaded } from '../timeline/imageEvent'
import { sendEncryptedEvent } from './encryptedSend'
import { getErrorMessage } from './errors'
import { refuseImage, type PickedImage } from './pickImage'
import type { HttpRequester } from './pump'

/**
 * Sending a photograph, which is two encryptions and not one.
 *
 * # The file and the message are encrypted separately, on purpose
 *
 * The bytes are sealed with a key of their own and uploaded to the media
 * repository, which holds them and cannot read them. The **key** travels
 * inside the conversation's own encryption, in the event that points at the
 * upload. So the homeserver holds two things it cannot join: a file it has no
 * key for, and a key it cannot decrypt.
 *
 * That is Matrix's design rather than this application's invention, and it is
 * why the media repository can be a dumb store: it never has to know who may
 * read what.
 *
 * # Nothing touches the disk
 *
 * The picker hands over bytes (`pickImage.ts` says why it is bytes and not a
 * path), they are sealed in memory, and the ciphertext goes straight out.
 * ADR-0006 says nothing decrypted is written to disk; a photograph is the
 * first thing this application handles that a filesystem would have been the
 * obvious place for, and it is the reason the port was shaped that way.
 *
 * # The order is the correctness
 *
 * Seal, upload, then send. Each step needs the one before it, and a failure
 * at any of them leaves nothing behind that a person would have to clean up:
 * a sealed image nobody uploaded is bytes in memory, and an uploaded
 * ciphertext nobody pointed at is a file with no key anywhere, which is
 * indistinguishable from noise.
 *
 * # The thumbnail is sealed with a key of its own, and it goes first
 *
 * `seal` is `encryptAttachment`, which mints a key per call, so sealing twice
 * is two keys and there is a test that pins it. That is not an accident worth
 * relying on quietly: the specification gives the thumbnail its own `file`
 * object so it can be an independent one, and reusing the photograph's key
 * would mean that handing somebody the small picture hands them the large one.
 *
 * It goes **before** the photograph, which is the only ordering that keeps the
 * paragraph above true. A thumbnail is around a hundred kilobytes against
 * several megabytes, so trying it first costs almost nothing — and if the media
 * repository refuses it, nothing has been uploaded yet and the send fails the
 * way an upload failure already fails. The other order would have to choose
 * between failing a photograph that is already in the repository and sending
 * one whose missing thumbnail nobody would ever notice, which is the shape of
 * defect this codebase spends its comments avoiding.
 */

export interface SealedFile {
  readonly ciphertext: Uint8Array
  readonly secret: string
}

export interface SendingImageDeps {
  /** `encryptAttachment`, behind a port so this is testable without a device. */
  readonly seal: (plaintext: Uint8Array) => Promise<SealedFile>
  /** Puts the ciphertext in the media repository and answers its `mxc://`. */
  readonly upload: (ciphertext: Uint8Array) => Promise<string>
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

export type ImageSent =
  | { readonly sent: true; readonly eventId: string }
  | { readonly sent: false; readonly reason: string }

export async function sendImage(
  deps: SendingImageDeps,
  scope: string,
  image: PickedImage,
): Promise<ImageSent> {
  const refusal = refuseImage(image)
  if (refusal !== null) return { sent: false, reason: refusal }

  try {
    const thumbnail =
      image.thumbnail === undefined
        ? null
        : await sealAndUpload(deps, image.thumbnail.bytes)
    const photograph = await sealAndUpload(deps, image.bytes)
    const content = describeImage(image, photograph, thumbnail)

    // `m.room.message` inside the ciphertext, which is what an image is:
    // `m.image` is a message's `msgtype`, not an event type. The outer type
    // on the wire is `m.room.encrypted`, as for everything else.
    const envelope = await deps.machine.encryptEvent(
      scope,
      'm.room.message',
      content as unknown as Record<string, unknown>,
    )
    const eventId = await deps.send(
      scope,
      new TextDecoder().decode(envelope.ciphertext),
    )
    return { sent: true, eventId }
  } catch (cause: unknown) {
    return { sent: false, reason: getErrorMessage(cause) }
  }
}

/**
 * One file, sealed and put in the media repository.
 *
 * The pair is per file rather than sealing both files and then uploading
 * both, so the thumbnail's ciphertext is gone before the photograph's exists.
 * `encryptAttachment` holds the plaintext and the ciphertext at once, and
 * holding two of those at a time is the peak `sendImages.ts` already refuses
 * to pay across a batch.
 */
async function sealAndUpload(
  deps: SendingImageDeps,
  plaintext: Uint8Array,
): Promise<Uploaded> {
  const sealed = await deps.seal(plaintext)
  return { url: await deps.upload(sealed.ciphertext), secret: sealed.secret }
}

/** The transport half, bound where `HttpRequester` is available. */
export function sendingThrough(
  http: HttpRequester,
  newTransactionId: () => string,
) {
  return (scope: string, wire: string) =>
    sendEncryptedEvent(http, scope, wire, newTransactionId())
}
