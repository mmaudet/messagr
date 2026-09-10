// The one module that names `@react-native-camera-roll/camera-roll`, kept
// thin for the reason `imageLibrary.ts` is: it is a native module, so nothing
// worth unit-testing lives here. What it adapts to is `keepPhotograph.ts`'s
// `Keeping`, which the tests drive with four functions.
import {
  TemporaryDirectoryPath,
  unlink,
  writeFile,
} from '@dr.pogodin/react-native-fs'
import { CameraRoll } from '@react-native-camera-roll/camera-roll'

import type { Keeping } from './keepPhotograph'

/**
 * The gallery of the telephone, as this application reaches it.
 *
 * # WHY A DEPENDENCY AND NOT A PATH
 *
 * Writing into the pictures directory stopped being a thing an application
 * may do: Android's scoped storage routes it through MediaStore, and iOS has
 * never had a directory for it at all -- a photograph gets there through
 * `PHPhotoLibrary` and nowhere else. `react-native-fs` is already here and
 * cannot do either; what it can do is the half this needs, which is putting
 * bytes somewhere for the length of one call.
 *
 * # `type: 'photo'` AND NOTHING ELSE
 *
 * The library saves videos too. This product sends none, and a parameter
 * that accepts what the product cannot produce is a parameter somebody will
 * one day pass the wrong thing to.
 */
export const photoLibrary: Keeping = {
  temporary: TemporaryDirectoryPath,
  write: async (path, base64) => {
    await writeFile(path, base64, 'base64')
  },
  keep: async path => {
    // `file://` rather than a bare path: Android's MediaStore takes a URI,
    // and a path without a scheme is read as a relative one.
    await CameraRoll.save(`file://${path}`, { type: 'photo' })
  },
  forget: async path => {
    await unlink(path)
  },
  // Not a clock and not a counter: two photographs saved in the same
  // millisecond would collide on a timestamp, and a counter would restart
  // with the process. The temporary directory is this application's own, so
  // the only collision that matters is with itself.
  name: () =>
    `messagr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
}
