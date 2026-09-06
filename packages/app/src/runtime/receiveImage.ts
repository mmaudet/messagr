import type { ReadImage } from '../timeline/imageEvent'
import { getErrorMessage } from './errors'
import { logEvent } from './log'

/**
 * Getting a photograph back: download, decrypt, and hand a screen something
 * it can draw.
 *
 * # Why a data URI and not a file
 *
 * `<Image>` takes a URI. The obvious one is a path to a decrypted file, and
 * ADR-0006 forbids exactly that: nothing decrypted goes to disk. So the
 * plaintext stays in memory and reaches the view as `data:` — which the
 * platform's image loader accepts, and which no other process can read.
 *
 * The cost is honest and worth stating: a data URI is the image base64'd,
 * so it is a third larger than the file and it lives as a JavaScript string
 * for as long as the view holds it. That bounds how large a photograph this
 * application can show, and it is the same bound `LARGEST_IMAGE_BYTES`
 * already puts on sending. A product that needed to show fifty-megapixel
 * images would need a decrypting image loader on the native side, which is a
 * different piece of work and not a bigger buffer.
 *
 * # Two failures, told apart
 *
 * The bridge distinguishes a malformed secret from bytes that are not what
 * the secret announced, and that distinction survives to here: the first is
 * a bug upstream of the download, the second is a download worth making
 * again. A screen that said "could not show this image" for both would throw
 * away the only actionable half.
 */

export interface ImageSource {
  readonly download: (url: string) => Promise<Uint8Array>
  /** `decryptAttachment`, behind a port. */
  readonly open: (ciphertext: Uint8Array, secret: string) => Promise<Uint8Array>
}

export type ShownImage =
  | { readonly shown: true; readonly uri: string }
  | { readonly shown: false; readonly reason: string }

/** What a photograph is when its sender did not say. */
const ASSUMED_TYPE = 'image/jpeg'

/**
 * What has already been fetched, so it is not fetched again.
 *
 * # Why a cache is not an optimisation here
 *
 * `Conversation` maps its entries and each `Photograph` fetches on mount, so
 * leaving the conversation and coming back -- switching tabs does it --
 * downloaded and decrypted every photograph in it again. Found in review, and
 * it is a correctness problem rather than a slow one: the plaintext lives as
 * a data URI for as long as a view holds it, so the un-cached version held
 * several copies of the same image at once while the new ones arrived.
 *
 * # Bounded, and by count rather than by bytes
 *
 * A photograph is up to twelve megabytes, and its data URI a third more, so
 * an unbounded map of them is an application the operating system kills. The
 * oldest is dropped when the limit is reached: a conversation is read in
 * order, and what is furthest up the screen is what is least likely to be
 * looked at again.
 *
 * # It holds plaintext, in memory, and that is ADR-0006's whole line
 *
 * Decrypted images are held in memory and never written to disk -- which is
 * what the data URI was chosen for. This cache changes how long they live in
 * memory, not where they live. It is cleared when the process is.
 */
const SEEN = new Map<string, ShownImage>()

/** How many decrypted photographs may be held at once. */
const MOST_HELD = 12

/** Forgets everything. For a device that has just been signed out. */
export function forgetShownImages(): void {
  SEEN.clear()
}

/**
 * How many photographs are fetched at once.
 *
 * MEASURED, NOT CHOSEN. A conversation mounts every `Photograph` at once and
 * each fetched on mount, so ten photographs meant ten simultaneous downloads
 * -- and on a device the cost showed up as a queue rather than as bandwidth:
 * the first image's download took 836ms and the tenth's 4341ms, for the same
 * network and a smaller file. The 47kB thumbnail took 871ms behind others and
 * 191ms when it went first.
 *
 * Nothing about that made the *total* faster or slower. What it changed was
 * when anything appeared: with ten in flight, all ten arrive at the end. With
 * three, the first three arrive in about a second and the screen stops being
 * empty.
 */
const AT_ONCE = 3

/**
 * Waiting to be fetched, newest first.
 *
 * LAST IN, FIRST OUT, AND THAT IS THE WHOLE POINT. Children mount top to
 * bottom, so a queue served in order would fetch the oldest messages first --
 * and a conversation rests at its *newest* (§13.27), which is the part
 * somebody is looking at. Serving the last request first serves the bottom of
 * the screen first.
 *
 * It is a heuristic, not a viewport calculation: nothing here knows what is
 * on screen. It is right for the case that matters -- opening a conversation
 * -- and no worse than order for any other.
 */
const WAITING: (() => void)[] = []
let running = 0

