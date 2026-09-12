import { describe, expect, it } from 'vitest'

import { whatToDoWith, type SharedIn } from './sharedIn'

const PHOTO: SharedIn = {
  name: 'IMG_2049.jpg',
  mimeType: 'image/jpeg',
  size: 240_000,
}

const PDF: SharedIn = {
  name: 'facture-2026.pdf',
  mimeType: 'application/pdf',
  size: 12_000,
}

describe('whatToDoWith', () => {
  it('sends a photograph as a picture, so it arrives as one', () => {
    // Quelqu'un qui partage une photo attend une photo chez le destinataire.
    // Les dimensions manquent -- une application tierce ne les donne pas --
    // et `forwardImage.ts` a déjà tranché ce cas dans ce dépôt : « A zero is
    // honest when they did not ».
    expect(whatToDoWith(PHOTO, { entered: true })).toEqual({
      do: 'pick-a-conversation',
      as: 'photograph',
    })
  })

  it('sends everything else as a file', () => {
    expect(whatToDoWith(PDF, { entered: true })).toEqual({
      do: 'pick-a-conversation',
      as: 'document',
    })
  })

  it('refuses before the invitation has been claimed', () => {
    // Garder le partage voudrait dire stocker le fichier de quelqu'un avant
    // qu'existe quoi que ce soit pour le chiffrer, c'est-à-dire l'endroit de
    // stockage qu'ADR-0006 refuse. L'écran de promesse garde la porte
    // d'entrée ; ce chemin la respecte au lieu de la contourner.
    expect(whatToDoWith(PDF, { entered: false })).toEqual({
      do: 'say-not-yet',
    })
  })

  it('waits while the launch has not answered whether this device is in', () => {
    // MESURÉ SUR L'ÉMULATEUR LE 12 SEPTEMBRE 2026, et c'est le défaut que ce
    // cas ferme. Un partage froid arrive avant que le lancement ait ouvert la
    // session : l'appareil ne sait pas encore s'il a un compte. Lu comme
    // « non », ça affichait « entrez d'abord » à quelqu'un entré depuis des
    // jours, avec sa conversation visible juste en dessous sur le même écran
    // -- l'écran qui reproche un geste que personne n'a fait.
    //
    // Attendre ne garde rien : ce qui patiente est une adresse et ce que le
    // système en a dit, jamais les octets.
    expect(whatToDoWith(PDF, { entered: null })).toEqual({ do: 'wait' })
  })

  it('refuses a file too large on the size the system stated', () => {
    expect(
      whatToDoWith({ ...PDF, size: 13 * 1024 * 1024 }, { entered: true }),
    ).toEqual({ do: 'refuse', because: 'too-large' })
  })

  it('accepts a file whose size the system did not state', () => {
    // Android ne porte pas toujours de taille sur un `content://`. Refuser
    // sur une absence refuserait des fichiers ordinaires ; les octets sont
    // bornés à nouveau après lecture.
    expect(whatToDoWith({ ...PDF, size: null }, { entered: true })).toEqual({
      do: 'pick-a-conversation',
      as: 'document',
    })
  })

  it('refuses a file the system could not name', () => {
    expect(whatToDoWith({ ...PDF, name: '' }, { entered: true })).toEqual({
      do: 'refuse',
      because: 'unnamed',
    })
  })

  it('reads a type it does not know as a file rather than refusing it', () => {
    // Un `content://` sans type déclaré est ordinaire. Le produit sait
    // envoyer n'importe quel fichier depuis #111, donc il n'y a rien à
    // refuser ici.
    expect(whatToDoWith({ ...PDF, mimeType: '' }, { entered: true })).toEqual({
      do: 'pick-a-conversation',
      as: 'document',
    })
  })
})
