import type { SharedIn } from './sharedIn'

/**
 * Un partage entrant, lu dans l'URI que l'activité a fabriquée pour lui.
 *
 * # Pourquoi le canal des liens plutôt qu'un module natif
 *
 * Un partage pose exactement la paire que `incomingLink.ts` a apprise à ses
 * dépens le 7 septembre 2026 : le cas FROID, où le système démarre
 * l'application pour l'occasion, et le cas CHAUD, où elle tournait déjà. Le
 * second avait été oublié, et un testeur avait regardé une liste vide sans
 * rien pouvoir faire.
 *
 * Un module natif neuf aurait à réapprendre cette leçon. `MainActivity`
 * traduit donc l'intention de partage en `messagr://share?…` et la pose sur
 * l'intention elle-même, de sorte que le chemin déjà éprouvé la porte : le
 * froid par `getInitialURL`, le chaud par l'événement `url`.
 *
 * Ce qui sépare un partage d'une invitation tient alors en un seul endroit,
 * celui-ci, plutôt que dans deux machineries parallèles.
 *
 * # Ce qui voyage, et ce qui ne voyage pas
 *
 * Une adresse `content://`, un nom, un type, une taille. **Pas les octets** :
 * l'URI est lue quand la personne a choisi une conversation, et pas avant,
 * donc rien n'est tenu en mémoire pendant qu'elle choisit. C'est aussi ce qui
 * garde le clair hors du disque, comme le sélecteur le fait déjà.
 */

/** Ce qu'un partage porte, avant qu'on ait lu quoi que ce soit. */
export interface SharedFile extends SharedIn {
  /** L'adresse que le système a donnée. Lue au dernier moment. */
  readonly uri: string
}

export function shareFrom(url: string): SharedFile | null {
  if (!url.startsWith('messagr://share?')) return null

  const asked = new URLSearchParams(url.slice('messagr://share?'.length))
  const uri = asked.get('uri')
  // Un partage sans adresse n'a rien à envoyer. Il est refusé ici plutôt que
  // plus loin, là où l'absence se lirait comme une lecture qui a échoué.
  if (uri === null || uri === '') return null

  const stated = asked.get('size')
  const size = stated !== null && /^\d+$/.test(stated) ? Number(stated) : null

  return {
    uri,
    name: asked.get('name') ?? '',
    // VIDE PLUTÔT QUE DEVINÉ. `sharedIn.ts` lit un type vide comme un
    // fichier, ce qui est juste ; déduire « application/pdf » d'une extension
    // serait une affirmation sur des octets que personne n'a lus.
    mimeType: asked.get('type') ?? '',
    size,
  }
}
