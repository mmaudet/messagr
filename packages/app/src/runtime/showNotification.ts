// The one module that names `@notifee/react-native`. See `pushDevice.ts` for
// the rule; what this adapts is `notifying.ts`, which decides what a
// notification says and is tested without a device.
import notifee, {
  AndroidCategory,
  AndroidImportance,
  EventType,
} from '@notifee/react-native'

import { t } from '../copy'
import { color } from '../design/tokens'
import { logEvent } from './log'
import { ringingOfPress, scopeOfPress, type Notification } from './notifying'

/**
 * Drawing a notification.
 *
 * # Why the application draws it rather than the platform
 *
 * The push that woke this device is a **data message** carrying nothing --
 * that is the whole point of the gateway. A data message does not display
 * itself: Android shows nothing for it, which is exactly what makes the
 * design possible. The application decides what to say, after deciding what
 * it can honestly say.
 *
 * A `notification` message would have displayed itself, with whatever text
 * the server put in it, without waking the application at all. That is the
 * ordinary way to do this and it is the one thing this product cannot do.
 */

/** Android needs a channel before anything can be shown on it. */
const CHANNEL = 'messages'

/**
 * A SECOND CHANNEL, BECAUSE A CALL IS NOT A MESSAGE.
 *
 * Not a louder setting on the first one: a channel is what a person turns
 * off, and somebody who silences message notifications has not said they
 * want to miss calls. Two channels are two switches, which is the only way
 * that distinction can be made on Android at all.
 */
/**
 * The ringing channel, and why it is not called `calls` any more.
 *
 * A channel's settings are fixed at creation: Android accepts a new name and
 * a new description afterwards and nothing else, and recreating an id it has
 * seen before restores what it had. `calls` was created without `bypassDnd`
 * on every device that has run this application, so it can never acquire it
 * -- the only way to a channel that rings through Do Not Disturb is a channel
 * the system has not met.
 *
 * `LEGACY_RINGING_CHANNEL` is removed when this one is made, so nobody is
 * left with two entries called « Appels » in the system's list.
 */
const RINGING_CHANNEL = 'ringing'
const LEGACY_RINGING_CHANNEL = 'calls'

/** What a press on a ringing notification asked for. */
export const ANSWER = 'answer'
export const DECLINE = 'decline'

/**
 * What a tap does, wired once at launch.
 *
 * Three ways in, and a notification tapped from a cold start arrives by the
 * third: `getInitialNotification` is the only one that fires when the press
 * is what started the process, and a handler that registered only the other
 * two would work everywhere except the case people actually complain about.
 */
export function whenNotificationPressed(
  open: (scope: string | null) => void,
  /**
   * What a press on a ringing telephone asked for.
   *
   * Separate from `open`, because it is a different destination: a
   * conversation is a screen somebody navigates to, and a call is something
   * they just said yes or no to. Absent while nothing can answer one.
   */
  answered?: (call: {
    readonly scope: string
    readonly answered: boolean
  }) => void,
): () => void {
  // A PRESS THAT ANSWERED A CALL IS NOT A PRESS THAT OPENED A CONVERSATION,
  // and both arrive here through the same three doors.
  const route = (id: string | undefined, action: string | undefined): void => {
    const call = answeredCallOfPress(id, action)
    if (call !== null) {
      answered?.(call)
      return
    }
    open(scopeOfPress(id))
  }

  notifee
    .getInitialNotification()
    .then(initial => {
      if (initial !== null) {
        route(initial.notification.id, initial.pressAction?.id)
      }
    })
    .catch(() => {
      // A launch is not worth losing over a notification that may not exist.
    })

  return notifee.onForegroundEvent(({ type, detail }) => {
    if (type === EventType.PRESS || type === EventType.ACTION_PRESS) {
      route(detail.notification?.id, detail.pressAction?.id)
    }
  })
}

/**
 * The background half, which has to be registered at module scope.
 *
 * notifee says so on the device rather than in a type: *"no background event
 * handler has been set"*, logged the first time a notification is drawn from
 * a headless context. A handler registered inside a component does not exist
 * when there is no component -- which is every case this one is for.
 *
 * It records the tap rather than acting on it. There is no navigation in a
 * headless process, and the application that starts afterwards reads the same
 * notification through `getInitialNotification`. Answering here and there
 * both would open the conversation twice.
 */
