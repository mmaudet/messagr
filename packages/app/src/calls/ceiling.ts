/**
 * Ce que cet appareil promet de ne jamais dépasser, par sens.
 *
 * # POURQUOI CE FICHIER EXISTE PLUTÔT QUE DEUX LIGNES DANS L'ADAPTATEUR
 *
 * Le plafond vivait dans `callMedia.ts`, qui est un module natif et n'a pas
 * de test — par décision, et la décision est juste pour ce qu'il contient :
 * du câblage vers `react-native-webrtc`.
 *
 * Mais le plafond n'est pas du câblage. C'est un nombre que #199 qualifie
 * lui-même de « à mesurer, pas à croire », et il était appliqué par du code
 * que **rien ne vérifiait** : ni qu'il touche le premier encodage, ni qu'il
 * laisse le reste tranquille, ni qu'il ne tombe pas quand il n'y a pas
 * d'encodage du tout. Un nombre qu'on doit mesurer mérite au moins qu'on
 * sache qu'il est posé.
 *
 * Alors la décision monte ici, où les tests vivent, et l'adaptateur ne garde
 * que l'appel. Le critère de #199 — « le plafond est un seul endroit
 * lisible » — s'en trouve mieux servi qu'avant : il est maintenant dans la
 * couche que quelqu'un lit pour comprendre les appels, et non dans celle
 * qu'on ouvre pour déboguer une bibliothèque.
 */

/**
 * 1,2 Mbit/s.
 *
 * Le coturn de l'instance autorise `max-bps=400000` — 3,2 Mbit/s — et sa
 * configuration dit pourquoi : « the product's ceiling is a relayed 1:1 video
 * call at ~3 Mbit/s per direction ». La moitié laisse la place à l'audio, aux
 * retransmissions et à l'encadrement du relais, et 1,2 Mbit/s fait un 720p
 * correct.
 *
 * UN NOMBRE À MESURER, PAS À CROIRE. #199 demande qu'il soit comparé à
 * 2,5 Mbit/s sur un appel réel entre deux téléphones, parce que personne ne
 * peut le choisir depuis un bureau. `docs/mesurer-le-debit-video.md` dit
 * comment s'y prendre le jour où un second appareil existe.
 *
 * ET POURQUOI LE DIRE AU LIEU DE LAISSER LE RELAIS TRANCHER. coturn arrivé à
 * son plafond **jette**, ce qui est indiscernable d'un mauvais réseau et
 * coûterait une journée à diagnostiquer. Le dire à l'émetteur fait descendre
 * WebRTC en résolution à la place : une image plus douce, et qui l'avoue.
 */
export const VIDEO_CEILING_BPS = 1_200_000

/**
 * Ce qu'on a besoin de savoir d'un `RTCRtpSendParameters`, et rien de plus.
 *
 * `maxBitrate` accepte `null` parce que `react-native-webrtc` l'écrit ainsi :
 * chez elle, « pas de plafond » est un `null` explicite et non une absence.
 * Le type le suit plutôt que de l'ignorer — un `undefined` seul ferait
 * refuser la vraie structure à la compilation, ce qui était le cas.
 */
export interface SendParametersLike {
  encodings?: { maxBitrate?: number | null }[]
}

/**
 * Pose le plafond sur le premier encodage, et dit ce qu'elle a fait.
 *
 * Rend `null` quand il n'y a aucun encodage à plafonner — ce qui arrive
 * avant que la négociation ait produit une couche — et le nombre posé sinon.
 * L'appelant journalise ce retour : c'est ce qui rend la mesure de #199
 * possible sans instrumenter l'application, puisque le journal dit alors si
 * le plafond a été posé, et lequel.
 *
 * MUTE SES ARGUMENTS, parce que `setParameters` exige qu'on lui redonne
 * l'objet que `getParameters` a rendu, modifié en place : reconstruire un
 * objet neuf fait échouer l'appel sur certaines implémentations. C'est
 * désagréable et c'est le contrat de la plateforme ; le nommer ici vaut mieux
 * que le redécouvrir.
 *
 * Ne touche que le PREMIER encodage. Une future simulcast en aurait
 * plusieurs, et plafonner toutes les couches à la même valeur reviendrait à
 * n'en avoir qu'une.
 */
export function capTheFirstEncoding(
  parameters: SendParametersLike,
): number | null {
  const first = parameters.encodings?.[0]
  if (first === undefined) return null
  first.maxBitrate = VIDEO_CEILING_BPS
  return VIDEO_CEILING_BPS
}
