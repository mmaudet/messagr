// The one module that names Firebase, and one of the two that name notifee
// (`showNotification.ts` is the other, and draws what this one registers for).
// Kept thin for the reason every other native seam here is: what it produces
// is a token, which `pusher.ts` turns into a registration and which the tests
// drive with a string.
import notifee, { AuthorizationStatus } from '@notifee/react-native'
import { getMessaging, getToken } from '@react-native-firebase/messaging'
import { PermissionsAndroid, Platform } from 'react-native'

import { applePushToken, type Unread } from './applePushToken'
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
 * # AND SINCE #334, NOTHING GOOGLE'S IS IN THE IPHONE AT ALL
 *
 * Firebase used to be what asked Apple for that token, because it was already
 * here and `getAPNSToken` was the two lines that read it. The sentence above
 * was true of the wake and false of the registration: reading
 * FirebaseMessaging 12.18.0 established that handing `FIRMessaging` an APNs
 * token makes its token manager ask Google for an installation identifier and
 * then for an FCM token carrying that APNs token
 * (`setAPNSToken:withUserInfo:`), and that `FirebaseMessagingAutoInitEnabled`
 * does not guard that path -- the key is read in three places, none of them
 * reachable from this application.
 *
 * So the twelve pods left the iOS target. The permission is notifee's, which
 * was already a dependency and answers the same four statuses out of the same
 * `UNAuthorizationStatus`; the token is `applePushToken.ts`, fifty lines of
 * Swift beside the AppDelegate. On Android the two Firebase packages stay,
 * unchanged, because FCM is the only way to wake an Android telephone.
 *
 * `setBackgroundMessageHandler` did not have to be replaced, which is what
 * made this small: `RNFBMessaging+AppDelegate.m` hands a push to JavaScript
 * only when it carries `gcm.message_id`, and a push sygnal sends to Apple
 * never does. It was already dead on iPhone before it was removed (#341), and
 * `index.js` now registers it on Android alone.
 *
 * # THE ONLY THING THAT MAY HAPPEN TO AN APNs TOKEN IS NOTHING
 *
 * It is registered as the `pushkey` exactly as it is read, and sygnal
 * forwards it as it stands (`convert_device_token_to_hex: false`, #325). A
 * token normalised, upper-cased or trimmed anywhere on this path is a
 * different `pushkey` for the same telephone. `applePushToken.ts` holds the
 * contract and refuses anything else; this function passes the string
 * through.
 *
 * # `applePushToken` CAN ANSWER `null`, AND WAITING ONE LAUNCH IS NOT ENOUGH
 *
 * Registration with Apple is asynchronous, and the token arrives after the
 * call that asked for it. This read it once and left the rest to "the next
 * launch asks again" -- which is true and was not sufficient. On a device
 * that loses the race every time, the pusher is never registered at all,
 * and the account keeps whatever pusher it had: on the tester's telephone,
 * sixteen `BadDeviceToken` in two hours for one token, and a build eleven
 * that never replaced it. They were read then as a sandbox token from an old
 * `development` entitlement. On 15 September 2026 every iOS push turned out
 * to be refused because sygnal base64-decoded a hexadecimal token (#325), so
 * that reading is not established. The race is real either way.
 *
 * So it waits, briefly, inside the launch that asked. Not for ever: a device
 * with no Apple to answer -- a simulator, an account with notifications
 * refused -- must not hold a launch open, and `null` after a few seconds is
 * still an honest "not yet".
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
      const settings = await notifee.requestPermission()
      if (
        settings.authorizationStatus !== AuthorizationStatus.AUTHORIZED &&
        settings.authorizationStatus !== AuthorizationStatus.PROVISIONAL
      ) {
        return { token: null, reason: 'notifications were not permitted' }
      }
    }

    if (Platform.OS === 'ios') {
      const apple = await applePushToken()
      return apple.token === null
        ? { token: null, reason: APPLE_SAID_NOTHING[apple.unread] }
        : { token: apple.token, road: 'ios' }
    }

    const token = await getToken(getMessaging())
    return token === ''
      ? { token: null, reason: 'no token' }
      : { token, road: 'android' }
  } catch (cause: unknown) {
    return { token: null, reason: getErrorMessage(cause) }
  }
}

/**
 * A sentence for each of the five silences, and five rather than one.
 *
 * `MESSAGR_PUSH_NOT_REGISTERED` and its `reason` are what a store build
 * writes about a telephone that will not be woken, and for a long time every
 * way of not having a token wrote the same sentence: "Apple has not answered
 * with a token yet". That sentence is true of one of the five. A build
 * carrying no native half at all, a registration Apple refused, and a token
 * of a shape that may not be registered each read as patience, and patience
 * is the one thing nobody investigates.
 *
 * Each reads as words, which is what the trace may carry: no digit, no sigil,
 * nothing an identifier is made of (`log.ts`).
 */
const APPLE_SAID_NOTHING: Record<Unread, string> = {
  noAnswer: 'Apple has not answered with a token yet',
  noModule: 'this build carries nothing that can ask Apple',
  appleRefused: 'Apple refused to register this device',
  notHex: 'Apple answered a token that is not upper case hexadecimal',
  threw: 'asking Apple threw',
}
