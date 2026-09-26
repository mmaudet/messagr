/**
 * Ce que l'édition de liens automatique n'a PAS le droit de faire (#334).
 *
 * # CE FICHIER EST LE RETRAIT LUI-MÊME, ET PAS SA CONSÉQUENCE
 *
 * `Podfile` appelle `use_native_modules!`, qui lie à la cible iOS **tout**
 * paquet npm portant un podspec. Les deux paquets Firebase en portent un, et
 * Android en a besoin : les retirer de `package.json` casserait le réveil des
 * téléphones Android, qui n'ont pas d'autre route que FCM.
 *
 * L'exclusion par plateforme est donc la seule façon de n'enlever Firebase
 * que de l'iPhone. `platforms.ios: null` dit à l'outillage de React Native de
 * ne pas lier ce paquet sur iOS ; Android continue de le lier par Gradle,
 * sans rien lire ici.
 *
 * # SANS CES SIX LIGNES, UN `pod install` DÉFAIT LE TRAVAIL EN SILENCE
 *
 * Et c'est le point : rien ne rougirait. Les douze pods reviendraient dans
 * `Podfile.lock`, la phase `[CP-User] [RNFB]` reviendrait dans le projet
 * Xcode, `FirebaseApp` serait de nouveau dans le paquet — et la CI resterait
 * verte, parce qu'aucune de ces choses n'empêche quoi que ce soit de
 * compiler. C'est exactement la forme du contrôle 3 de
 * `scripts/assert-ios-push.sh` : un fichier que le projet ne référence pas
 * est un fichier, et une exclusion que personne ne garde est un commentaire.
 *
 * `scripts/assert-ios-push.sh` lit donc ce fichier, et refuse une exclusion
 * incomplète. C'est la garde qui compte dans ce ticket.
 *
 * # POURQUOI IL N'EXISTAIT PAS AVANT
 *
 * Ce dépôt n'avait aucun `react-native.config.js` hors `node_modules` : tout
 * ce qui portait un podspec devait être lié, et l'était. Ce fichier est donc
 * la première exception, et la seule qu'il doit porter.
 */
module.exports = {
  dependencies: {
    // Firebase reste entier sur Android et n'est plus dans le paquet iOS.
    // `@react-native-firebase/app` porte `FirebaseCore` et la phase de build
    // qui injecte `firebase_json_raw` dans l'Info.plist construit ;
    // `/messaging` porte `FirebaseMessaging`, `FirebaseInstallations`,
    // `GoogleDataTransport` et le reste de la famille. Les douze pods racine
    // du verrou ne tenaient qu'à ces deux-là.
    '@react-native-firebase/app': { platforms: { ios: null } },
    '@react-native-firebase/messaging': { platforms: { ios: null } },
  },
}
