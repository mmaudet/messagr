import { describe, expect, it } from 'vitest'

import {
  LARGEST_DOCUMENT_BYTES,
  refuseDocument,
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
