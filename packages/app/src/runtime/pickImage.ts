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
 *
 * # A thumbnail is the same shape, and it is optional here
 *
 * A grid tile is about 130 points and a photograph is up to twelve megabytes,
 * so a tile drawn from the photograph costs a download, a decryption and a
 * base64 that all scale with a size nothing on that tile can use (#117). The
 * answer is a second, smaller copy of the same picture, sealed and uploaded
 * beside it — so a picker that can make one puts it here.
 *
 * Optional, because a picker that cannot is not a picker that cannot send:
 * `sendImage` sends the photograph alone, and a reader with no thumbnail
 * draws the photograph, which is what every event sent before this existed
 * already does.
 */

/**
 * Bytes and what they are, which is all a thumbnail is as well.
 *
 * Split out so a thumbnail cannot carry a thumbnail. The recursion would be
 * meaningless and the type is the cheapest place to say so.
 */
export interface ImageBytes {
  /** The image itself. Never written to disk by this application. */
  readonly bytes: Uint8Array
  /** What the picker says it is. Carried so a recipient can render it. */
  readonly mimeType: string
  readonly width: number
  readonly height: number
}

export interface PickedImage extends ImageBytes {
  /**
   * A downscaled copy of the same picture, when the picker could make one.
   *
   * Its own dimensions and its own type: a picker is free to re-encode, and
   * a recipient sizing a tile from the photograph's proportions would be
   * sizing it from the wrong ones the moment a picker crops.
   */
  readonly thumbnail?: ImageBytes
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

/**
 * The longest edge of a thumbnail, in pixels.
 *
 * The largest surface a thumbnail is ever drawn on is a conversation bubble
 * at close to the screen's width — around a thousand device pixels on a large
 * phone — and the smallest is a plate tile of about 130 points. 800 is the
 * largest size the specification's own thumbnail table names, so a Messagr
 * thumbnail is the size other clients already expect; below it a bubble goes
 * visibly soft, and above it the bytes grow quadratically for fidelity a tile
 * throws away.
 *
 * A bound on the longest edge rather than a box, because the proportions are
 * the sender's and a thumbnail that changed them would crop somebody's
 * photograph on a decision this application had no business making.
 *
 * Nothing passes it yet, and `imageLibrary.ts` records why no picker in this
 * tree can honour it. It is named here rather than left in prose so that the
 * number a resizer is eventually given is this one, argued, and not a fresh
 * one chosen at the call site.
 */
export const THUMBNAIL_EDGE = 800

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
