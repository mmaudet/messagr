/**
 * Choosing an image, as an interface rather than as a library.
 *
 * # Why a port, when a library was asked for
 *
 * The product targets iOS, Android and a Tauri desktop
 * (`product-spec.md` §13.19, "Token consumption mechanics"), and **no library
 * covers all three**: a React Native picker is a native module on two of them
 * and does not exist on the third, where the answer is Tauri's own dialog
 * API. "The most standard option compatible with the targets" is therefore
 * not a package name, it is this shape — with the standard package behind it
 * on React Native and Tauri's dialog behind it on the desktop.
 *
 * It is also the pattern every other native seam here already uses:
 * `SecretStore` for the keystore, `HttpRequester` for the transport,
 * `EncryptedDatabase` for the notebook, `InvitationService` for the service.
 * One module names the library; nothing above it can.
 *
 * # What crosses, and what deliberately does not
 *
 * Bytes, not a path. A file path would be a promise that the file is still
 * there when somebody gets round to sending it, and on both platforms the
 * picker hands back a URI into a cache the system may clear. Bytes are also
 * what `encryptAttachment` takes, so the plaintext goes from the picker into
 * the bridge without touching this application's own storage — which is
 * ADR-0006 holding for media as well as for messages.
 */

export interface PickedImage {
  /** The image itself. Never written to disk by this application. */
  readonly bytes: Uint8Array
  /** What the picker says it is. Carried so a recipient can render it. */
  readonly mimeType: string
  readonly width: number
  readonly height: number
}

/**
 * `null` when somebody chose nothing.
 *
 * Cancelling is not a failure and must not read as one: it is the commonest
 * outcome of opening a picker, and a screen that showed an error for it would
 * be scolding somebody for changing their mind.
 */
export type ImagePicker = () => Promise<PickedImage | null>

/**
 * The largest image this application will send.
 *
 * Not a policy about photographs, a fact about memory: `encryptAttachment`
 * holds the plaintext and the ciphertext at once (its own doc comment says
 * so), and a phone asked to hold two copies of a fifty-megapixel image will
 * be killed rather than slowed. Refusing with a sentence beats being closed
 * by the operating system.
 */
export const LARGEST_IMAGE_BYTES = 12 * 1024 * 1024

export type ImageRefusal = 'too-large' | 'unreadable'

/**
 * Whether a picked image can be sent, or why not.
 *
 * Separate from the picker so the limit is testable without one, and so the
 * Tauri adapter inherits it rather than reinventing it.
 */
export function refuseImage(image: PickedImage): ImageRefusal | null {
  if (image.bytes.length === 0) return 'unreadable'
  if (image.bytes.length > LARGEST_IMAGE_BYTES) return 'too-large'
  return null
}
