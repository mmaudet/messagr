import { t } from '../copy'

/**
 * What a notification says when nothing may be said.
 *
 * # It names nobody, and that is not a limitation
 *
 * The push that woke this device carried no sender, no conversation and no
 * content (`services/invitations`, `handlers::wake`). So a notification drawn
 * without opening the crypto store can only say that something arrived — and
 * that is the honest thing to say, not a degraded one. A notification naming a
 * sender would mean the name had crossed Firebase.
 *
 * # The two kinds, and why the quiet one exists
 *
 * `blind` is what a wake produces before anything is decrypted. `read` is what
 * replaces it once the device has synced and opened the message: same
 * identifier, so the platform replaces rather than stacks, and a person sees
 * one notification that fills itself in rather than two.
 *
 * A device that cannot open its store — screen never unlocked since boot,
 * ADR-0008 — stays on `blind` for good, and that is the design working. It
 * says something arrived. It does not guess.
 */

export interface Notification {
  /** Replaces any notification with the same one. */
  readonly id: string
  readonly title: string
  readonly body: string
}

/**
 * One identifier per conversation, so a second message replaces the first
 * rather than stacking. A person with eleven unread messages wants one
 * notification, not eleven.
 *
 * `blind` has no conversation to key by, so it keys by nothing: every blind
 * wake collapses onto one notification, which is right — they all say the
 * same thing.
 */
export const BLIND_ID = 'blind'

export function blindNotification(): Notification {
  return {
    id: BLIND_ID,
    title: t('notify_blind_title'),
    body: t('notify_blind_body'),
  }
}

export function readNotification(
  scope: string,
  shown: string,
  preview: string,
): Notification {
  return { id: scope, title: shown, body: preview }
}

/**
 * Which conversation a notification was about, when a person taps it.
 *
 * # The identifier is the conversation, and that is not a coincidence
 *
 * `readNotification` keys by the scope so a second message replaces the
 * first rather than stacking. The same key is what routes the tap: there is
 * no separate payload to carry, and nothing to keep in step.
 *
 * `null` for the blind notification, which has no conversation to open --
 * nothing that woke this device said which one. Tapping it opens the
 * application, which then syncs and shows the list with something waiting.
 * That is the honest destination, not a fallback.
 */
export function scopeOfPress(id: string | undefined): string | null {
  return id === undefined || id === BLIND_ID ? null : id
}
