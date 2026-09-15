import type { BackupAcceptedFrom } from './acceptBackup'

/** What a screen shows once an acceptance it started has settled. */
export type AcceptanceShown =
  | { readonly show: 'key'; readonly restoreKey: string }
  | { readonly show: 'failure' }

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
 * # IT SAYS WHAT TO SHOW
 *
 * So a screen holds one answer rather than conditions of its own, and the
 * rule that matters most is written where a test can hold it: a key that
 * exists is shown.
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
}

export function acceptanceGate(): AcceptanceGate {
  let running = false
  return {
    run: accept => {
      if (running) return null
      running = true
      return (async (): Promise<AcceptanceShown> => {
        try {
          const outcome = await accept()
          return outcome.accepted
            ? { show: 'key', restoreKey: outcome.restoreKey }
            : { show: 'failure' }
        } finally {
          running = false
        }
      })()
    },
  }
}
