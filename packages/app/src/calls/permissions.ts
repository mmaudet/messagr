/**
 * When a call asks the telephone for its microphone and its camera, and what
 * a refusal does to it.
 *
 * # AS SOON AS IT RINGS, AND NO LONGER WHEN IT IS ANSWERED (#292)
 *
 * The dialogs used to open when somebody pressed answer, because that is when
 * the microphone was first captured. On a first call that is two dialogs, and
 * on Android the application waits behind them while the invitation goes on
 * counting: a person who granted both could find the call over by the time
 * the answer left, on a screen that went on ringing. So a callee is asked
 * when the call rings with the application in front, and a caller before the
 * invitation leaves. The dialogs happen while nothing is counting down on
 * somebody else's telephone.
 *
 * What survives is the rule the manifest always stated: nothing is asked at
 * launch. A dialog with no call behind it is a product asking to listen for
 * reasons of its own.
 *
 * # WHAT A REFUSAL MEANS, WHICH DID NOT CHANGE (#199)
 *
 * Without a microphone there is no call: a caller's is not placed and a
 * callee's is not answered, each saying so with the sentence a microphone
 * that would not open always had. Without a camera there is still a whole
 * call, in audio, with the line saying the picture did not come.
 *
 * # ANDROID ONLY
 *
 * Checking a permission without asking for it is `PermissionsAndroid`, and
 * React Native has no iOS half. On iOS it would take a native module -- the
 * only one at hand is react-native-webrtc's own -- so iOS has no ports and
 * keeps asking where it always did, at capture. The ending of an invitation
 * that runs out meanwhile is announced there all the same (`transport.ts`).
 *
 * # Pure, like every other module under `src/calls/`
 *
 * The dialog is a port. `runtime/callPermissions.ts` binds it to Android, and
 * this file decides when it opens without a device in sight.
 */

import type { Wants } from './media'
import type { CallSessionFailure } from './session'

/** The two things a call can ask the telephone for. */
export type CallPermission = 'microphone' | 'camera'

/** How the telephone is asked. Absent on a platform that cannot check. */
export interface PermissionPorts {
  /** Whether it is granted already. Shows nothing. */
  readonly granted: (permission: CallPermission) => Promise<boolean>
  /** Shows the platform's dialog for each of these, and answers those granted. */
  readonly request: (
    permissions: readonly CallPermission[],
  ) => Promise<readonly CallPermission[]>
}

/** A call ringing on this device, as far as asking is concerned. */
export interface RingingCall {
  readonly callId: string
  /** Whether the invitation offers a picture, read from its offer. */
  readonly video: boolean
}

/** Whether a call may go ahead once the telephone has been asked, and with what. */
export type Allowed =
  | {
      readonly allowed: true
      /** What the call may send. */
      readonly wants: Wants | undefined
      /** Whether a picture was wanted and refused, which the screen says. */
      readonly cameraRefused: boolean
    }
  | { readonly allowed: false; readonly failure: CallSessionFailure }

export interface CallPermissions {
  /** The call ringing now, or `null` once nothing is. */
  readonly ringing: (call: RingingCall | null) => void
  /**
   * Whether the application is in front, told every time that changes.
   *
   * A dialog needs a screen to open over, and a telephone woken with nothing
   * on it has none: the call that rang behind it is asked about the moment
   * the application comes back, if it is still ringing then.
   */
  readonly foreground: (active: boolean) => void
  /**
   * Asks for what a call about to be placed needs, before its invitation
   * leaves and before any screen opens for it.
   */
  readonly beforePlacing: (wants?: Wants) => Promise<Allowed>
  /**
   * Whether a call may be answered with what it wants, asking for nothing.
   *
   * THE ANSWER OPENS NO DIALOG, which is the whole of #292's second half: the
   * ring has asked already. An answer pressed while that dialog is still up
   * -- the one pressed on a notification, spent the moment the call rings --
   * waits for it to close, and goes by what the person said in it.
   */
  readonly beforeAnswering: (wants?: Wants) => Promise<Allowed>
}

/** The microphone for any call, and the camera for one that carries a picture. */
function neededFor(video: boolean): readonly CallPermission[] {
  return video ? ['microphone', 'camera'] : ['microphone']
}

/** A refused microphone, told with the sentence of one that would not open. */
const NO_MICROPHONE: CallSessionFailure = {
  kind: 'no-microphone',
  reason: 'the microphone permission was refused',
}

/** What a call may do with what the telephone granted. */
function allowedWith(
  granted: ReadonlySet<CallPermission>,
  wants: Wants | undefined,
): Allowed {
  if (!granted.has('microphone')) {
    return { allowed: false, failure: NO_MICROPHONE }
  }
  if (wants?.video === true && !granted.has('camera')) {
    return {
      allowed: true,
      wants: { ...wants, video: false },
      cameraRefused: true,
    }
  }
  return { allowed: true, wants, cameraRefused: false }
}

export function startCallPermissions(
  ports: PermissionPorts,
  active: boolean,
): CallPermissions {
  let inFront = active
  let rings: RingingCall | null = null
  /**
   * The call already asked about. Once a call: a ringing call is reported on
   * every transition and the application comes and goes, and a dialog that
   * reopened on each would be a telephone arguing with somebody who said no.
   */
  let askedAbout: string | undefined
  /** The ring's own dialog, open or closed, so an answer can wait for it. */
  let ringDialog: Promise<unknown> = Promise.resolve()

  /** Which of these are granted already, asking nobody. */
  async function grantedAmong(
    needed: readonly CallPermission[],
  ): Promise<readonly CallPermission[]> {
    const granted = await Promise.all(needed.map(one => ports.granted(one)))
    return needed.filter((_, at) => granted[at])
  }

  /** Asks for whichever of these is not granted yet, and answers what is granted. */
  async function askFor(
    needed: readonly CallPermission[],
  ): Promise<ReadonlySet<CallPermission>> {
    const held = await grantedAmong(needed)
    const missing = needed.filter(one => !held.includes(one))
    if (missing.length === 0) return new Set(held)
    return new Set([...held, ...(await ports.request(missing))])
  }

  /** Asks about the ringing call, if one rings and there is a screen to ask on. */
  function askAboutRinging(): void {
    if (rings === null || !inFront || askedAbout === rings.callId) return
    askedAbout = rings.callId
    ringDialog = askFor(neededFor(rings.video)).catch(() => undefined)
  }

  return {
    ringing: call => {
      rings = call
      askAboutRinging()
    },
    foreground: now => {
      inFront = now
      askAboutRinging()
    },
    beforePlacing: async wants =>
      allowedWith(await askFor(neededFor(wants?.video === true)), wants),
    beforeAnswering: async wants => {
      await ringDialog
      const needed = neededFor(wants?.video === true)
      return allowedWith(new Set(await grantedAmong(needed)), wants)
    },
  }
}
