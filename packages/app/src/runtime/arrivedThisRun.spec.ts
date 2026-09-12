import { describe, expect, it } from 'vitest'

import {
  MOST_NOTED,
  arrivedThisRun,
  photographsThatJustArrived,
  type EntryLike,
} from './arrivedThisRun'

function entry(
  eventId: string,
  claimedSender: string,
  url?: string,
): EntryLike {
  return {
    eventId,
    claimedSender,
    image: url === undefined ? undefined : { url },
  }
}

const ME = '@moi:messagr.eu'
const THEM = '@elle:messagr.eu'

describe('photographsThatJustArrived', () => {
  it('names only what was not already held', () => {
    // LA BOUCLE VIVE REDÉRIVE TOUT L'HISTORIQUE À CHAQUE MOUVEMENT.
    // `loadConversation` rend la conversation entière et non un delta, donc
    // prendre ce qu'elle rend reviendrait à noter le catalogue arrière au
    // premier message reçu -- exactement ce que le module existe pour
    // empêcher.
    const held = [entry('$vieux', THEM, 'mxc://x/vieille')]
    const fresh = [
      entry('$vieux', THEM, 'mxc://x/vieille'),
      entry('$neuf', THEM, 'mxc://x/neuve'),
    ]
    expect(photographsThatJustArrived(held, fresh, ME)).toEqual([
      'mxc://x/neuve',
    ])
  })

  it('ignores what this account sent itself', () => {
    // Une photographie qu'on a envoyée vient de sa propre photothèque. L'y
    // remettre en ferait un doublon, et l'interrupteur dit « les photos
    // reçues ».
    const fresh = [entry('$mienne', ME, 'mxc://x/la-mienne')]
    expect(photographsThatJustArrived([], fresh, ME)).toEqual([])
  })

  it('ignores an entry that carries no photograph', () => {
    const fresh = [entry('$texte', THEM)]
    expect(photographsThatJustArrived([], fresh, ME)).toEqual([])
  })

  it('names the full image and never the thumbnail', () => {
    // La vignette est ce que l'écran dessine d'abord, et c'est une copie
    // dégradée que personne ne veut trouver dans sa galerie à la place de la
    // photographie.
    const fresh: EntryLike[] = [
      {
        eventId: '$neuf',
        claimedSender: THEM,
        image: { url: 'mxc://x/pleine' },
      },
    ]
    expect(photographsThatJustArrived([], fresh, ME)).toEqual([
      'mxc://x/pleine',
    ])
  })
})

describe('arrivedThisRun', () => {
  it('refuses a photograph nobody saw arrive', () => {
    // LE CATALOGUE ARRIÈRE, ET C'EST LE PREMIER DÉFAUT QUE CE MODULE EXISTE
    // POUR ÉVITER. Sans cette réponse, allumer l'interrupteur puis faire
    // défiler une vieille conversation déverserait des années d'images dans
    // la galerie d'un coup -- « tout ce qui est reçu, sur le disque, en
    // clair », qui est exactement la phrase par laquelle l'ADR-0006 refusait
    // la version automatique avant de l'autoriser.
    //
    // L'interrupteur gouverne l'avenir. Une photographie déjà là quand on
    // l'allume n'est pas reçue pendant qu'il est allumé.
    const arrivals = arrivedThisRun()
    expect(arrivals.mayKeep('mxc://messagr.eu/ancienne')).toBe(false)
  })

  it('allows one that arrived, and only once', () => {
    // LE SECOND DÉFAUT : LE DOUBLON. Un `Photograph` se remonte à chaque
    // fois qu'on revient sur la conversation -- changer d'onglet suffit --
    // et `fetchImage` répond alors depuis son cache sans rien redescendre.
    // Sans cette consommation, chaque retour ajouterait une copie de plus
    // dans la photothèque.
    const arrivals = arrivedThisRun()
    arrivals.noted('mxc://messagr.eu/neuve')
    expect(arrivals.mayKeep('mxc://messagr.eu/neuve')).toBe(true)
    expect(arrivals.mayKeep('mxc://messagr.eu/neuve')).toBe(false)
  })

  it('keeps each address apart from the others', () => {
    const arrivals = arrivedThisRun()
    arrivals.noted('mxc://messagr.eu/une')
    arrivals.noted('mxc://messagr.eu/deux')
    expect(arrivals.mayKeep('mxc://messagr.eu/deux')).toBe(true)
    expect(arrivals.mayKeep('mxc://messagr.eu/une')).toBe(true)
  })

  it('does not grow without bound', () => {
    // Une conversation qu'on n'ouvre jamais laisse ses arrivées non
    // consommées, et un téléphone reste allumé des semaines. La plus
    // ancienne part quand la limite est atteinte : ce qui est le plus haut
    // dans l'historique est ce qu'on est le moins susceptible d'aller
    // regarder, et c'est le même raisonnement que le cache de
    // `receiveImage.ts` tient sur les images déjà déchiffrées.
    const arrivals = arrivedThisRun()
    arrivals.noted('mxc://messagr.eu/la-premiere')
    for (let n = 0; n < MOST_NOTED; n += 1) arrivals.noted(`mxc://x/${n}`)
    expect(arrivals.mayKeep('mxc://messagr.eu/la-premiere')).toBe(false)
    expect(arrivals.mayKeep(`mxc://x/${MOST_NOTED - 1}`)).toBe(true)
  })

  it('forgets everything for a device that has been signed out', () => {
    // Le même geste que `forgetShownImages`. Ce que ce registre contient est
    // une liste d'adresses de pièces jointes d'un compte ; le compte parti,
    // elle n'a plus de sujet.
    const arrivals = arrivedThisRun()
    arrivals.noted('mxc://messagr.eu/neuve')
    arrivals.forgetAll()
    expect(arrivals.mayKeep('mxc://messagr.eu/neuve')).toBe(false)
  })

  it('notes an address once even if it arrives twice', () => {
    // Une même pièce jointe référencée deux fois est la même image, et un
    // sondage qui repasse sur un événement déjà vu ne doit pas donner un
    // second droit d'enregistrer.
    const arrivals = arrivedThisRun()
    arrivals.noted('mxc://messagr.eu/neuve')
    arrivals.noted('mxc://messagr.eu/neuve')
    expect(arrivals.mayKeep('mxc://messagr.eu/neuve')).toBe(true)
    expect(arrivals.mayKeep('mxc://messagr.eu/neuve')).toBe(false)
  })
})
