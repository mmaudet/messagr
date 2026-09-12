import { describe, expect, it } from 'vitest'

import { shareFrom } from './incomingShare'

describe('shareFrom', () => {
  it('reads what the system handed over', () => {
    const url =
      'messagr://share?uri=content%3A%2F%2Fmedia%2Fexternal%2Ffile%2F42' +
      '&name=facture-2026.pdf&type=application%2Fpdf&size=12000'
    expect(shareFrom(url)).toEqual({
      uri: 'content://media/external/file/42',
      name: 'facture-2026.pdf',
      mimeType: 'application/pdf',
      size: 12000,
    })
  })

  it('is not an invitation, and says so by answering null', () => {
    // LE MÊME CANAL QUE LES LIENS, ET C'EST LE POINT. Un partage arrive par
    // le chemin qui a déjà appris le cas froid et le cas chaud ; ce qui
    // sépare les deux est ici, en un seul endroit, plutôt que dans deux
    // machineries qui apprendraient la même leçon deux fois.
    expect(shareFrom('https://messagr.eu/i/abc123')).toBeNull()
    expect(shareFrom('messagr://invitation/abc123')).toBeNull()
    expect(shareFrom('')).toBeNull()
  })

  it('refuses a share carrying nothing to send', () => {
    expect(shareFrom('messagr://share?name=vide.pdf')).toBeNull()
  })

  it('reads a share the system did not size', () => {
    // Android ne porte pas toujours de taille sur un `content://`.
    const read = shareFrom(
      'messagr://share?uri=content%3A%2F%2Fx&name=note.txt&type=text%2Fplain',
    )
    expect(read?.size).toBeNull()
    expect(read?.name).toBe('note.txt')
  })

  it('reads a size that is not a number as no size at all', () => {
    const read = shareFrom(
      'messagr://share?uri=content%3A%2F%2Fx&name=n.txt&size=beaucoup',
    )
    expect(read?.size).toBeNull()
  })

  it('keeps a name carrying spaces and accents whole', () => {
    const read = shareFrom(
      'messagr://share?uri=content%3A%2F%2Fx&name=Relev%C3%A9%20de%20compte.pdf',
    )
    expect(read?.name).toBe('Relevé de compte.pdf')
  })

  it('answers an empty type rather than inventing one', () => {
    // `sharedIn.ts` lit un type vide comme un fichier, ce qui est la bonne
    // réponse. Deviner « application/pdf » sur une extension serait une
    // affirmation sur des octets que personne n'a lus.
    const read = shareFrom('messagr://share?uri=content%3A%2F%2Fx&name=n.pdf')
    expect(read?.mimeType).toBe('')
  })
})
