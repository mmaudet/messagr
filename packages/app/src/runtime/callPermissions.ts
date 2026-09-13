import { PermissionsAndroid, Platform, type Permission } from 'react-native'

import type { CallPermission, PermissionPorts } from '../calls/permissions'

/**
 * The one file allowed to name `PermissionsAndroid`.
 *
 * `calls/permissions.ts` decides when a call asks and what a refusal does to
 * it; this says only how Android is asked. It has no tests for the reason
 * `callMedia.ts` has none: it is a translation, and anything here that began
 * to decide would belong upstairs, where it can be tested.
 *
 * `null` on every other platform, and on iOS that is the decision rather than
 * a gap: `calls/permissions.ts` says why.
 */

/** Android's name for each of the two. */
function androidName(permission: CallPermission): Permission {
  switch (permission) {
    case 'microphone':
      return PermissionsAndroid.PERMISSIONS.RECORD_AUDIO
    case 'camera':
      return PermissionsAndroid.PERMISSIONS.CAMERA
  }
}

export const devicePermissions: PermissionPorts | null =
  Platform.OS === 'android'
    ? {
        granted: permission =>
          PermissionsAndroid.check(androidName(permission)),
        request: async permissions => {
          // ONE REQUEST FOR BOTH, NEVER TWO AT ONCE. Android shows the dialogs
          // one after the other either way, and a request made while another
          // is on screen comes back empty -- which would read as a refusal
          // nobody gave.
          const answered = await PermissionsAndroid.requestMultiple(
            permissions.map(androidName),
          )
          return permissions.filter(
            one =>
              answered[androidName(one)] === PermissionsAndroid.RESULTS.GRANTED,
          )
        },
      }
    : null
