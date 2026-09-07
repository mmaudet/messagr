// The one module that names `react-native-image-picker`, kept thin for the
// reason `notebook.ts` and `cryptoPump.ts` are: it is a native module, so
// nothing worth unit-testing lives here. What it adapts to is
// `pickImage.ts`'s `ImagePicker`, which the tests drive with a function.
import { readFile } from '@dr.pogodin/react-native-fs'
import ImageResizer from '@bam.tech/react-native-image-resizer'
import { launchImageLibrary } from 'react-native-image-picker'

import { THUMBNAIL_EDGE, type ImageBytes, type PickedImage } from './pickImage'
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
 * # The thumbnail, and the two dependencies it took
 *
 * `#117` wants a tile to cost a tile rather than a photograph: a plate draws
 * at about 130 points and was downloading 2.8 MB to fill it. Measured on a
 * device, that was 840 ms of network, 40 ms of bridge and 250 ms of base64
 * **on the thread that draws**, per photograph, on every cold launch.
 *
 * React Native cannot downscale an image in JavaScript, and nothing already
 * in this tree can do it either — each of these was checked rather than
 * assumed:
 *
 * - **The picker itself.** `maxWidth`/`maxHeight` do resize, but they resize
 *   *the asset the call returns*, and a call returns one asset per photograph
 *   chosen. Two sizes is two calls, and a second `launchImageLibrary`
 *   presents the library again: it would ask somebody to find the same
 *   photographs twice for a saving nobody told them about.
 * - **React Native's own `ImageEditingManager`.** Still declared in 0.87's
 *   deprecated specs and implemented on iOS; gone from Android, where
 *   `getEnforcing` throws.
 * - **`react-native-svg`'s `toDataURL`.** It does rasterise a view to bytes,
 *   and only to PNG. A photograph at 800 pixels is most of a megabyte as PNG
 *   against about a hundred kilobytes as JPEG — three or four times smaller
 *   than the file it replaces, where an order of magnitude is the point.
 *   Rejected on the arithmetic before the taste.
 *
 * So it took `@bam.tech/react-native-image-resizer`. And then a second one,
 * because the resizer answers a **path** and not bytes: `fetch` resolves
 * `file:` URLs on iOS through `RCTFileRequestHandler` and on Android through
 * nothing at all — `NetworkingModule` reads a file URI only to *send* it as a
 * request body, never to hand its contents back. So `@dr.pogodin/
 * react-native-fs` reads the one file, and its `readFile(path, 'base64')` is
 * the whole of what this module uses it for.
 *
 * # ADR-0006 is not bent by this, and the distinction is worth stating
 *
 * A filesystem module in an application whose rule is that nothing decrypted
 * reaches the disk looks like a contradiction. It is not: the file being read
 * is one the **picker already wrote**, from a photograph the person chose out
 * of their own gallery, which the system had on that disk before this
 * application existed. Nothing this application decrypted is written
 * anywhere, and the resized copy is read once and dropped.
 *
 * What would breach ADR-0006 is caching a *received* photograph to disk after
 * decrypting it. That remains forbidden, and `receiveImage.ts` still holds
 * plaintext in memory only.
 *
 * # A failed thumbnail is not a failed photograph
 *
 * Every step below can fail on a device — a codec that refuses a format, a
 * cache the system cleared between the pick and the read. None of them may
 * cost somebody their photograph: the thumbnail is dropped, the photograph is
 * sent whole, and a reader draws it from the full file exactly as it did
 * before #117. That is the same fallback old events already rely on, so it is
 * a path with two users rather than a branch nobody takes.
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

  // Sequential rather than `Promise.all`: each thumbnail is a native resize
  // and a file read, and fifty at once is fifty codecs competing for the same
  // cores while the person waits to see the picker close. `sendImages.ts`
  // makes the same argument about sending.
  const picked: PickedImage[] = []
  for (const asset of answer.assets ?? []) {
    if (asset.base64 === undefined) continue
    const photograph: ImageBytes = {
      bytes: bytesOf(asset.base64),
      // The picker knows the type; when it does not, the send path assumes a
      // photograph rather than refusing one.
      mimeType: asset.type ?? 'image/jpeg',
      width: asset.width ?? 0,
      height: asset.height ?? 0,
    }
    picked.push({
      ...photograph,
      thumbnail: await thumbnailOf(asset.uri, photograph),
    })
  }
  return picked
}

/**
 * A small copy of a photograph, or nothing.
 *
 * JPEG at 70, not PNG and not 100. A thumbnail is drawn at about 130 points
 * and its job is to be recognisable; the quality that matters is the full
 * photograph's, which is untouched. PNG would be three or four times the
 * bytes for a photograph, which is the arithmetic that rejected the SVG route
 * above.
 *
 * `onlyScaleDown` so a photograph already smaller than the edge is not blown
 * up into a *larger* file than the one it stands in for -- which would make
 * the thumbnail cost more than the thing it saves.
 */
async function thumbnailOf(
  uri: string | undefined,
  photograph: ImageBytes,
): Promise<ImageBytes | undefined> {
  if (uri === undefined) return undefined
  try {
    const small = await ImageResizer.createResizedImage(
      uri,
      THUMBNAIL_EDGE,
      THUMBNAIL_EDGE,
      'JPEG',
      70,
      0,
      undefined,
      false,
      { mode: 'contain', onlyScaleDown: true },
    )
    // A resize that came back no smaller is a resize worth dropping: a second
    // file to seal, upload and fetch, for no fewer bytes.
    if (small.size >= photograph.bytes.length) return undefined
    return {
      bytes: bytesOf(await readFile(small.path, 'base64')),
      mimeType: 'image/jpeg',
      width: small.width,
      height: small.height,
    }
  } catch {
    // Deliberately swallowed. See the note above: a thumbnail that could not
    // be made must never cost somebody their photograph, and the reader's
    // fallback to the full file is a path old events already take.
    return undefined
  }
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
