import { getErrorMessage } from './errors'

/**
 * Telling the homeserver where to send a wake-up.
 *
 * # The gateway is ours, and that is the whole design
 *
 * `data.url` points at this deployment's own push gateway
 * (`services/invitations`, `handlers::wake`), not at sygnal. Sygnal's Firebase
 * pushkin copies the sender, the room and the message into what crosses
 * Google; our gateway forwards a notification stripped to the devices it must
 * reach, so what leaves reads `{"prio":"high"}` and nothing else.
 *
 * # `event_id_only` as well, which looks redundant and is not
 *
 * The gateway strips everything regardless, so asking the homeserver for the
 * quietest format changes nothing today. It changes something on the day this
 * pusher points at a gateway somebody else runs, and it costs a string. A
 * homeserver that sends less has less that can leak.
 *
 * # No `default_payload`
 *
 * Sygnal merges `data.default_payload` into the push. It is the one leak the
 * gateway cannot prevent on anybody's behalf but its own — it drops the whole
 * `data` object precisely because a client could put content there. This
 * client does not, and its own test says so.
 *
 * # Registering is not allowed to break a launch
 *
 * A device that could not register a pusher is a device that will not be
 * notified while it is closed. That is a degraded product, not a broken one,
 * and a launch that failed over it would be a launch nobody can read their
 * messages from.
 */

/**
 * The application this gateway should route to.
 *
 * **It must equal this build's Gradle `applicationId` and the key of the
 * `apps:` entry in `sygnal.yaml`, exactly.** Wildcards are accepted by
 * sygnal's matching and must not be used here.
 *
 * A disagreement produces **no error anywhere**: the homeserver finds no
 * pushkin and drops the notification, sygnal logs nothing, and the device is
 * simply never woken. It was `cloud.maudet.messagr` on this branch until a
 * review caught it -- the old applicationId, which sygnal does carry an entry
 * for and which this application is not.
 */
const APP_ID = 'eu.messagr'

/** What the homeserver shows in the account's device list. */
const SHOWN_AS = 'Messagr'

/** The Matrix push gateway path. Fixed by the specification. */
const GATEWAY_PATH = '_matrix/push/v1/notify'

export interface PusherBody {
  readonly app_id: string
  readonly app_display_name: string
  readonly device_display_name: string
  readonly kind: 'http'
  readonly lang: string
  readonly pushkey: string
  readonly data: {
    readonly url: string
    readonly format: 'event_id_only'
  }
  /** Replace any pusher with the same key on other devices? No: this is ours. */
  readonly append: boolean
}

export function describePusher(token: string, gatewayBase: string): PusherBody {
  return {
    app_id: APP_ID,
    app_display_name: SHOWN_AS,
    // The product, not the person. A device list is a thing somebody may show
    // somebody else, and "Michel's phone" is a sentence about a person.
    device_display_name: SHOWN_AS,
    kind: 'http',
    // What language the homeserver would write a notification in. It writes
    // none -- the device does that -- so this is a field the protocol
    // requires rather than a choice with consequences.
    lang: 'fr',
    pushkey: token,
    data: {
      url: `${gatewayBase.replace(/\/+$/, '')}/${GATEWAY_PATH}`,
      format: 'event_id_only',
    },
    // `false`: registering this device's pusher must not disturb another
    // device of the same account, which is what `append: true` would risk if
    // two ever shared a key.
    append: false,
  }
}

export type PusherPoster = (body: PusherBody) => Promise<void>

export type PusherRegistration =
  | { readonly registered: true }
  | { readonly registered: false; readonly reason: string }

/**
 * What is sent to take a pusher away: the same route, `kind: null`, with the
 * application and the key and nothing else.
 *
 * Needed because turning notifications off must actually stop them. A setting
 * that only stopped the *next* launch registering would leave the pusher that
 * is already there firing, which is a switch that reads as off and is on --
 * the exact shape of lie this product spends its design refusing.
 */
export function forgetPusher(token: string): Record<string, unknown> {
  return { app_id: APP_ID, pushkey: token, kind: null }
}

export async function registerPusher(
  post: PusherPoster,
  token: string,
  gatewayBase: string,
): Promise<PusherRegistration> {
  if (token === '') {
    // Nothing to register, and nothing worth an attempt. A device with no
    // token is one Firebase has not answered for yet, or an emulator without
    // Play services -- neither is an error to report as one.
    return { registered: false, reason: 'this device has no push token' }
  }
  try {
    await post(describePusher(token, gatewayBase))
    return { registered: true }
  } catch (cause: unknown) {
    return { registered: false, reason: getErrorMessage(cause) }
  }
}
