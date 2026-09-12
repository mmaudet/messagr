import type { ReadFile, ReadImage } from '../timeline/imageEvent'

/**
 * Quelles photographies l'interrupteur de #208 a le droit d'enregistrer.
 *
 * # DEUX DÉFAUTS, ET C'EST TOUT CE QUE CE FICHIER EST
 *
 * L'amendement du 12 septembre à l'ADR-0006 autorise l'enregistrement
 * automatique sous une condition qu'il énonce ainsi : « la copie est faite
 * quand l'application déchiffre une image pour l'afficher, sur un appareil
 * que quelqu'un tient, et jamais par une récupération en fond ». Dire
 * simplement « enregistre ce que tu dessines » suffit à l'honorer, et produit
 * deux défauts que personne ne verrait avant d'avoir la galerie pleine.
 *
 * **Le catalogue arrière.** Allumer l'interrupteur puis faire défiler une
 * vieille conversation déverse des années d'images d'un coup. C'est
 * littéralement « tout ce qui est reçu, sur le disque, en clair » — la phrase
 * par laquelle l'ADR refusait la version automatique avant de l'autoriser.
 * L'interrupteur gouverne l'avenir : une photographie déjà là quand on
 * l'allume n'a pas été reçue pendant qu'il était allumé.
 *
 * **Le doublon.** Un `Photograph` se remonte à chaque retour sur la
 * conversation — changer d'onglet suffit — et `fetchImage` répond alors
 * depuis son cache. Un enregistrement par dessin ferait une copie de plus à
 * chaque fois.
 *
 * Les deux ont la même réponse : une arrivée est *notée* quand un événement
 * image atteint cet appareil pendant que l'interrupteur est allumé, et elle
 * est *consommée* la première fois que la photographie est dessinée. Ce qui
 * n'a pas été noté n'est jamais enregistré ; ce qui a été consommé ne l'est
 * plus.
 *
 * # POURQUOI RIEN N'EST ÉCRIT SUR LE DISQUE
 *
 * Un registre durable dirait, à travers les relances, ce qui a déjà été
 * enregistré. Il n'en existe pas, et c'est délibéré : l'appareil est le seul
 * à noter, et il ne note que ce qui arrive pendant qu'il tourne. Après une
 * relance, rien n'est noté, donc rien n'est enregistré tant qu'une nouvelle
 * image n'arrive pas — ce qui est le comportement voulu et non une limite
 * qu'on subit. Aucune nouvelle persistance, donc aucun nouvel endroit où
 * quelque chose peut rester.
 *
 * # CE QUE CELA VEUT DIRE QU'ON NE GARDE PAS
 *
 * Une image arrivée pendant que l'application tournait mais que personne n'a
 * ouverte avant de quitter n'est pas enregistrée. C'est le prix de la règle
 * « là où la personne est » : l'application ne va pas la chercher en fond
 * pour rattraper. Elle le sera si elle est redessinée dans une session où
 * elle réarrive, et sinon le geste de #169 est toujours là, un appui.
 */

/**
 * Combien d'arrivées non consommées sont gardées en mémoire.
 *
 * Une conversation qu'on n'ouvre jamais laisse ses arrivées derrière elle, et
 * un téléphone reste allumé des semaines. La plus ancienne part quand la
 * limite est atteinte, par le raisonnement que `receiveImage.ts` tient sur
 * son propre cache : ce qui est le plus haut dans l'historique est ce qu'on
 * est le moins susceptible d'aller regarder.
 *
 * Ce sont des chaînes d'adresses et non des images, donc le coût est en
 * kilo-octets là où le cache d'images est en méga-octets. La limite est haute
 * pour cette raison.
 */
export const MOST_NOTED = 500

/**
 * Ce qu'on a besoin de savoir d'une entrée de conversation, et rien de plus.
 *
 * Structurel plutôt qu'importé de `mergeTimeline.ts`, comme `ceiling.ts` le
 * fait de `RTCRtpSendParameters` : ce module n'appartient pas à la couche
 * chronologie et n'a aucune raison d'en dépendre pour trois champs.
 */
export interface EntryLike {
  readonly eventId: string
  readonly claimedSender: string
  readonly image?: ReadImage | undefined
}