function takeATurn(): Promise<void> {
  if (running < AT_ONCE) {
    running += 1
    return Promise.resolve()
  }
  return new Promise<void>(resolve => {
    WAITING.push(() => {
      running += 1
      resolve()
    })
  })
}

function giveItBack(): void {
  running -= 1
  const next = WAITING.pop()
  if (next !== undefined) next()
}

/** Empties the queue. For tests, and for a conversation being left. */
export function forgetWhatIsWaiting(): void {
  WAITING.length = 0
  running = 0
}

export async function fetchImage(
  source: ImageSource,
  image: ReadImage,
): Promise<ShownImage> {
  // Keyed by the address, which is what identifies the bytes. Not by the
  // secret: the same upload referenced twice is the same picture, and the
  // secret is the thing least worth putting in a map key.
  const held = SEEN.get(image.url)
  if (held !== undefined) return held

  const answer = await open(source, image)
  // Failures are not kept. A download worth making again is exactly what the
  // bridge distinguishes, and caching a failure would turn a transient one
  // into a permanent one for as long as the application runs.
  if (answer.shown) {
    if (SEEN.size >= MOST_HELD) {
      const oldest = SEEN.keys().next().value
      if (oldest !== undefined) SEEN.delete(oldest)
    }
    SEEN.set(image.url, answer)
  }
  return answer
}

async function open(
  source: ImageSource,
  image: ReadImage,
): Promise<ShownImage> {
  // The turn is taken around the whole thing rather than around the download
  // alone: the decryption and the encoding contend too -- the same run showed
  // decryption growing from 38ms to 993ms behind others -- and letting ten
  // decryptions start because ten downloads finished would move the queue
  // rather than remove it.
  await takeATurn()
  try {
    // TIMED, IN THREE PARTS, BECAUSE THEY ARE THREE DIFFERENT PROBLEMS.
    //
    // A cold launch shows nothing decrypted from disk (ADR-0006), so every
    // photograph on screen is fetched, decrypted and encoded again -- and
    // "it is slow" is not actionable until it says *which*. The network is
    // one answer, the bridge is another, and `base64Of` running on the
    // JavaScript thread is a third, which would also freeze the scroll while
    // it ran.
    //
    // Kept rather than removed after measuring: it costs three `Date.now()`
    // and one log line per photograph, and it is the only thing that will
    // say whether a change made this faster on a device rather than on a
    // laptop.
    const began = Date.now()
    const ciphertext = await source.download(image.url)
    const downloaded = Date.now()
    const plaintext = await source.open(ciphertext, image.secret)
    const decrypted = Date.now()
    const type = image.mimeType ?? ASSUMED_TYPE
    const uri = `data:${type};base64,${base64Of(plaintext)}`
    const encoded = Date.now()
    logEvent('info', 'MESSAGR_IMAGE_TIMING', {
      bytes: plaintext.length,
      downloadMs: downloaded - began,
      decryptMs: decrypted - downloaded,
      encodeMs: encoded - decrypted,
      totalMs: encoded - began,
    })
    return { shown: true, uri }
  } catch (cause: unknown) {
    return { shown: false, reason: getErrorMessage(cause) }
  } finally {
    giveItBack()
  }
}

const ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/**
 * Bytes to base64, written out rather than reached for.
 *
 * Hermes has no `Buffer`, and `btoa` takes a string — which means going
 * through a string conversion that mangles every byte above 127, and a
 * photograph is nothing but bytes above 127. Three bytes to four characters,
 * padded, is small enough to write correctly and is tested against every
 * byte value there is.
 *
 * `no-bitwise` is off for the body and nowhere else. The rule is there to
 * catch a `&` written where `&&` was meant; base64 is bit manipulation by
 * definition, and rewriting it in arithmetic to satisfy a lint would make it
 * slower and harder to check against the definition.
 */
/* eslint-disable no-bitwise */
export function base64Of(bytes: Uint8Array): string {
  let out = ''
  for (let at = 0; at < bytes.length; at += 3) {
    const one = bytes[at]!
    const two = bytes[at + 1]
    const three = bytes[at + 2]

    out += ALPHABET[one >> 2]
    out += ALPHABET[((one & 0b11) << 4) | ((two ?? 0) >> 4)]
    out +=
      two === undefined
        ? '='
        : ALPHABET[((two & 0b1111) << 2) | ((three ?? 0) >> 6)]
    out += three === undefined ? '=' : ALPHABET[three & 0b111111]
  }
  return out
}
/* eslint-enable no-bitwise */
