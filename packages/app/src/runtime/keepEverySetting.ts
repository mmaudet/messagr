import type { SecretStore } from './sessionStore'

/**
 * Whether this device keeps every photograph it draws, without being asked
 * each time.
 *
 * # Ce que l'interrupteur est, et ce qu'il n'est pas
 *
 * #169 a livré le geste : une photographie, un appui, un fichier dans la
 * photothèque. L'ADR-0006 l'a autorisé le 10 septembre en refusant
 * explicitement la version automatique, dans ces termes — « elle
 * transformerait l'exception en cache : tout ce qui est reçu, sur le disque,
 * en clair, sans geste ».
 *
 * L'amendement du 12 septembre revient dessus et dit oui, sous les conditions
 * que le refus lui-même dictait. Celle qui compte ici : **un interrupteur EST
 * le geste, fait une fois pour toutes**. Ce que le paragraphe de refus
 * protégeait, c'était contre un produit qui décide à la place de quelqu'un ;
 * un interrupteur qu'il faut trouver et allumer n'est pas le produit qui
 * décide.
 *
 * # POURQUOI « OFF » EST LE DÉFAUT, ET POURQUOI C'EST PORTEUR
 *
 * Un défaut qui enregistre prendrait la décision pour tous ceux qui n'ouvrent
 * jamais Réglages, c'est-à-dire presque tout le monde — et ce sont exactement
 * les personnes que le refus protégeait. Un produit peut proposer ceci ; il
 * ne peut pas le supposer.
 *
 * C'est le même raisonnement que `receiptSetting.ts` tenait pour son propre
 * défaut, et que le porteur du compte a renversé le 7 septembre. Il n'est pas
 * renversable de la même façon : un accusé de lecture non publié est un
 * signal que personne ne voit, et cela se rattrape ; une photographie
 * enregistrée ne se retire plus, ni par son destinataire ni par la personne
 * qui l'a envoyée.
 *
 * # Dans quel sens il tombe
 *
 * Un magasin illisible répond **off**, comme `receiptSetting.ts` et pour la
 * même raison, transposée : être silencieusement discret est un état dégradé
 * que quelqu'un peut corriger ; être silencieusement bavard en est un qu'il
 * ne peut pas défaire. Ici le bavardage est un fichier en clair dans la
 * galerie, sauvegardé par ce qui sauvegarde la galerie et lisible par toute
 * application ayant accès aux photos.
 *
 * Une valeur que cette version ne reconnaît pas tombe du même côté, et non
 * sur le défaut : « jamais écrit » est le cas pour lequel un défaut existe,
 * un magasin écrit par une autre version ou abîmé est autre chose.
 */

const ON = 'on'
const OFF = 'off'

/** Ce que fait un appareil à qui personne n'a posé la question. */
export const KEEP_EVERY_DEFAULT = false

export async function everyPhotographIsKept(
  store: SecretStore,
): Promise<boolean> {
  try {
    const held = await store.read()
    if (held === ON) return true
    if (held === OFF) return false
    if (held === null || held === '') return KEEP_EVERY_DEFAULT
    return false
  } catch {
    return false
  }
}

/**
 * `false` quand le choix n'a pas pu être gardé, pour qu'un écran puisse dire
 * que l'interrupteur sera revenu où il était au prochain lancement plutôt que
 * d'afficher un réglage qui se renie en silence.
 */
export async function keepEveryPhotograph(
  store: SecretStore,
  on: boolean,
): Promise<boolean> {
  try {
    // Les deux positions sont écrites, aucune n'est une suppression : « off »
    // est alors une valeur que quelqu'un a choisie, et non l'absence d'une.
    await store.write(on ? ON : OFF)
    return true
  } catch {
    return false
  }
}