/**
 * Une arrivée notée : quoi garder, et sous quelles adresses la reconnaître.
 *
 * # LES DEUX NE SONT PAS LA MÊME CHOSE, ET C'EST TOUT L'INTÉRÊT DE CE TYPE
 *
 * La conversation ne dessine pas la photographie. `Photograph` demande « la
 * plus petite copie qui fera l'affaire » et c'est la vignette du correspondant
 * ; la photographie pleine n'est déchiffrée que par la visionneuse plein
 * écran. Un registre qui n'aurait connu que l'adresse pleine n'aurait donc
 * rien gardé tant que la personne n'aurait pas ouvert chaque image une par
 * une, ce qui n'est pas un enregistrement automatique.
 *
 * Alors la note porte les deux adresses et ne rend qu'une chose : **la
 * photographie pleine, jamais la vignette**. Dessiner la vignette suffit à
 * déclencher, et ce qui part dans la galerie est la vraie image. Le prix est
 * un téléchargement que personne n'a demandé à l'écran, et il est assumé :
 * une vignette dans la photothèque serait une copie dégradée que personne ne
 * veut y trouver à la place de la photographie.
 */
export interface JustArrived {
  readonly photograph: ReadFile
  /** Toutes les adresses sous lesquelles l'écran peut la dessiner. */
  readonly addresses: readonly string[]
}

/**
 * Les photographies qu'un sondage vient d'apporter, et que personne n'avait.
 *
 * # POURQUOI UNE DIFFÉRENCE PLUTÔT QUE « CE QUE LE SONDAGE A APPORTÉ »
 *
 * La boucle vive redérive la conversation entière à chaque fois qu'elle
 * bouge : `loadConversation` rend tout l'historique, pas le delta. Noter ce
 * qu'elle rend reviendrait à noter le catalogue arrière au premier message
 * reçu, ce que le module entier existe pour empêcher.
 *
 * # ET POURQUOI PAS LES SIENNES
 *
 * Une photographie qu'on a envoyée vient de sa propre photothèque. L'y
 * remettre en ferait un doublon, et l'interrupteur dit « les photos reçues ».
 */
export function photographsThatJustArrived(
  held: readonly EntryLike[],
  fresh: readonly EntryLike[],
  mine: string,
): readonly JustArrived[] {
  const already = new Set(held.map(entry => entry.eventId))
  const arrivals: JustArrived[] = []
  for (const entry of fresh) {
    if (already.has(entry.eventId)) continue
    if (entry.claimedSender === mine) continue
    const image = entry.image
    if (image === undefined) continue
    // Les deux adresses quand il y a une vignette, l'unique sinon : un
    // événement envoyé avant #117 n'en porte pas, et l'écran dessine alors
    // la photographie elle-même.
    const drawnAs = image.thumbnail
    arrivals.push({
      photograph: image,
      addresses: drawnAs === null ? [image.url] : [image.url, drawnAs.url],
    })
  }
  return arrivals
}

export interface ArrivedThisRun {
  /** Un événement image a atteint cet appareil pendant qu'il tournait. */
  readonly noted: (arrival: JustArrived) => void
  /**
   * La photographie à garder quand l'adresse dessinée porte une note, et
   * `null` sinon. Consomme la note, sous toutes ses adresses : l'appelant
   * enregistre, ou personne ne le fera.
   */
  readonly mayKeep: (drawn: string) => ReadFile | null
  /** Pour un appareil qui vient d'être déconnecté. */
  readonly forgetAll: () => void
}

export function arrivedThisRun(): ArrivedThisRun {
  // Une entrée par adresse dessinable, vers la même note. Une `Map` et non
  // une liste : une même pièce jointe référencée deux fois est la même image,
  // et un sondage qui repasse sur un événement déjà vu ne doit pas donner un
  // second droit d'enregistrer. L'ordre d'insertion tenu par `Map` est ce qui
  // rend « la plus ancienne » lisible.
  const notes = new Map<string, JustArrived>()
  return {
    noted: arrival => {
      for (const address of arrival.addresses) {
        if (!notes.has(address) && notes.size >= MOST_NOTED) {
          const oldest = notes.keys().next().value
          if (oldest !== undefined) notes.delete(oldest)
        }
        notes.set(address, arrival)
      }
    },
    mayKeep: drawn => {
      const arrival = notes.get(drawn)
      if (arrival === undefined) return null
      // Toutes les adresses partent ensemble. Sans cela, dessiner la vignette
      // puis ouvrir la photographie en plein écran enregistrerait deux fois.
      for (const address of arrival.addresses) notes.delete(address)
      return arrival.photograph
    },
    forgetAll: () => {
      notes.clear()
    },
  }
}
