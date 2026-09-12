import type { CopyKey } from '../copy'

/**
 * What a file weighs, as a row says it.
 *
 * # Binary units, because the file manager the person will open uses them
 *
 * A row that called 1 000 000 bytes « 1 Mo » would disagree by five per cent
 * with the list the same file lands in once it is saved, and a number that
 * disagrees with the system's own is a number somebody checks twice.
 *
 * # One decimal for megabytes and none for kilobytes
 *
 * « 3,3 Mo » is the difference between a file that will send and one that
 * will not; « 347 Ko » against « 347,2 Ko » is noise in the same place.
 *
 * The unit is a copy key rather than a suffix glued on here: `Ko` is not
 * `KB`, and the seven catalogues already carry that difference.
 */
export function statedSize(
  bytes: number | null,
): { readonly key: CopyKey; readonly amount: string } | null {
  if (bytes === null) return null

  const kilobytes = bytes / 1024
  if (bytes < 1024 * 1024) {
    // ROUNDED UP, NEVER TO ZERO. A file that exists weighs something, and a
    // row saying « 0 Ko » about a real file says something false about it.
    return {
      key: 'file_size_kb %@',
      amount: String(Math.max(1, Math.round(kilobytes))),
    }
  }
  return {
    key: 'file_size_mb %@',
    amount: (bytes / (1024 * 1024)).toFixed(1),
  }
}
