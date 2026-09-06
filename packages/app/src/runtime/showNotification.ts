// The one module that names `@notifee/react-native`. See `pushDevice.ts` for
// the rule; what this adapts is `notifying.ts`, which decides what a
// notification says and is tested without a device.
import notifee, { AndroidImportance, EventType } from '@notifee/react-native'

import { t } from '../copy'
import { scopeOfPress, type Notification } from './notifying'

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
 * What a tap does, wired once at launch.
 *
 * Three ways in, and a notification tapped from a cold start arrives by the
 * third: `getInitialNotification` is the only one that fires when the press
 * is what started the process, and a handler that registered only the other
 * two would work everywhere except the case people actually complain about.
 */
export function whenNotificationPressed(
  open: (scope: string | null) => void,
): () => void {
  notifee
    .getInitialNotification()
    .then(initial => {
      if (initial !== null) open(scopeOfPress(initial.notification.id))
    })
    .catch(() => {
      // A launch is not worth losing over a notification that may not exist.
    })

  const stopForeground = notifee.onForegroundEvent(({ type, detail }) => {
    if (type === EventType.PRESS) open(scopeOfPress(detail.notification?.id))
  })
  notifee.onBackgroundEvent(async ({ type, detail }) => {
    if (type === EventType.PRESS) open(scopeOfPress(detail.notification?.id))
  })
  return stopForeground
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
    android: { channelId, pressAction: { id: 'default' } },
  })
}
