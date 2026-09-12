import { describe, expect, it } from 'vitest'

import { oursToRemove } from './sharedInbox'

const INBOX = '/private/var/mobile/Containers/Shared/AppGroup/ABC/Incoming'

describe('oursToRemove', () => {
  it('says yes to a file the extension put in the inbox', () => {
    expect(oursToRemove(`${INBOX}/17-facture.pdf`, INBOX)).toBe(true)
  })

  it('says yes through a file:// address, which is what the URI carries', () => {
    // L'extension écrit une adresse, pas un chemin : c'est ce qui voyage dans
    // `messagr://share?uri=…`, et c'est donc ce qu'on redonne ici.
    expect(oursToRemove(`file://${INBOX}/17-facture.pdf`, INBOX)).toBe(true)
  })

  it('refuses a path that merely starts like the inbox', () => {
    // LE DÉFAUT DE PRÉFIXE, et c'est pour lui que cette fonction existe.
    // `startsWith(inbox)` dit oui à `…/Incoming-old/x`, qui n'est pas dedans.
    expect(oursToRemove(`${INBOX}-old/x.pdf`, INBOX)).toBe(false)
    expect(oursToRemove(`${INBOX}2/x.pdf`, INBOX)).toBe(false)
  })

  it('refuses the inbox itself', () => {
    // On vide le dossier, on ne le supprime pas : l'extension écrirait alors
    // dans un chemin qui n'existe plus.
    expect(oursToRemove(INBOX, INBOX)).toBe(false)
    expect(oursToRemove(`${INBOX}/`, INBOX)).toBe(false)
  })

  it('refuses a path that climbs back out', () => {
    expect(oursToRemove(`${INBOX}/../../../Photos/IMG_2049.jpg`, INBOX)).toBe(
      false,
    )
    expect(oursToRemove(`${INBOX}/sub/../../escaped.pdf`, INBOX)).toBe(false)
  })

  it('refuses an address that is not a file at all', () => {
    // ANDROID PASSE ICI AVEC UN `content://`, et ce qu'il désigne est le
    // fichier de quelqu'un, dans sa propre galerie. Rien n'y a été recopié,
    // donc il n'y a rien à retirer -- et le retirer serait effacer sa photo.
    // `imageLibrary.ts` s'est déjà fait cette peur : « a module that removes
    // whatever path it is handed is one bad answer away from deleting a
    // photograph out of somebody's gallery ».
    expect(
      oursToRemove('content://media/external/images/media/42', INBOX),
    ).toBe(false)
    expect(oursToRemove('https://messagr.eu/i/abc', INBOX)).toBe(false)
  })

  it('refuses everything when there is no inbox', () => {
    // C'est le cas d'Android, où rien n'est jamais recopié : pas de dossier,
    // donc rien à vider et rien à effacer.
    expect(oursToRemove(`${INBOX}/x.pdf`, null)).toBe(false)
    expect(oursToRemove(`${INBOX}/x.pdf`, '')).toBe(false)
  })
})
