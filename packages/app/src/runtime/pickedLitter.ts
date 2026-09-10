/**
 * The copies a picked photograph leaves behind, and which of them are ours
 * to remove.
 *
 * # WHAT WAS MEASURED
 *
 * Choosing one photograph and sending it left three readable JPEGs in the
 * application's cache -- two written by `react-native-image-picker`, one by
 * the resizer that makes the thumbnail. All three began `FF D8 FF`, and they
 * were still there minutes later.
 *
 * `imageLibrary.ts` argued that ADR-0006 was not bent by reading a file the
 * picker had written, since the photograph came from the person's own
 * gallery and was on that disk before this application existed. That is
 * right about the *source* and says nothing about the *copies*. The
 * surprising part is what the copies outlive: delete the photograph from the
 * gallery and Messagr still has it, in a directory nobody thinks of as
 * holding photographs.
 *
 * # THE GUARD, AND WHY IT IS NOT OPTIONAL
 *
 * The picker answers a path. On both platforms that path is its own copy in
 * this application's cache -- but a module that unlinks whatever path it is
 * handed is one bad answer away from deleting somebody's photograph out of
 * their gallery. So nothing is removed unless it sits inside a directory
 * this application owns. The cost of the guard is a string comparison; the
 * cost of not having it is somebody's picture.
 */

/** `file:///a/b` and `/a/b` are the same place. */
function plain(path: string): string {
  return path.startsWith('file://') ? path.slice('file://'.length) : path
}

/**
 * Whether a path is inside one of this application's own directories.
 *
 * A prefix, plus the separator: without it `/data/cache-of-somebody-else`
 * would count as being under `/data/cache`.
 */
export function isOurs(path: string, roots: readonly string[]): boolean {
  const here = plain(path)
  return roots.some(root => {
    const at = plain(root).replace(/\/+$/, '')
    return at !== '' && (here === at || here.startsWith(`${at}/`))
  })
}

/**
 * Whether a file left in this application's cache is one of the two shapes a
 * picked photograph leaves.
 *
 * Only for the sweep that cleans devices which have been accumulating these
 * since before they were removed at source. Two shapes and no third: the
 * picker's own prefix, and the resizer's `<uuid>.JPEG`. Anything else in
 * that directory belongs to somebody else -- the web view, the notification
 * library, the HTTP cache -- and a sweep that guessed would be a sweep that
 * one day deletes something that mattered.
 */
export function isPickedLitter(name: string): boolean {
  if (name.startsWith('rn_image_picker_lib_temp_')) return true
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.JPEG$/.test(
    name,
  )
}

/** What the sweep needs, so a test can drive it without a disk. */
export interface Sweeping {
  /** The directories this application owns and may delete inside of. */
  readonly directories: readonly string[]
  /** The file names directly in a directory. Failure is the sweep's to eat. */
  readonly list: (directory: string) => Promise<readonly string[]>
  readonly forget: (path: string) => Promise<void>
}

/**
 * Removes what earlier versions left behind, once per launch.
 *
 * The fix at source stops new copies appearing; this is for the telephones
 * that have been accumulating them since before it existed -- the
 * demonstration Pixel among them. It answers how many it removed, which is
 * the only interesting thing about it and is worth one line in the log the
 * first time and nothing ever after.
 *
 * Every failure is eaten. A launch must not be slower, noisier or less
 * likely to succeed because a directory could not be listed: the worst case
 * is the file staying where it already was.
 */
export async function sweepPickedLitter(deps: Sweeping): Promise<number> {
  let swept = 0
  for (const directory of deps.directories) {
    let names: readonly string[]
    try {
      names = await deps.list(directory)
    } catch {
      continue
    }
    for (const name of names) {
      if (!isPickedLitter(name)) continue
      try {
        await deps.forget(`${directory}/${name}`)
        swept += 1
      } catch {
        // The next launch will find it again, which is the right amount of
        // insistence for a file nobody is waiting on.
      }
    }
  }
  return swept
}
