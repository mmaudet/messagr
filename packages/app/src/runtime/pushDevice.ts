// One of the two modules that name Firebase, kept thin for the reason every
// other native seam here is: nothing worth unit-testing lives in it. What it
// produces is a token, which `pusher.ts` turns into a registration and which
// the tests drive with a string.
import {
  AuthorizationStatus,
  getAPNSToken,
  getMessaging,
  getToken,
  registerDeviceForRemoteMessages,
  requestPermission,
} from '@react-native-firebase/messaging'
import { PermissionsAndroid, Platform } from 'react-native'

import { getErrorMessage } from './errors'
import type { Road } from './pusher'

/**
 * This device's push token, and the permission that has to come first.
 *
 * # Asking, and what a refusal means
 *
 * Android 13 and later require `POST_NOTIFICATIONS` before anything can be
 * shown. A refusal is a decision, not a failure: the application keeps
 * working and stops being able to tell somebody a message arrived while it is
 * closed. Nothing here retries, and nothing nags.
 *
 * # Two roads, and iOS takes the direct one
 *
 * Android has no choice: waking an Android phone goes through Firebase. iOS
 * does have one, and takes Apple's own channel, so what comes back there is
 * an **APNs** token rather than an FCM one. An APNs key belongs to a team
 * rather than to an application, and this team already has one -- so routing
 * iPhones through Google as well would have bought nothing and handed over a
 * device token and the timing of every wake.
 *
 * Firebase is still what asks Apple for the token, because it is already
 * here and `getAPNSToken` is the two lines that read it. Nothing about the
 * push then goes near Google: sygnal talks to Apple, and the `app_id` in the
 * pusher says so (`pusher.ts`).
 *
 * # `getAPNSToken` can answer `null` and not be wrong
 *
 * Registration with Apple is asynchronous, and the token arrives after the
 * call that asked for it. A `null` here is "not yet", not "never" -- and the
 * next launch asks again, which is why the pusher is registered on every
 * launch rather than once.
 *
 * # An empty token is an ordinary answer
 *
 * A device without Google Play services -- an emulator image, a de-Googled
 * phone -- has no token and never will. `pusher.ts` treats that as "nothing to
 * register" rather than as an error, because for those devices it is simply
 * true: they will not be woken, and the application still works when open.
 * This is a product that should run on a phone with no Google on it.
 */
export async function pushTokenForThisDevice(): Promise<
  | { readonly token: string; readonly road: Road }
  | { readonly token: null; readonly reason: string }
> {
  try {
    if (Platform.OS === 'android' && Platform.Version >= 33) {
      const answer = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
      )
      if (answer !== PermissionsAndroid.RESULTS.GRANTED) {
        return { token: null, reason: 'notifications were not permitted' }
      }
    }

    // iOS asks its own way, and answers the same question. Provisional
    // counts: it is Apple's "quietly, without asking first", which is a yes
    // with a lower voice and not a refusal.
    if (Platform.OS === 'ios') {
      const settings = await requestPermission(getMessaging())
      if (
        settings !== AuthorizationStatus.AUTHORIZED &&
        settings !== AuthorizationStatus.PROVISIONAL
      ) {
        return { token: null, reason: 'notifications were not permitted' }
      }
    }

    if (Platform.OS === 'ios') {
      // Asked for explicitly. Without it the APNs token is never requested
      // and this reads `null` for ever rather than "not yet".
      await registerDeviceForRemoteMessages(getMessaging())
      const apns = await getAPNSToken(getMessaging())
      return apns === null || apns === ''
        ? { token: null, reason: 'Apple has not answered with a token yet' }
        : { token: apns, road: 'ios' }
    }

    const token = await getToken(getMessaging())
    return token === ''
      ? { token: null, reason: 'no token' }
      : { token, road: 'android' }
  } catch (cause: unknown) {
    return { token: null, reason: getErrorMessage(cause) }
  }
}
