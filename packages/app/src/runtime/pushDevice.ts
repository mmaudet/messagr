// One of the two modules that name Firebase, kept thin for the reason every
// other native seam here is: nothing worth unit-testing lives in it. What it
// produces is a token, which `pusher.ts` turns into a registration and which
// the tests drive with a string.
import {
  AuthorizationStatus,
  getMessaging,
  getToken,
  requestPermission,
} from '@react-native-firebase/messaging'
import { PermissionsAndroid, Platform } from 'react-native'

import { getErrorMessage } from './errors'

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
 * # An empty token is an ordinary answer
 *
 * A device without Google Play services -- an emulator image, a de-Googled
 * phone -- has no token and never will. `pusher.ts` treats that as "nothing to
 * register" rather than as an error, because for those devices it is simply
 * true: they will not be woken, and the application still works when open.
 * This is a product that should run on a phone with no Google on it.
 */
export async function pushTokenForThisDevice(): Promise<
  { readonly token: string } | { readonly token: null; readonly reason: string }
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

    const token = await getToken(getMessaging())
    return token === '' ? { token: null, reason: 'no token' } : { token }
  } catch (cause: unknown) {
    return { token: null, reason: getErrorMessage(cause) }
  }
}
