import { LARGEST_DOCUMENT_BYTES } from './pickDocument'

/**
 * Ce qu'une autre application vient de remettre à Messagr, et ce qu'on en
 * fait.
 *
 * # La moitié pure du partage entrant
 *
 * `incomingShare.ts` est le port : un module qui nomme la plateforme, et
 * rien au-dessus. Ce fichier-ci est ce que les tests exercent, et il ne sait
 * ni ce qu'est une intention Android, ni ce qu'est une extension iOS.
 *
 * # Trois réponses, et une seule est un envoi
 *
 * Un partage arrive parfois avant que la personne soit entrée, parfois avec
 * un fichier trop lourd, parfois sans nom. Ce sont trois phrases différentes
 * à dire, et les confondre produit l'écran qui reproche à quelqu'un un geste
 * qu'il n'a pas fait.
 */

/** Ce que le système annonce du fichier partagé, avant toute lecture. */
export interface SharedIn {
  readonly name: string
  /** Vide quand le système n'a rien déclaré, ce qui est ordinaire. */
  readonly mimeType: string
  /** `null` quand le système n'a pas dit, ce qu'Android fait souvent. */
  readonly size: number | null
}

/** Ce que l'application sait d'elle-même au moment où le partage arrive. */
export interface Standing {
  /**
   * Si l'invitation a été réclamée. Avant, il n'y a pas de conversation.
   *
   * `null` TANT QUE LE LANCEMENT N'A PAS RÉPONDU, et c'est un troisième état,
   * pas un `false` commode. Un partage froid arrive avant que la session soit
   * ouverte, et confondre les deux affichait « entrez d'abord » à quelqu'un
   * entré depuis des jours. Le type porte la distinction pour que l'appelant
   * ne puisse pas l'oublier.
   */
  readonly entered: boolean | null
}

export type WhatToDo =
  | {
      readonly do: 'pick-a-conversation'
      /**
       * Une photographie part en `m.image`, tout le reste en `m.file`.
       *
       * Les dimensions manquent : une application tierce ne les donne pas.
       * `forwardImage.ts` a déjà tranché ce cas -- « A zero is honest when
       * they did not » -- et le destinataire voit une photographie, ce qu'on
       * attend en partageant une photographie, au prix d'un léger saut de
       * mise en page quand l'image arrive.
       */
      readonly as: 'photograph' | 'document'
    }
  /**
   * On ne sait pas encore : ne rien décider, et surtout ne rien dire.
   *
   * Ce qui patiente est une adresse et ce que le système en a dit, jamais les
   * octets, donc attendre ne garde rien de personne. L'appelant rappelle
   * quand `entered` se décide.
   */
  | { readonly do: 'wait' }
  /** Entrée pas encore réclamée : il n'y a rien où envoyer, et rien où garder. */
  | { readonly do: 'say-not-yet' }
  | { readonly do: 'refuse'; readonly because: 'too-large' | 'unnamed' }

/**
 * Ce qu'il y a à dire quand un partage n'aboutit pas.
 *
 * Trois phrases, et une seule demande quelque chose : `not-yet` a une suite
 * -- réclamer son invitation -- tandis que les deux autres constatent. Le nom
 * est celui de la phrase et pas celui de la cause, parce que deux causes
 * peuvent mener à la même phrase : un fichier sans nom et un fichier qu'on
 * n'arrive pas à lire disent tous les deux, à qui regarde l'écran, que
 * Messagr n'a rien pu faire de ce fichier.
 */
export type ShareRefusal = 'not-yet' | 'too-large' | 'unreadable'

export function whatToDoWith(shared: SharedIn, standing: Standing): WhatToDo {
  // AVANT TOUT LE RESTE, parce que garder ce fichier en attendant voudrait
  // dire le stocker quelque part, et ce quelque part est exactement ce
  // qu'ADR-0006 refuse. L'écran de promesse garde la porte d'entrée ; ce
  // chemin la respecte plutôt que de la contourner.
  if (standing.entered === null) return { do: 'wait' }
  if (!standing.entered) return { do: 'say-not-yet' }

  if (shared.name.trim() === '') return { do: 'refuse', because: 'unnamed' }
  if (shared.size !== null && shared.size > LARGEST_DOCUMENT_BYTES) {
    return { do: 'refuse', because: 'too-large' }
  }

  return {
    do: 'pick-a-conversation',
    as: shared.mimeType.startsWith('image/') ? 'photograph' : 'document',
  }
}
