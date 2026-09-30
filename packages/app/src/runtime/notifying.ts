import { t } from '../copy'
import {
  scopesWithTheBlocked,
  type ConversationSummary,
} from './conversationList'

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
  /**
   * The account it shows: whose message arrived last, or who is calling.
   * Carried unseen, and only on the device that drew it: what a block takes
   * it down by, and nothing else (#472, `showingTheBlocked`). Absent on the
   * blind one, which shows nobody.
   */
  readonly from?: string
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
  /** Whose message it shows (`Notification.from`). */
  from?: string,
): Notification {
  return { id: scope, title: shown, body: preview, ...fromOf(from) }
}

/**
 * What a notification carries unseen besides what it says: the account it
 * shows, in its data, and only on the device that drew it (#472). The
 * platform hands it back with the notification, which is what a block takes
 * it down by (`showingTheBlocked`). Nothing for the blind one.
 */
export function dataOf(notification: Notification): {
  readonly data?: { readonly from: string }
} {
  return notification.from === undefined
    ? {}
    : { data: { from: notification.from } }
}

/**
 * A notification the platform still shows, as notifee lists it: its
 * identifier, beside or inside the notification, and the data it was drawn
 * with.
 */
export interface Displayed {
  readonly id?: string
  readonly notification: {
    readonly id?: string
    readonly data?: Readonly<Record<string, unknown>>
  }
}

/**
 * The ones among `displayed` that show an account now blocked (#472), by
 * their identifier: a message it wrote, the last to arrive in its
 * conversation, or a call it placed, as their data says (`dataOf`). Only
 * those: a conversation of more than two whose latest message is somebody
 * else's keeps its notification, and one that says nothing of whose it
 * shows -- drawn by an earlier version, or the blind one -- is not guessed
 * at.
 */
export function showingTheBlocked(
  displayed: readonly Displayed[],
  blocked: ReadonlySet<string>,
): readonly string[] {
  return displayed.flatMap(one => {
    const from = one.notification.data?.from
    const id = one.id ?? one.notification.id
    return typeof from === 'string' && blocked.has(from) && id !== undefined
      ? [id]
      : []
  })
}

/**
 * The notifications this application drew, as the platform holds them:
 * listed, and taken down by identifier. `showNotification.ts` hands notifee's.
 */
export interface Drawn {
  readonly displayed: () => Promise<readonly Displayed[]>
  readonly cancel: (id: string) => Promise<void>
}

/**
 * Takes down what a block takes (#469, #472, #498): every notification of a
 * conversation with an account newly blocked, whoever it shows -- a tap on
 * one would open what the block took away --, and, in every other
 * conversation, those that show that account. Never throws: a notification
 * that will not come down is not worth a block that says it failed.
 *
 * THOSE OF THE CONVERSATION BY THEIR KEY, and so even when the platform will
 * not list what it shows: a conversation's message notification is keyed by
 * it (`readNotification`), and its call's by the same with a prefix
 * (`ringingNotification`).
 */
export async function takeDownWhatTheBlockTakes(
  drawn: Drawn,
  rows: readonly ConversationSummary[],
  newly: ReadonlySet<string>,
): Promise<void> {
  if (newly.size === 0) return
  const down = new Set<string>()
  const takeDown = async (id: string) => {
    if (down.has(id)) return
    down.add(id)
    await drawn.cancel(id).catch(() => undefined)
  }
  for (const scope of scopesWithTheBlocked(rows, newly)) {
    await takeDown(scope)
    await takeDown(`${RINGING}${scope}`)
  }
  const displayed = await drawn.displayed().catch(() => [])
  for (const id of showingTheBlocked(displayed, newly)) await takeDown(id)
}

/**
 * The conversation a tap on a notification opens (#469, #498): the one it
 * was about (`scopeOfPress`), never one with a blocked account. Drawn before
 * the block, on this device or another, it lands on the list, where that
 * conversation is not. `null` for the list.
 */
export function openedByTheTap(
  scope: string | null,
  rows: readonly ConversationSummary[],
  blocked: ReadonlySet<string>,
): string | null {
  if (scope === null) return null
  return scopesWithTheBlocked(rows, blocked).includes(scope) ? null : scope
}

/** `from`, when there is one to carry. */
function fromOf(from: string | undefined): { readonly from?: string } {
  return from === undefined ? {} : { from }
}

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
  /** Who is calling (`Notification.from`). */
  from?: string,
): Notification {
  return {
    id: `${RINGING}${scope}`,
    title: shown,
    body: video ? t('notify_ringing_video_body') : t('notify_ringing_body'),
    ...fromOf(from),
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
  /** Who called (`Notification.from`). */
  from?: string,
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
    ...fromOf(from),
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

/** What a Matrix room identifier begins with, and nothing else does. */
const ROOM = '!'

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
 *
 * # AND `null` FOR AN IDENTIFIER THIS APPLICATION NEVER CHOSE (#341)
 *
 * Since ADR-0009's visible fallback shipped, a notification can be drawn by
 * iOS itself, from the `aps.alert` the push gateway sends -- on a phone that
 * is killed and locked, which is the case the wake cannot reach and the whole
 * reason the fallback exists. Its identifier is then Apple's own, and this
 * read every identifier as a conversation to open.
 *
 * The ADR asks for both halves in the same breath: *"A notification the user
 * taps must land somewhere sensible even when the wake failed and the
 * application does not yet know what arrived."* Somewhere sensible is the
 * list. A conversation is a Matrix room, whose identifier begins with `!`;
 * anything else is not one, and opening a conversation named after a system
 * identifier is a screen for a conversation nobody has.
 */
export function scopeOfPress(id: string | undefined): string | null {
  if (id === undefined || id === BLIND_ID) return null
  // A ringing press is not a conversation press. It carries the same scope
  // and means something else entirely, and the caller that wants the
  // conversation must not be handed one for a call it never answered.
  if (ringingOfPress(id) !== null) return null
  // Named rather than merely not-blind: see the note above. Everything this
  // application keys a notification by is a room, and everything else that
  // can arrive here was chosen by the platform.
  return id.startsWith(ROOM) ? id : null
}
