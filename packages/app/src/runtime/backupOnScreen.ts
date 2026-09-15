import type { BackupGesture } from './acceptanceGate'

/**
 * What the backup has on screen, for the rules that depend on it (#284).
 *
 * # ONE READING FOR TWO RULES
 *
 * A failure that settles is said only on the screen it is about, and Android's
 * back is held only while a backup surface is showing. Both read what is drawn
 * from the same state, so they are read here, once, and cannot disagree about
 * whether Sauvegarde is the screen somebody is looking at.
 */
export interface BackupOnScreen {
  /** The offer covers everything. */
  readonly offer: boolean
  /** The key screen covers everything. */
  readonly key: boolean
  /** Sauvegarde is the screen showing. */
  readonly backupScreen: boolean
}

/** App's own state, as far as the backup is concerned. */
export interface BackupDrawn {
  readonly backupPrompt: 'offering' | { readonly restoreKey: string } | null
  /** The conversation open, if any. */
  readonly openScope: string | null
  readonly tab: string
  /** Whether Sauvegarde is open in Réglages. */
  readonly backupOpen: boolean
  /** The offer to bring a past back, or the key being typed into it. */
  readonly restorePrompt: object | null
}

export function backupOnScreen(drawn: BackupDrawn): BackupOnScreen {
  return {
    offer: drawn.backupPrompt === 'offering',
    key: drawn.backupPrompt !== null && drawn.backupPrompt !== 'offering',
    backupScreen:
      drawn.openScope === null && drawn.tab === 'settings' && drawn.backupOpen,
  }
}

/**
 * Whether Android's back does nothing, for the backup's sake.
 *
 * Held while the offer or the key screen covers everything, whatever runs:
 * their buttons are the way out, and on Android 7 to 11 a back that reaches
 * the system finishes the Activity. Held on Sauvegarde while a gesture runs,
 * because that is the screen what comes of it is said on.
 *
 * Nowhere else. Found in review: back was held everywhere while an acceptance
 * ran, a conversation included, and a keychain write or an `enableKeyBackup`
 * that never settles left back dead until the process died.
 */
export function backupHoldsBack(
  on: BackupOnScreen,
  working: BackupGesture | null,
): boolean {
  return on.offer || on.key || (on.backupScreen && working !== null)
}