export function rememberBackgroundPresses(
  /**
   * Refuses the call in a conversation, from a process with no screen.
   *
   * Injected rather than imported, because this module is the notifee
   * adapter and refusing a call is a session, a crypto machine and an
   * encrypted send -- everything this file exists not to know about.
   */
  refuse?: (scope: string) => Promise<unknown>,
): void {
  notifee.onBackgroundEvent(async ({ type, detail }) => {
    // THE ONLY ACCOUNT ANYBODY GETS OF A PRESS ON A LOCKED SCREEN.
    //
    // There is no screen here and the process is often torn down a second
    // later. A press that did nothing and a press that never arrived look
    // identical without this line, which is exactly where the first hour of
    // debugging this went.
    logEvent('info', 'MESSAGR_PRESSED', {
      type,
      action: detail.pressAction?.id ?? null,
      id: detail.notification?.id ?? null,
    })

    // REFUSING IS THE ONE PRESS THAT MUST NOT OPEN THE APPLICATION.
    //
    // Everything else is remembered and read again by the application that
    // starts afterwards, through `getInitialNotification`. Saying no on a
    // locked screen is a person deciding not to be interrupted, and opening
    // the interface at them is the opposite of what they pressed.
    if (type === EventType.ACTION_PRESS && detail.pressAction?.id === DECLINE) {
      const scope = ringingOfPress(detail.notification?.id)
      if (scope !== null) {
        await notifee.cancelNotification(detail.notification?.id ?? '')
        try {
          await refuse?.(scope)
        } catch {
          // Nothing to report to. The notification is already down, which is
          // the half the person pressing can see.
        }
      }
      return
    }
    // Nothing to do, and registering is the point: without a handler notifee
    // warns and the press is dropped before the application can read it.
  })
}

export async function drawNotification(
  notification: Notification,
): Promise<void> {
  const channelId = await notifee.createChannel({
    id: CHANNEL,
    name: t('notify_channel'),
    // High: a message is why somebody installed this. Not `MAX`, which is
    // reserved for something that interrupts -- a call, when there are calls.
    importance: AndroidImportance.HIGH,
  })

  await notifee.displayNotification({
    id: notification.id,
    title: notification.title,
    body: notification.body,
    android: {
      channelId,
      pressAction: { id: 'default' },
      // THE MARK, NOT THE LAUNCHER ICON.
      //
      // Android renders a small icon as an alpha mask: everything opaque
      // becomes white. The launcher icon is opaque throughout, so the status
      // bar drew a plain white square -- reported from a lock screen, where
      // it was the only thing on it. `ic_notification` is the identity's own
      // monogram, whose holes are the drawing.
      smallIcon: 'ic_notification',
      // What the system tints the mask with, and the badge behind it.
      color: color.brand.green500,
    },
  })
}

/**
 * A telephone ringing, on a screen nobody has unlocked.
 *
 * # WHAT MAKES IT INTERRUPT IS NOT A HIGHER NUMBER
 *
 * `drawNotification` above reserved `MAX` for "something that interrupts --
 * a call, when there are calls". There are calls, and there is no `MAX`:
 * notifee's `AndroidImportance` stops at `HIGH`, because Android's own
 * `IMPORTANCE_MAX` is documented as unused. Read out of the library's
 * enumeration rather than assumed, and the comment above is now wrong about
 * the mechanism while being right about the intent.
 *
 * What actually separates a ringing telephone from a message here is three
 * things that have nothing to do with importance: its own channel,
 * `category: CALL`, and the full-screen intent below.
 *
 * # THE FULL-SCREEN INTENT IS THE WHOLE FEATURE
 *
 * A heads-up notification on a locked screen is a line somebody has to
 * notice within ninety seconds. `fullScreenAction` is what makes Android
 * light the screen and put the application in front of them instead, which
 * is what a ringing telephone does and what #89 asks for. It needs
 * `USE_FULL_SCREEN_INTENT` in the manifest; Android 14 grants that
 * permission by installation only to applications that are calling or
 * alarm applications, which this now is.
 *
 * If the platform refuses it -- an older Android, a manufacturer that
 * ignores it -- the notification is still drawn, still in the call
 * category, still with its two actions. That is the degraded case and it is
 * a usable one.
 *
 * # ONGOING, SO IT CANNOT BE SWIPED INTO SILENCE
 *
 * A call that is ringing is not a line to dismiss. It goes when the call
 * goes -- answered, declined, or expired -- and until then swiping it away
 * would leave somebody waiting on a telephone that stopped saying so.
 */
