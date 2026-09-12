import { describe, expect, it } from 'vitest'

import type { ReadFile, ReadImage } from '../timeline/imageEvent'
import {
  MOST_NOTED,
  arrivedThisRun,
  photographsThatJustArrived,
  type EntryLike,
  type JustArrived,
} from './arrivedThisRun'

function file(url: string): ReadFile {
  return {
    url,
    secret: `${url}-secret`,
    mimeType: 'image/jpeg',
    width: 1000,
    height: 800,
  }
}

function picture(url: string, thumbnail: string | null = null): ReadImage {
  return {
    ...file(url),
    thumbnail: thumbnail === null ? null : file(thumbnail),
  }
}

function entry(
  eventId: string,
  claimedSender: string,
  image?: ReadImage,
): EntryLike {
  return { eventId, claimedSender, image }
}

function arrival(url: string, ...drawnAs: string[]): JustArrived {
  return { photograph: file(url), addresses: [url, ...drawnAs] }
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
    const held = [entry('$vieux', THEM, picture('mxc://x/vieille'))]
    const fresh = [
      entry('$vieux', THEM, picture('mxc://x/vieille')),
      entry('$neuf', THEM, picture('mxc://x/neuve')),
    ]
    expect(
      photographsThatJustArrived(held, fresh, ME).map(a => a.photograph.url),
    ).toEqual(['mxc://x/neuve'])
  })

  it('ignores what this account sent itself', () => {
    // Une photographie qu'on a envoyée vient de sa propre photothèque. L'y
    // remettre en ferait un doublon, et l'interrupteur dit « les photos
    // reçues ».
    const fresh = [entry('$mienne', ME, picture('mxc://x/la-mienne'))]
    expect(photographsThatJustArrived([], fresh, ME)).toEqual([])
  })

  it('ignores an entry that carries no photograph', () => {
    expect(photographsThatJustArrived([], [entry('$texte', THEM)], ME)).toEqual(
      [],
    )
  })

  it('carries the thumbnail address too, and keeps the full one to save', () => {
    // LE DÉFAUT QUE CE TEST EXISTE POUR TENIR FERMÉ, ET IL REND LA
    // FONCTIONNALITÉ INUTILE PLUTÔT QUE FAUSSE.
    //
    // La conversation ne dessine pas la photographie : `Photograph` demande
    // la plus petite copie qui fera l'affaire, donc la vignette. Un registre
    // qui n'aurait connu que l'adresse pleine n'aurait rien gardé tant que la
    // personne n'aurait pas ouvert chaque image une par une -- ce qui n'est
    // pas un enregistrement automatique.
    //
    // Les deux adresses déclenchent, et ce qui part dans la galerie est la
    // photographie. Une vignette y serait une copie dégradée que personne ne
    // veut trouver à la place.
    const fresh = [
      entry('$neuf', THEM, picture('mxc://x/pleine', 'mxc://x/vignette')),
    ]
    const [found] = photographsThatJustArrived([], fresh, ME)
    expect(found?.photograph.url).toBe('mxc://x/pleine')
    expect(found?.addresses).toEqual(['mxc://x/pleine', 'mxc://x/vignette'])
  })

  it('carries one address for an event sent before thumbnails existed', () => {
    // #117 a ajouté la vignette. Avant lui, l'écran dessine la photographie
    // elle-même, et il n'y a qu'une adresse à connaître.
    const fresh = [entry('$vieux-format', THEM, picture('mxc://x/seule'))]
    expect(photographsThatJustArrived([], fresh, ME)[0]?.addresses).toEqual([
      'mxc://x/seule',
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
    expect(arrivals.mayKeep('mxc://messagr.eu/ancienne')).toBeNull()
  })

  it('allows one that arrived, and only once', () => {
    // LE SECOND DÉFAUT : LE DOUBLON. Un `Photograph` se remonte à chaque
    // fois qu'on revient sur la conversation -- changer d'onglet suffit --
    // et `fetchImage` répond alors depuis son cache sans rien redescendre.
    // Sans cette consommation, chaque retour ajouterait une copie de plus
    // dans la photothèque.
    const arrivals = arrivedThisRun()
    arrivals.noted(arrival('mxc://messagr.eu/neuve'))
    expect(arrivals.mayKeep('mxc://messagr.eu/neuve')?.url).toBe(
      'mxc://messagr.eu/neuve',
    )
    expect(arrivals.mayKeep('mxc://messagr.eu/neuve')).toBeNull()
  })

  it('gives the photograph back when the thumbnail is what was drawn', () => {
    const arrivals = arrivedThisRun()
    arrivals.noted(arrival('mxc://x/pleine', 'mxc://x/vignette'))
    expect(arrivals.mayKeep('mxc://x/vignette')?.url).toBe('mxc://x/pleine')
  })

  it('spends both addresses at once', () => {
    // Dessiner la vignette dans la conversation puis ouvrir la photographie
    // en plein écran est le geste le plus ordinaire qui soit, et il touche
    // les deux adresses. Sans cette ligne il enregistrerait deux fois.
    const arrivals = arrivedThisRun()
    arrivals.noted(arrival('mxc://x/pleine', 'mxc://x/vignette'))
    expect(arrivals.mayKeep('mxc://x/vignette')).not.toBeNull()
    expect(arrivals.mayKeep('mxc://x/pleine')).toBeNull()
  })

  it('keeps each arrival apart from the others', () => {
    const arrivals = arrivedThisRun()
    arrivals.noted(arrival('mxc://messagr.eu/une'))
    arrivals.noted(arrival('mxc://messagr.eu/deux'))
    expect(arrivals.mayKeep('mxc://messagr.eu/deux')?.url).toBe(
      'mxc://messagr.eu/deux',
    )
    expect(arrivals.mayKeep('mxc://messagr.eu/une')?.url).toBe(
      'mxc://messagr.eu/une',
    )
  })

  it('does not grow without bound', () => {
    // Une conversation qu'on n'ouvre jamais laisse ses arrivées non
    // consommées, et un téléphone reste allumé des semaines. La plus
    // ancienne part quand la limite est atteinte : ce qui est le plus haut
    // dans l'historique est ce qu'on est le moins susceptible d'aller
    // regarder, et c'est le même raisonnement que le cache de
    // `receiveImage.ts` tient sur les images déjà déchiffrées.
    const arrivals = arrivedThisRun()
    arrivals.noted(arrival('mxc://messagr.eu/la-premiere'))
    for (let n = 0; n < MOST_NOTED; n += 1)
      arrivals.noted(arrival(`mxc://x/${n}`))
    expect(arrivals.mayKeep('mxc://messagr.eu/la-premiere')).toBeNull()
    expect(arrivals.mayKeep(`mxc://x/${MOST_NOTED - 1}`)).not.toBeNull()
  })

  it('forgets everything for a device that has been signed out', () => {
    // Le même geste que `forgetShownImages`. Ce que ce registre contient est
    // une liste d'adresses de pièces jointes d'un compte ; le compte parti,
    // elle n'a plus de sujet.
    const arrivals = arrivedThisRun()
    arrivals.noted(arrival('mxc://messagr.eu/neuve'))
    arrivals.forgetAll()
    expect(arrivals.mayKeep('mxc://messagr.eu/neuve')).toBeNull()
  })

  it('notes an address once even if it arrives twice', () => {
    // Une même pièce jointe référencée deux fois est la même image, et un
    // sondage qui repasse sur un événement déjà vu ne doit pas donner un
    // second droit d'enregistrer.
    const arrivals = arrivedThisRun()
    arrivals.noted(arrival('mxc://messagr.eu/neuve'))
    arrivals.noted(arrival('mxc://messagr.eu/neuve'))
    expect(arrivals.mayKeep('mxc://messagr.eu/neuve')).not.toBeNull()
    expect(arrivals.mayKeep('mxc://messagr.eu/neuve')).toBeNull()
  })
})
