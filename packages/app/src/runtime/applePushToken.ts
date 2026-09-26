import { TurboModuleRegistry } from 'react-native'

import { logEvent } from './log'

/**
 * This iPhone's APNs token, asked of UIKit and read back from it.
 *
 * # WHY THERE IS A NATIVE MODULE HERE AND THERE WAS NOT BEFORE
 *
 * Firebase used to be in this build for exactly two lines: it asked Apple for
 * the token and it handed the answer back. Nothing about the wake went near
 * Google -- sygnal talks to Apple directly, and `pusher.ts` says so -- but
 * reading FirebaseMessaging 12.18.0 established that the *registration* did:
 * the APNs token handed to `FIRMessaging` makes its token manager ask Google
 * for an installation identifier and then for an FCM token carrying that APNs
 * token, from `setAPNSToken:withUserInfo:`, which consults no setting this
 * repository can write. #334.
 *
 * So the twelve pods are gone and this asks Apple itself. `MessagrApplePush`
 * is fifty lines of Swift beside the AppDelegate: it asks
 * `registerForRemoteNotifications`, holds what Apple answers, and hands it
 * over formatted the one way it may be.
 *
 * # THE FORMAT IS A CONTRACT, NOT A DETAIL
 *
 * Upper-case hexadecimal, no separator, two characters per byte -- what
 * `%02.2hhX` produces, which is what `RNFBMessagingSerializer.m` produced
 * before it. Nothing downstream normalises it: `pusher.ts` registers the
 * string as the `pushkey` and sygnal forwards it as it stands
 * (`convert_device_token_to_hex: false`, added for #325).
 *
 * That makes a lower-case answer a different `pushkey` for the same
 * telephone: a second pusher on the account, a ghost the device cannot
 * recognise as its own, and a form nobody here has established Apple accepts.
 * #325 is what that costs -- every iOS push refused for months, with both
 * environments perfectly paired and nothing red anywhere.
 *
 * So the case is checked rather than repaired. `toUpperCase` here would make
 * the check unfailable and let a native half that had drifted go on drifting;
 * refusing costs this launch its pusher and says why, which is the trade this
 * repository takes every time.
 *
 * # « JE NE SAIS PAS » IS NOT « PAS ENCORE »
 *
 * The whole failure mode of this file is that it looks like patience.
 * `pushDevice.ts` answered "Apple has not answered with a token yet" for a
 * build with no native half, a build Apple refused, a module that threw and a
 * token of the wrong shape alike -- and that sentence is true of one of them.
 * From outside a telephone, which is the only place a store build is read,
 * all four are the same silence.
 *
 * So each is named in one word and written to the trace, the only thing that
 * leaves a store build (`log.ts`), and the caller turns each into a sentence
 * of its own. It stays a degradation and not a failure: a telephone that
 * cannot be woken still works while it is open, which is `pusher.ts`'s rule
 * and not a new one.
 */

/** The native half, as JavaScript sees it. */
interface ApplePush {
  /**
   * Asks UIKit to register with Apple. Answers when the ask has been made,
   * not when Apple has: the token arrives at the application delegate some
   * time afterwards, which is what `readApple` is for.
   */
  readonly askApple: () => Promise<unknown>
  /** What Apple has answered so far, and whether it answered a refusal. */
  readonly readApple: () => Promise<unknown>
}

/**
 * Why this telephone's token could not be read.
 *
 * Five states rather than one, because they call for different things.
 * `noModule` says this build does not carry the native half at all -- a
 * `pod install` that undid the exclusion, or a source file that never reached
 * the target. `appleRefused` says Apple was asked and said no, which is an
 * entitlement or a profile. `notHex` says the native half answered something
 * that is not a token in the one form that may be registered. `noAnswer` is
 * the honest wait, and the only one of the five that was ever reported.
 * `threw` says the bridge is not there at all.
 *
 * Each is one word, which is what the trace may carry (`log.ts`).
 */
export type Unread =
  'noModule' | 'appleRefused' | 'notHex' | 'noAnswer' | 'threw'

export type AppleToken =
  | { readonly token: string; readonly unread: null }
  | { readonly token: null; readonly unread: Unread }

/** How long to wait for Apple, in total, and how often to ask. */
export interface AppleWait {
  readonly tries: number
  readonly gapMs: number
}

/**
 * Ten looks half a second apart is five seconds, which is longer than the
 * token has ever taken and short enough that a device which will never have
 * one -- a simulator, an account with notifications refused -- is not holding
 * a launch open.
 */
const PATIENCE: AppleWait = { tries: 10, gapMs: 500 }

/** The one form a token may be registered in. See the header. */
const UPPER_HEX = /^[0-9A-F]+$/

export async function applePushToken(
  /**
   * Defaulted rather than threaded through the caller, which has no opinion
   * about it, and named all the same so a test can run the wait out without
   * costing five seconds.
   */
  wait: AppleWait = PATIENCE,
): Promise<AppleToken> {
  const reading = await readApple(wait)
  if (reading.unread !== null) {
    logEvent('warn', 'MESSAGR_APNS_TOKEN_UNREAD', { unread: reading.unread })
  }
  return reading
}

async function readApple(wait: AppleWait): Promise<AppleToken> {
  // `TurboModuleRegistry.get` rather than `NativeModules`, for the reason
  // `deviceLocale.ts` gives at length: it is the lookup that answers under
  // either architecture, and this repository does not get to bet on one.
  //
  // Asked for untyped and read as `ApplePush` afterwards: the registry's own
  // type is React Native's `TurboModule`, which declares one optional member,
  // and a module that shares none of its members is not assignable to it.
  // What is on the other side of the bridge is a promise either way, which is
  // why `asAnswer` reads what comes back rather than trusting this line.
  const found = TurboModuleRegistry.get('MessagrApplePush')
  if (found == null) return { token: null, unread: 'noModule' }
  const module = found as ApplePush

  try {
    // Asked for explicitly, and once. Nothing else in this build asks any
    // more: the two calls that used to -- the bridge's own at launch and
    // `registerDeviceForRemoteMessages` -- both left with Firebase.
    await module.askApple()

    let refused = false
    for (let look = 0; look < wait.tries; look += 1) {
      const answer = asAnswer(await module.readApple())
      if (answer.token !== null) {
        return UPPER_HEX.test(answer.token) && answer.token.length % 2 === 0
          ? { token: answer.token, unread: null }
          : { token: null, unread: 'notHex' }
      }
      // Kept rather than returned on: a refusal and a token can only race on
      // a device that registered twice, and the token is the better answer.
      refused = refused || answer.refused
      if (look + 1 < wait.tries) {
        await new Promise(resolve => setTimeout(resolve, wait.gapMs))
      }
    }
    return { token: null, unread: refused ? 'appleRefused' : 'noAnswer' }
  } catch {
    // A native half that answers differently than expected is not a reason to
    // fail a launch. It is a reason to say so, which the caller does.
    return { token: null, unread: 'threw' }
  }
}

/** What `readApple` answered, read defensively: it crosses the bridge. */
function asAnswer(said: unknown): {
  readonly token: string | null
  readonly refused: boolean
} {
  if (typeof said !== 'object' || said === null) {
    return { token: null, refused: false }
  }
  const answer = said as { token?: unknown; refused?: unknown }
  return {
    token:
      typeof answer.token === 'string' && answer.token !== ''
        ? answer.token
        : null,
    refused: answer.refused === true,
  }
}