/**
 * The channel a ringing telephone posts on, made to bypass Do Not Disturb.
 *
 * # THE FLAG ONLY TAKES IF THE PERSON HAS SAID SO
 *
 * `bypassDnd` is not a thing an application grants itself: Android accepts
 * it only from an application holding notification-policy access, which is a
 * switch in the system settings. Without it the channel is created exactly
 * as before -- and this asks again on the next call, because the switch may
 * have been thrown in between. `Settings.tsx` carries the row that leads to
 * that screen.
 *
 * # AND A CHANNEL THAT DID NOT GET IT IS THROWN AWAY, ONCE PER LAUNCH
 *
 * Channel settings are fixed at creation, so a channel made before the
 * access was granted keeps ringing into silence for ever. Deleting and
 * remaking it is the only way to pick up the change. At most once per
 * launch: any more would reset, on every call, whatever the person had
 * chosen for that channel themselves.
 */
let remadeThisLaunch = false

async function ringingChannel(): Promise<string> {
  // The old one, whose id can never bypass anything. Removing it is cheap and
  // idempotent, and it stops the system's list showing two « Appels ».
  await notifee.deleteChannel(LEGACY_RINGING_CHANNEL).catch(() => {})

  if (!remadeThisLaunch) {
    remadeThisLaunch = true
    const held = await notifee.getChannel(RINGING_CHANNEL).catch(() => null)
    if (held !== null && held.bypassDnd !== true) {
      await notifee.deleteChannel(RINGING_CHANNEL).catch(() => {})
    }
  }

  return notifee.createChannel({
    id: RINGING_CHANNEL,
    name: t('notify_ringing_channel'),
    importance: AndroidImportance.HIGH,
    bypassDnd: true,
  })
}

export async function ringNotification(
  notification: Notification,
): Promise<void> {
  const channelId = await ringingChannel()

  await notifee.displayNotification({
    id: notification.id,
    title: notification.title,
    body: notification.body,
    android: {
      channelId,
      // What tells Android this is a telephone call rather than a message:
      // it is what puts the notification above the others and keeps it out
      // of the summarised group.
      //
      // IT DOES NOT GET PAST DO NOT DISTURB, and this comment used to say it
      // did -- that the category made the mode's "allow calls" exception
      // apply. Measured false on the demonstration Pixel during the first
      // real call between two people: `intercepted: 0|eu.messagr|…|
      // new:!priority`, six times in seventy-six seconds. That exception is
      // telephony's, filtered by contact; a notification gets through only
      // on a channel marked `bypassDnd`, which is what `ringingChannel`
      // asks for.
      category: AndroidCategory.CALL,
      importance: AndroidImportance.HIGH,
      ongoing: true,
      autoCancel: false,
      fullScreenAction: { id: 'default' },
      pressAction: { id: 'default' },
      actions: [
        // ANSWERING OPENS THE APPLICATION, AND SAYING SO IS THE WHOLE POINT
        // OF `launchActivity`.
        //
        // Without it a notification action fires the background handler and
        // nothing else: no activity, no `getInitialNotification`, no call to
        // land in. Reported from the demonstration Pixel -- "quand je clique
        // sur Répondre ou Refuser, rien ne se passe" -- with two of these
        // notifications behind it and four headless tasks in the log that
        // had nowhere to send anybody.
        //
        // The body's own `pressAction` needs no such flag, and does not have
        // one: notifee opens the application for a press on the notification
        // itself. An action is the case that has to ask.
        {
          title: t('notify_answer'),
          pressAction: { id: ANSWER, launchActivity: 'default' },
        },
        // REFUSING DELIBERATELY DOES NOT. Saying no on a locked screen is
        // somebody deciding not to be interrupted; opening the interface at
        // them is the opposite of what they pressed. It is handled where it
        // lands, in `rememberBackgroundPresses`.
        { title: t('notify_decline'), pressAction: { id: DECLINE } },
      ],
      smallIcon: 'ic_notification',
      color: color.brand.green500,
    },
  })
}

/** Takes a ringing notification down, whatever became of the call. */
export async function stopRinging(scope: string): Promise<void> {
  await notifee.cancelNotification(`ringing:${scope}`)
}

/**
 * What a press on a ringing notification asked for, and about which
 * conversation. `null` when the press was not one.
 */
export function answeredCallOfPress(
  id: string | undefined,
  action: string | undefined,
): { readonly scope: string; readonly answered: boolean } | null {
  const scope = ringingOfPress(id)
  if (scope === null) return null
  // A press on the body is a press on "answer": somebody who taps a ringing
  // telephone is picking it up. Only the explicit second action declines,
  // which is the arrangement every telephone has.
  return { scope, answered: action !== DECLINE }
}
