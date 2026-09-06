// The one module that names `react-native-image-picker`, kept thin for the
// reason `notebook.ts` and `cryptoPump.ts` are: it is a native module, so
// nothing worth unit-testing lives here. What it adapts to is
// `pickImage.ts`'s `ImagePicker`, which the tests drive with a function.
import { launchImageLibrary } from 'react-native-image-picker'

import type { PickedImage } from './pickImage'
import { MOST_AT_ONCE } from './sendImages'

/**
 * Choosing a photograph from the library.
 *
 * # `includeBase64`, and it is not laziness
 *
 * The picker can hand back a path or the bytes. A path would be the smaller
 * value to carry and the wrong one: the file sits in a cache the system may
 * clear, so a path is a promise about a file that may already be gone — and
 * reading it back would need a filesystem module this application does not
 * have and does not want, since ADR-0006 is about not having plaintext on a
 * disk this process can read.
 *
 * The bytes cost memory. `LARGEST_IMAGE_BYTES` is the bound, and it is
 * enforced in `pickImage.ts` where it can be tested rather than here.
 *
 * # `photo` only
 *
 * Not `mixed`. A video would be picked, encrypted, uploaded and then shown as
 * a broken image, because nothing renders one — a control that accepts what
 * the product cannot display is worse than one that does not offer it.
 *
 * # It answers a list, and an empty one for a cancellation
 *
 * `null` said "nothing chosen" when there was one answer. With several there
 * is a better shape: an empty list is nothing chosen, and every caller loops
 * either way.
 *
 * # No thumbnail comes out of here yet, and the reason is not an oversight
 *
 * `PickedImage.thumbnail` is the seam #117 needs filled, and everything above
 * it is built: `sendImage` seals and uploads a thumbnail with a key of its
 * own, and every surface but the full-screen viewer already draws the
 * smallest copy it is offered. What is missing is the downscaling, which is
 * the one step React Native cannot do in JavaScript, and none of what is in
 * this tree can do it either:
 *
 * - **The picker itself.** `maxWidth`/`maxHeight` do resize — but they resize
 *   *the asset the call returns*, and a call returns one asset per photograph
 *   chosen. Two sizes is two calls, and a second `launchImageLibrary` presents
 *   the library again: it would ask somebody to find and choose the same
 *   photographs twice for a saving they were never told about.
 * - **React Native's own `ImageEditingManager`.** It is still declared in
 *   0.87's deprecated specs and implemented on iOS, and it is gone from
 *   Android, where `getEnforcing` throws — so it is absent on the platform
 *   the ticket's measurements came from.
 * - **Reading the picker's `originalPath` back.** `fetch` resolves `file:`
 *   URLs on iOS through `RCTFileRequestHandler` and on Android through
 *   nothing at all: OkHttp is the whole of the transport there.
 * - **`react-native-svg`'s `toDataURL`.** It really does rasterise a view to
 *   bytes, and it rasterises to PNG. A photograph at 800 pixels is most of a
 *   megabyte as a PNG where it is around a hundred kilobytes as a JPEG: three
 *   or four times smaller than the file it replaces, where #117 wants an
 *   order of magnitude. It would also make sending depend on a mounted view.
 *   Rejected on the arithmetic before the taste.
 *
 * So this returns photographs with no thumbnail, `sendImage` sends them as it
 * always did, and a reader draws them from the full file as it always did.
 * Closing it wants a resizer — `@react-native-community/image-editor` is the
 * narrowest one, being the Android half that used to be core — and adding a
 * dependency is not this ticket's to take.
 */
export async function pickFromLibrary(): Promise<readonly PickedImage[]> {
  const answer = await launchImageLibrary({
    mediaType: 'photo',
    includeBase64: true,
    // SEVERAL, AND A CAP. The cap is here and in `sendImages.ts` both, on
    // purpose: a limit enforced in one place is a limit until somebody edits
    // that place, and what stands behind it is a phone holding fifty
    // photographs in memory twice over -- `encryptAttachment` keeps the
    // plaintext and the ciphertext together.
    selectionLimit: MOST_AT_ONCE,
  })

  // Cancelling is the commonest outcome of opening a picker and is not a
  // failure. `pickImage.ts` says why it must not read as one.
  if (answer.didCancel === true) return []

  return (answer.assets ?? [])
    .filter(asset => asset.base64 !== undefined)
    .map(asset => ({
      bytes: bytesOf(asset.base64 ?? ''),
      // The picker knows the type; when it does not, the send path assumes a
      // photograph rather than refusing one.
      mimeType: asset.type ?? 'image/jpeg',
      width: asset.width ?? 0,
      height: asset.height ?? 0,
    }))
}

/**
 * base64 to bytes.
 *
 * `atob` exists in Hermes and returns a string of char codes, each one a
 * byte — which is safe in this direction, unlike the other, where a string
 * conversion is what corrupts a photograph. See `receiveImage.ts` for the
 * encoder and why it is written out.
 */
function bytesOf(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let at = 0; at < binary.length; at += 1) {
    bytes[at] = binary.charCodeAt(at)
  }
  return bytes
}
