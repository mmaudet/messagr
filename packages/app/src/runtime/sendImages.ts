import type { PickedImage } from './pickImage'
import type { ImageSent } from './sendImage'

/**
 * Several photographs, sent as several events.
 *
 * # One at a time, and that is not a simplification
 *
 * `encryptAttachment` holds the plaintext and the ciphertext at once — its
 * own documentation says so — so a phone asked to seal thirty photographs
 * concurrently holds sixty copies and is killed by the operating system
 * rather than slowed. A `Promise.all` here would be a crash on somebody
 * else's phone, on a good connection, with a full camera roll. There is a
 * test whose only job is to keep one from creeping back.
 *
 * A photograph is now two sealings rather than one, since #117 gave it a
 * thumbnail. It does not move the peak: `sendImage` seals the thumbnail,
 * uploads it and lets it go before it touches the photograph, so what is held
 * at once is still one picture and its ciphertext.
 *
 * # It stops at the first failure
 *
 * Carrying on would send the fourth after the third failed, leaving a hole
 * a person cannot see and cannot act on. Stopping names the boundary: this
 * many went, this many did not, and the rest are still there to send.
 *
 * # Each one is its own event
 *
 * Matrix has no album. What makes several photographs read as one thing is
 * `plates.ts`, which is a reading of the timeline rather than something sent
 * — so nothing here needs to know that a plate exists.
 */

/** How many this will carry in one gesture. */
export const MOST_AT_ONCE = 50

export type SendingEach = (image: PickedImage) => Promise<ImageSent>

export type ImagesSent =
  | { readonly sent: number }
  | {
      readonly sent: number
      readonly reason: string
      /** How many were never attempted, so a screen can offer them again. */
      readonly remaining: number
    }

export async function sendImages(
  each: SendingEach,
  images: readonly PickedImage[],
  onProgress?: (progress: { done: number; total: number }) => void,
): Promise<ImagesSent> {
  if (images.length === 0) return { sent: 0 }
  // Enforced here as well as in the picker. A limit that lives in one place
  // is a limit until somebody edits that place, and this is the one that
  // stands between a phone and sixty photographs in memory.
  if (images.length > MOST_AT_ONCE) {
    return { sent: 0, reason: 'too-many', remaining: images.length }
  }

  let done = 0
  for (const image of images) {
    const outcome = await each(image)
    if (!outcome.sent) {
      return {
        sent: done,
        reason: outcome.reason,
        remaining: images.length - done,
      }
    }
    done += 1
    onProgress?.({ done, total: images.length })
  }
  return { sent: done }
}
