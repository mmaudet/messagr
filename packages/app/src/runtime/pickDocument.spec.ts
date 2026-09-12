import { describe, expect, it } from 'vitest'

import {
  LARGEST_DOCUMENT_BYTES,
  refuseDocument,
  refuseWhatWasRead,
  type StatedDocument,
} from './pickDocument'

const STATED: StatedDocument = {
  name: 'facture-2026.pdf',
  mimeType: 'application/pdf',
  size: 1024,
}

describe('refuseDocument', () => {
  it('refuses on the size the picker states, before anything is read', () => {
    // THE DIFFERENCE FROM A PHOTOGRAPH, AND IT IS THE WHOLE POINT OF TAKING
    // A STATED SIZE RATHER THAN BYTES. `refuseImage` can only answer once the
    // bytes are in memory, which is exactly the memory the limit exists to
    // protect. A document picker states the size first, so a file too large
    // to hold is refused without ever being held.
    expect(
      refuseDocument({ ...STATED, size: LARGEST_DOCUMENT_BYTES + 1 }),
    ).toBe('too-large')
  })

  it('refuses a file with nothing in it', () => {
    expect(refuseDocument({ ...STATED, size: 0 })).toBe('unreadable')
  })

  it('refuses a file the picker could not name', () => {
    // A row is headed by the name. A file that arrives without one would be
    // sent as an event nobody on the other end can decide about.
    expect(refuseDocument({ ...STATED, name: '' })).toBe('unnamed')
  })

  it('accepts a document that fits', () => {
    expect(refuseDocument(STATED)).toBeNull()
  })

  it('accepts one whose size the picker did not state', () => {
    // Android's `content://` does not always carry a size. Refusing on an
    // absence would refuse ordinary files; the bytes are bounded again after
    // reading, which is where an unstated size gets caught.
    expect(refuseDocument({ ...STATED, size: null })).toBeNull()
  })
})

describe('refuseWhatWasRead', () => {
  // LA SECONDE BORNE, QUE TROIS COMMENTAIRES PROMETTAIENT ET QUE RIEN
  // N'APPLIQUAIT. « the bytes are bounded again once read » est écrit sur
  // `StatedDocument.size`, dans le test ci-dessus et dans `sharedIn.spec.ts`.
  // Relu le 12 septembre 2026 : ni `pickAnyDocument` ni `readShared` ne
  // comparaient quoi que ce soit après lecture, donc un fichier dont le
  // système ne déclare pas la taille passait sans limite -- et c'est
  // précisément le cas qu'Android produit le plus souvent.
  it('refuses bytes over the limit, which is what an unstated size becomes', () => {
    expect(refuseWhatWasRead(new Uint8Array(LARGEST_DOCUMENT_BYTES + 1))).toBe(
      'too-large',
    )
  })

  it('refuses an empty read, which is an address that gave nothing', () => {
    expect(refuseWhatWasRead(new Uint8Array(0))).toBe('unreadable')
  })

  it('accepts what fits, including exactly the limit', () => {
    expect(refuseWhatWasRead(new Uint8Array(LARGEST_DOCUMENT_BYTES))).toBeNull()
    expect(refuseWhatWasRead(new Uint8Array(1024))).toBeNull()
  })
})
