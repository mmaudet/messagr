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
// So it goes and looks: it opens the store, syncs from its own cursor,
// decrypts what changed and says who and what. Everything that can stop it --
// no session, a keystore that will not answer because the screen has not been
// unlocked since the phone was switched on -- answers `null`, and `null`
// draws the notification that names nobody. That fallback is #90's own
// criterion, not a stand-in for this.
const {
  setBackgroundMessageHandler,
  getMessaging,
} = require('@react-native-firebase/messaging')
const { wake } = require('./src/runtime/wake')
const { lookForWhatArrivedHere } = require('./src/runtime/wakeAndLook')
const { readNotification } = require('./src/runtime/notifying')
const {
  drawNotification,
  rememberBackgroundPresses,
} = require('./src/runtime/showNotification')
const { logEvent } = require('./src/runtime/log')
const { wakeIsAllowed } = require('./src/runtime/wakeSetting')
const { wakeSecrets } = require('./src/runtime/deviceSecrets')

// GARDÉ, PARCE QU'UN SERVICE DE NOTIFICATION NON CONFIGURÉ A TUÉ
// L'APPLICATION ENTIÈRE SUR iOS.
//
// `getMessaging()` lève `No Firebase App '[DEFAULT]' has been created` quand
// rien n'a initialisé Firebase. Sur Android, `google-services.json` et le
// greffon Gradle le font ; sur iOS il faut `GoogleService-Info.plist` et
// `FirebaseApp.configure()`, et l'application n'en avait aucun des deux.
//
// Au niveau du module, cette exception interrompt l'évaluation du bundle.
// En débogage elle donne un écran rouge ; en production elle donne un écran
// NOIR et rien d'autre : `AppRegistry.registerComponent` a bien eu lieu au-
// dessus, mais le moteur ne se déclare jamais prêt, donc rien n'est monté.
// Rapporté par le premier testeur TestFlight le 7 septembre 2026, et
// invisible jusque-là parce que la CI CONSTRUIT le simulateur sans jamais
// le LANCER.
//
// La règle, plus large que ce bogue : **une messagerie dont l'interface ne
// s'affiche pas parce qu'un service de réveil n'est pas configuré se trompe
// de priorité.** Ne pas pouvoir être réveillé est une dégradation ; ne rien
// dessiner est une panne. Ce `try` transforme la seconde en la première.
//
// La ligne de journal est le seul témoin qu'aura quelqu'un qui cherche
// pourquoi les notifications ne partent pas sur une plateforme donnée.
try {
  registerTheWake()
} catch (cause) {
  logEvent('error', 'MESSAGR_WAKE_UNAVAILABLE', {
    reason: cause instanceof Error ? cause.message : String(cause),
  })
}

function registerTheWake() {
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
      lookForWhatArrived: lookForWhatArrivedHere,
      draw: drawNotification,
      describe: arrival =>
        readNotification(arrival.scope, arrival.shown, arrival.preview),
    })
    // The one line anybody debugging a push has. There is no screen here.
    logEvent('info', 'MESSAGR_WOKE', outcome)
  })

  // AT MODULE SCOPE, WHICH IS THE ONLY PLACE IT WORKS.
  //
  // notifee refuses to hold a press without a background handler, and said so
  // on a device: "no background event handler has been set". Registered inside
  // a component it does not exist when the process is headless -- which is
  // every case a background press happens in.
  //
  // Inside the guard with the handler above: both belong to being woken, and
  // a device that cannot be woken has nothing to hold a press for.
  rememberBackgroundPresses()
}
