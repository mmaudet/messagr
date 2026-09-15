import type { BackupAcceptedFrom } from './acceptBackup'

/** What a screen shows once an acceptance it started has settled. */
export type AcceptanceShown =
  | { readonly show: 'key'; readonly restoreKey: string }
  | { readonly show: 'failure' }
  | { readonly show: 'nothing' }

/**
 * One acceptance of the backup at a time (#284).
 *
 * # WHY
 *
 * Found in review. A first tap failed on a slow network and the card said
 * « Réessayez »; nothing showed the retry running, so more taps started more
 * acceptances. Each makes its own key and its own version, and they settle in
 * any order: the screen could end on one key while the keystore kept the
 * other, which the next launch turns on. From the offer, a second success
 * could also swap the key under somebody copying it.
 *
 * # A GATE, AND NOT ONLY A DISABLED BUTTON
 *
 * The button is disabled too, but only once the screen draws again, and two
 * taps can land before it does. The gate answers the second one at once.
 *
 * # A FAILURE IS SAID WHERE IT WAS ASKED FOR, A KEY WHEREVER
 *
 * Also found in review. A failure was set whenever its acceptance settled, so
 * leaving Sauvegarde while one ran brought back a card saying « Réessayez »
 * before any tap. Each run takes a number, and leaving moves past it: the
 * failure of an attempt left behind is not said. A key is shown whatever
 * happened since, because it opens a backup that now exists and nothing can
 * show it later.
 *
 * # IT SAYS WHAT TO SHOW
 *
 * So a screen holds one answer rather than conditions of its own, and both
 * rules are written where a test can hold them.
 */
export interface AcceptanceGate {
  /**
   * Runs `accept`, unless an acceptance is still running: then nothing runs
   * and this answers `null`. The gate opens again however the last one ended,
   * a rejection included.
   */
  readonly run: (
    accept: () => Promise<BackupAcceptedFrom>,
  ) => Promise<AcceptanceShown> | null
  /**
   * The screen the running acceptance was started from has been left: its
   * failure, once it settles, is not said, and its key still is. An
   * acceptance started afterwards is a new attempt, whose failure is said.
   */
  readonly forget: () => void
}

export function acceptanceGate(): AcceptanceGate {
  let running = false
  // The attempt a failure may still be said for. A run takes the next
  // number, and leaving takes one more, which no run holds.
  let latest = 0
  return {
    run: accept => {
      if (running) return null
      running = true
      latest += 1
      const attempt = latest
      return (async (): Promise<AcceptanceShown> => {
        try {
          const outcome = await accept()
          if (outcome.accepted) {
            return { show: 'key', restoreKey: outcome.restoreKey }
          }
          return attempt === latest ? { show: 'failure' } : { show: 'nothing' }
        } finally {
          running = false
        }
      })()
    },
    forget: () => {
      latest += 1
    },
  }
}
