/**
 * @format
 */

import { AppRegistry } from 'react-native'

// Ordering is load-bearing. The bootstrap patches the runtime, and App pulls
// in matrix-js-sdk, which reaches for crypto.getRandomValues while it is being
// constructed. `require` rather than `import` for App because ES imports are
// hoisted: written as an import it would be evaluated before this line.
import './src/runtime/bootstrap'

import { name as appName } from './app.json'

const { App } = require('./App')

AppRegistry.registerComponent(appName, () => App)

// THE WAKE, REGISTERED HERE AND NOWHERE ELSE.
//
// Firebase requires the background handler to be set outside any component,
// at module scope, before the application starts: a data message can arrive
// while nothing is mounted, and a handler registered inside a screen would
// not exist then. This is the only file that runs early enough.
//
// What it does is `src/runtime/wake.ts`, which is a function of ports and is
// tested without a device. What it CAN do is bounded by what woke it: the
// push carried `{"prio":"high"}` and nothing else, on purpose, so there is no
// message here to show -- only the knowledge that one exists.
//
// So this draws the blind notification: something arrived, named nobody. A
// device that has been unlocked could open its store, sync and say who and
// what, and that is issue #107 rather than a line missing here; the shape
// this calls is already the one that supports it, and the fallback is the
// behaviour #90 asks to be pinned rather than a stand-in for it.
const {
  setBackgroundMessageHandler,
  getMessaging,
} = require('@react-native-firebase/messaging')
const { wake } = require('./src/runtime/wake')
const { readNotification } = require('./src/runtime/notifying')
const { drawNotification } = require('./src/runtime/showNotification')
const { logEvent } = require('./src/runtime/log')
const { wakeIsAllowed } = require('./src/runtime/wakeSetting')
const { wakeSecrets } = require('./src/runtime/deviceSecrets')

setBackgroundMessageHandler(getMessaging(), async () => {
  // THE SETTING IS CHECKED HERE TOO, AND NOT ONLY AT REGISTRATION.
  //
  // Turning notifications off removes the pusher, so in the ordinary case
  // nothing arrives to be handled. This is the case where something does
  // anyway: a push already in flight, or a homeserver that has not yet
  // stopped. Drawing it would be the switch reading as off while a
  // notification appears, which is the thing the switch exists to prevent.
  if (!(await wakeIsAllowed(wakeSecrets))) {
    logEvent('info', 'MESSAGR_WOKE', {
      drew: 'nothing',
      reason: 'switched off',
    })
    return
  }

  const outcome = await wake({
    // `null` is "this device could not open its store", which is exactly the
    // truth in a headless context that has bootstrapped nothing.
    lookForWhatArrived: async () => null,
    draw: drawNotification,
    describe: arrival =>
      readNotification(arrival.scope, arrival.shown, arrival.preview),
  })
  // The one line anybody debugging a push has. There is no screen here.
  logEvent('info', 'MESSAGR_WOKE', outcome)
})
