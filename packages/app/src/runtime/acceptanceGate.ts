import type { BackupAcceptedFrom } from './acceptBackup'

/** What an acceptance hands the screen once it has settled. */
export type AcceptanceSettled =
  | { readonly show: 'key'; readonly restoreKey: string }
  | { readonly show: 'failure' }

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
 * A key that settles while no screen is mounted waits for the next one,
 * because it opens a backup that now exists and nothing can show it later. A
 * failure with nobody to tell is let go. Whether a failure is said, and where,
 * is for the screen that receives it to decide, from what it shows now.
 */
export interface Acceptance {
  /**
   * Starts `accept`, unless an acceptance is still running: then nothing
   * starts and this answers `false`. It opens again however the last one
   * ended, and a rejection counts as a failure.
   */
  readonly start: (accept: () => Promise<BackupAcceptedFrom>) => boolean
  /** Whether an acceptance is running: `useSyncExternalStore`'s snapshot. */
  readonly running: () => boolean
  /** Calls `changed` whenever `running` changes, and answers how to stop. */
  readonly subscribe: (changed: () => void) => () => void
  /**
   * Makes `settled` the one screen that receives what settles, and hands it at
   * once a key that settled while none was mounted. Answers how to let go, and
   * letting go after another screen took over changes nothing.
   */
  readonly receive: (settled: (what: AcceptanceSettled) => void) => () => void
}

export function acceptance(): Acceptance {
  let running = false
  let receiver: ((what: AcceptanceSettled) => void) | null = null
  let pendingKey: string | null = null
  const watchers = new Set<() => void>()

  const setRunning = (now: boolean) => {
    running = now
    for (const watcher of [...watchers]) watcher()
  }

  return {
    start: accept => {
      if (running) return false
      setRunning(true)
      // On the next microtask, so a throw from `accept` itself settles like a
      // rejection instead of escaping with the gate shut.
      Promise.resolve()
        .then(accept)
        .then(
          (outcome): AcceptanceSettled =>
            outcome.accepted
              ? { show: 'key', restoreKey: outcome.restoreKey }
              : { show: 'failure' },
          (): AcceptanceSettled => ({ show: 'failure' }),
        )
        .then(what => {
          setRunning(false)
          if (receiver !== null) receiver(what)
          else if (what.show === 'key') pendingKey = what.restoreKey
        })
      return true
    },
    running: () => running,
    subscribe: changed => {
      watchers.add(changed)
      return () => {
        watchers.delete(changed)
      }
    },
    receive: settled => {
      receiver = settled
      if (pendingKey !== null) {
        const restoreKey = pendingKey
        pendingKey = null
        settled({ show: 'key', restoreKey })
      }
      return () => {
        if (receiver === settled) receiver = null
      }
    },
  }
}
