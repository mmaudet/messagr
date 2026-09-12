// The one module that names `react-native-image-picker`, kept thin for the
// reason `notebook.ts` and `cryptoPump.ts` are: it is a native module, so
// nothing worth unit-testing lives here. What it adapts to is
// `pickImage.ts`'s `ImagePicker`, which the tests drive with a function.
import {
  CachesDirectoryPath,
  TemporaryDirectoryPath,
  readDir,
  readFile,
  unlink,
} from '@dr.pogodin/react-native-fs'
import ImageResizer from '@bam.tech/react-native-image-resizer'
import { launchImageLibrary } from 'react-native-image-picker'

import { isOurs, sweepPickedLitter } from './pickedLitter'
import { THUMBNAIL_EDGE, type ImageBytes, type PickedImage } from './pickImage'
import { MOST_AT_ONCE } from './sendImages'

import { bytesOf } from './base64'

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
 * anywhere.
 *
 * What would breach ADR-0006 is caching a *received* photograph to disk after
 * decrypting it. That remains forbidden, and `receiveImage.ts` still holds
 * plaintext in memory only.
 *
 * # AND THE COPIES ARE REMOVED, WHICH THE PARAGRAPH ABOVE USED TO SKIP
 *
 * That argument is right about the source and said nothing about what is
 * left behind. Measured on a device: choosing **one** photograph and sending
 * it left three readable JPEGs in this application's cache -- two the picker
 * wrote, one the resizer did -- still there minutes later (#209).
 *
 * The surprising part is not that they exist, it is what they outlive.
 * Delete the photograph from the gallery and Messagr still has it, in a
 * directory nobody thinks of as holding photographs. So each is unlinked as
 * soon as its bytes are in memory, which is the moment it stops being needed.
 *
 * Nothing is unlinked unless it sits in a directory this application owns.
 * See `pickedLitter.ts`: the picker answers a path, and a module that
 * removed whatever path it was handed would be one bad answer away from
 * deleting somebody's photograph out of their gallery.
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
    // AFTER THE THUMBNAIL, because the resizer reads this same file. The
    // bytes are in `photograph` by now either way, so what is being removed
    // is a copy nothing will ask for again.
    await forget(asset.uri)
  }
  // AND THE ONES IT NEVER NAMED. The picker writes more copies than it
  // answers paths for -- measured, two files for one photograph chosen, and
  // `asset.uri` is one of them. Chasing the second through the library's
  // internals would be guessing at a version; sweeping its own directory for
  // its own prefix is what it actually leaves, whatever it decides to leave.
  //
  // Safe here for the reason it is safe at launch: the shapes are the
  // library's own and the directories are this application's. See
  // `pickedLitter.ts`.
  await sweepWhatThePickerLeft().catch(() => undefined)
  return picked
}

/** The directories this application may delete inside of. */
const OURS = [TemporaryDirectoryPath, CachesDirectoryPath]

/**
 * Removes what earlier versions of this module left behind.
 *
 * The unlinks above stop new copies appearing; this is for the telephones
 * that have been accumulating them, the demonstration Pixel included. Bound
 * to the real filesystem here for the reason everything else in this file is:
 * `pickedLitter.ts` holds the decisions and is tested against four
 * functions.
 */
export async function sweepWhatThePickerLeft(): Promise<number> {
  return sweepPickedLitter({
    directories: OURS,
    list: async directory => (await readDir(directory)).map(one => one.name),
    forget: async path => {
      await unlink(path)
    },
  })
}

/**
 * Removes a file this application put there, and nothing else.
 *
 * Swallows its own failure: a copy that will not delete is one the system
 * clears on its own, and a photograph the person is trying to send must not
 * fail over housekeeping.
 */
async function forget(path: string | undefined): Promise<void> {
  if (path === undefined || !isOurs(path, OURS)) return
  await unlink(path).catch(() => undefined)
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
    // NO `mode`, AND THE BLACK BARS ARE WHY.
    //
    // This asked for a SQUARE box with `mode: 'contain'`, and `contain`
    // fills the rest of the box it was given: a landscape photograph came
    // back square with black bands baked into the pixels. They were not
    // drawn by any screen -- they were in the file, so they survived the
    // upload, the encryption and the fetch, and appeared identically on both
    // platforms. Reported from an iPhone and a Pixel on 7 September 2026.
    //
    // Without `mode` the two numbers are a bounding box the library scales
    // *within*, preserving the photograph's own proportions, which is what a
    // thumbnail of a picture should be. `onlyScaleDown` stays: a small
    // photograph must not be enlarged into a bigger file than the one it
    // replaces.
    const small = await ImageResizer.createResizedImage(
      uri,
      THUMBNAIL_EDGE,
      THUMBNAIL_EDGE,
      'JPEG',
      70,
      0,
      undefined,
      false,
      { onlyScaleDown: true },
    )
    try {
      // A resize that came back no smaller is a resize worth dropping: a
      // second file to seal, upload and fetch, for no fewer bytes.
      if (small.size >= photograph.bytes.length) return undefined
      return {
        bytes: bytesOf(await readFile(small.path, 'base64')),
        mimeType: 'image/jpeg',
        width: small.width,
        height: small.height,
      }
    } finally {
      // INCLUDING ON THE EARLY RETURN, which is why this is a `finally` and
      // not a line after the read: a resize judged too big was dropped and
      // its file kept, which is one of the three #209 measured.
      await forget(small.path)
    }
  } catch {
    // Deliberately swallowed. See the note above: a thumbnail that could not
    // be made must never cost somebody their photograph, and the reader's
    // fallback to the full file is a path old events already take.
    return undefined
  }
}
