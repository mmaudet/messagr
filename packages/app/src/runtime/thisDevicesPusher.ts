// The native half of this device's pusher, kept thin for the reason
// `leavingThisDevice.ts` gives: a keystore read and a request, nothing worth
// unit-testing. Leaving an account and deleting one both take the pusher away
// first, and read it the same way, from here.
import { createClient } from 'matrix-js-sdk'
import { Platform } from 'react-native'

import { stopWakingThisDevice } from './cryptoPump'
import { pushkeySecrets } from './deviceSecrets'
import { readLastPushkey } from './lastPushkey'
import type { ThisDevicesPusher } from './pusher'

/**
 * Read from the pushkey this device wrote down when it registered, and taken
 * away through a client restored from the account's credentials, which
 * carries them to its own server and to no other.
 */
export const thisDevicesPusher: ThisDevicesPusher = {
  pusher: async () => {
    const token = await readLastPushkey(pushkeySecrets)
    return token === null
      ? null
      : { token, road: Platform.OS === 'ios' ? 'ios' : 'android' }
  },
  stopWaking: (account, pusher) =>
    stopWakingThisDevice(createClient(account), pusher.token, pusher.road),
}
