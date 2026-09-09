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
/**
 * A ringing call, as a notification.
 *
 * # THE IDENTIFIER SAYS IT IS A CALL, BECAUSE THE PRESS HAS TO KNOW
 *
 * A press on a message notification opens the conversation; a press on this
 * one has to land in the call, and by the time it is read there is nothing
 * left but the identifier. Prefixing it is what `answeredCallOfPress` reads
 * back, and it keeps the two kinds from colliding on a conversation that has
 * both.
 */
const RINGING = 'ringing:'

export function ringingNotification(
  scope: string,
  shown: string,
  /**
   * Whether the far end offered a picture.
   *
   * On a locked screen this notification is the first thing anybody sees,
   * and answering from it turns on whatever the call asked for. Somebody who
   * is not told that is somebody whose camera lights up unannounced.
   * `lookForWhatArrived.ts` reads it from the offer, since Matrix version 1
   * carries the answer nowhere else.
   */
  video = false,
): Notification {
  return {
    id: `${RINGING}${scope}`,
    title: shown,
    body: video ? t('notify_ringing_video_body') : t('notify_ringing_body'),
  }
}

/**
 * A call that rang and that nobody answered.
 *
 * The SAME identifier as the ring it replaces: a telephone that went quiet
 * with no explanation is what this exists to stop, and a second notification
 * under the first would say there had been two calls.
 *
 * The hour is the reader's own. Minutes are padded here rather than in a
 * copy template, exactly as `ConversationList.tsx` argues: two digits is not
 * a question of language while the separator between them is.
 *
 * It is what makes the line worth keeping once the ringing has stopped --
 * "appel manqué" alone is a fact with no when.
 */
export function missedNotification(
  scope: string,
  shown: string,
  at: number,
): Notification {
  const then = new Date(at)
  return {
    id: `${RINGING}${scope}`,
    title: shown,
    body: t(
      'notify_missed %1$d %2$d',
      then.getHours(),
      String(then.getMinutes()).padStart(2, '0'),
    ),
  }
}

/**
 * The conversation a ringing notification was about, or `null` when the
 * press was not one.
 */
export function ringingOfPress(id: string | undefined): string | null {
  return id !== undefined && id.startsWith(RINGING)
    ? id.slice(RINGING.length)
    : null
}

export function scopeOfPress(id: string | undefined): string | null {
  if (id === undefined || id === BLIND_ID) return null
  // A ringing press is not a conversation press. It carries the same scope
  // and means something else entirely, and the caller that wants the
  // conversation must not be handed one for a call it never answered.
  return ringingOfPress(id) === null ? id : null
}
