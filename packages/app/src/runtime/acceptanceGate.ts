import type { BackupAcceptedFrom } from './acceptBackup'
import type { BackupReplacedFrom, ReplaceFailedAt } from './replaceBackup'

/** Which gesture on the backup is running. */
export type BackupGesture = 'accept' | 'replace'

/** What a gesture on the backup hands the screen once it has settled. */
export type AcceptanceSettled =
  | {
      readonly show: 'key'
      readonly restoreKey: string
      /**
       * A replacement's only: whether the old key still opens the old backup,
       * because the version it opened would not go.
       */
      readonly oldStillOpens?: boolean
    }
  /** An acceptance that did not go through, a rejection included. */
  | { readonly show: 'failure' }
  /** A replacement that did not go through, and where it stopped. */
  | { readonly show: 'replacementFailure'; readonly failedAt: ReplaceFailedAt }

/**
 * The acceptance of the backup: one at a time, and what it produces handed to
 * whichever screen is mounted when it settles (#284).
 *
 * # ONE AT A TIME
 *
 * Found in review. A first tap failed on a slow network and the card said
 * « Réessayez »; nothing showed the retry running, so more taps started more
 * acceptances, each with its own key and its own version. They settle in any
 * order: the screen could end on one key while the keystore kept the other,
 * which the next launch turns on. The button is disabled as well, but only
 * once the screen draws again, and two taps can land before it does.
 *
 * # ONCE PER RUNTIME, NOT PER MOUNT
 *
 * Found in the second review. This lived in one mount of App. On Android 7 to
 * 11 a back press that reaches the system finishes the Activity, and a change
 * of font size or language recreates it, while JavaScript runs on: the
 * acceptance went through, its key went to a mount nobody sees, and the next
 * mount started with a fresh gate that let a second acceptance begin. So the
 * caller keeps one of these at module scope, and a mount only receives.
 *
 * # A KEY IS KEPT, A FAILURE IS NOT
 *
 * A key is kept until the key screen is done with it, and handed to every
 * screen that starts receiving before then, because it opens a backup that now
 * exists and nothing can show it later. Found in review: it was kept only while
 * no screen was mounted, but a mount lets go in its passive cleanup, after it
 * has stopped drawing, and a key that settled in between went to a screen that
 * could no longer show it.
 *
 * A failure with nobody to tell is let go. Whether a failure is said, and
 * where, is for the screen that receives it to decide, from what it shows now.
 */
export interface Acceptance {
  /**
   * Starts `accept`, unless a gesture on the backup is still running: then
   * nothing starts and this answers `false`. It opens again however the last
   * one ended, and a rejection counts as a failure.
   */
  readonly start: (accept: () => Promise<BackupAcceptedFrom>) => boolean
  /**
   * Starts `replace`, on the same terms as `start` and behind the same gate:
   * nothing starts while an acceptance or a replacement runs (#284). A second
   * tap on the confirmation started a second replacement, and one beside an
   * acceptance publishes a second version all the same.
   */
  readonly replace: (replace: () => Promise<BackupReplacedFrom>) => boolean
  /**
   * Which gesture is running, or `null`: `useSyncExternalStore`'s snapshot.
   * The gesture and not a flag, because the button of the one running says
   * so, and every other button only waits.
   */
  readonly running: () => BackupGesture | null
  /** Calls `changed` whenever `running` changes, and answers how to stop. */
  readonly subscribe: (changed: () => void) => () => void
  /**
   * Makes `settled` the one screen that receives what settles, and hands it at
   * once a key the key screen is not done with yet. Answers how to let go, and
   * letting go after another screen took over changes nothing.
   */
  readonly receive: (settled: (what: AcceptanceSettled) => void) => () => void
  /**
   * The key screen is done with the key: somebody said they put it away. No
   * screen is handed it again, and the copy kept here goes.
   */
  readonly keyDone: () => void
}

export function acceptance(): Acceptance {
  let running: BackupGesture | null = null
  let receiver: ((what: AcceptanceSettled) => void) | null = null
  /** The key the key screen is not done with yet. */
  let heldKey: Extract<AcceptanceSettled, { show: 'key' }> | null = null
  const watchers = new Set<() => void>()

  const setRunning = (now: BackupGesture | null) => {
    running = now
    for (const watcher of [...watchers]) watcher()
  }

  /**
   * One gesture behind the gate, whichever it is: what it settles goes to the
   * screen mounted, and a key is kept as well, for every screen that starts
   * receiving before the key screen is done with it.
   */
  const run = <Outcome>(
    name: BackupGesture,
    gesture: () => Promise<Outcome>,
    settles: (outcome: Outcome) => AcceptanceSettled,
    refused: AcceptanceSettled,
  ): boolean => {
    if (running !== null) return false
    setRunning(name)
    // On the next microtask, so a throw from the gesture itself settles like
    // a rejection instead of escaping with the gate shut.
    Promise.resolve()
      .then(gesture)
      .then(settles, (): AcceptanceSettled => refused)
      .then(what => {
        setRunning(null)
        // KEPT BEFORE IT IS HANDED, whoever receives it: the screen mounted
        // may be going away, and nothing here can tell.
        if (what.show === 'key') heldKey = what
        if (receiver !== null) receiver(what)
      })
    return true
  }

  return {
    start: accept =>
      run(
        'accept',
        accept,
        outcome =>
          outcome.accepted
            ? { show: 'key', restoreKey: outcome.restoreKey }
            : { show: 'failure' },
        { show: 'failure' },
      ),
    replace: replace =>
      run(
        'replace',
        replace,
        outcome =>
          outcome.replaced
            ? {
                show: 'key',
                restoreKey: outcome.restoreKey,
                oldStillOpens: !outcome.oldRetired,
              }
            : { show: 'replacementFailure', failedAt: outcome.failedAt },
        // `thrown`, as `replaceBackupFrom` answers a rejection: `replaceBackup`
        // lets a throw out only before the publish.
        { show: 'replacementFailure', failedAt: 'thrown' },
      ),
    running: () => running,
    subscribe: changed => {
      watchers.add(changed)
      return () => {
        watchers.delete(changed)
      }
    },
    receive: settled => {
      receiver = settled
      if (heldKey !== null) settled(heldKey)
      return () => {
        if (receiver === settled) receiver = null
      }
    },
    keyDone: () => {
      heldKey = null
    },
  }
}
