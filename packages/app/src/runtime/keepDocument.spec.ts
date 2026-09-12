import { describe, expect, it } from 'vitest'

import { keepDocument, safeName, type KeepingDocument } from './keepDocument'

const DOCUMENT = { base64: 'AAEC', name: 'facture-2026.pdf' }

function deps(over: Partial<KeepingDocument> = {}): KeepingDocument {
  return {
    temporary: '/tmp',
    write: async () => undefined,
    save: async () => 'saved' as const,
    forget: async () => undefined,
    name: () => 'once',
    ...over,
  }
}

describe('keepDocument', () => {
  it('writes, hands over, and forgets, in that order', async () => {
    const order: string[] = []
    const kept = await keepDocument(
      deps({
        write: async () => {
          order.push('write')
        },
        save: async () => {
          order.push('save')
          return 'saved' as const
        },
        forget: async () => {
          order.push('forget')
        },
      }),
      DOCUMENT,
    )
    expect(kept).toEqual({ kept: true })
    expect(order).toEqual(['write', 'save', 'forget'])
  })

  it('forgets the plaintext even when the hand-over fails', async () => {
    // THE LINE ADR-0006 RESTS ON. A failure that left the decrypted file
    // behind would be the exact defect the decision exists to prevent, and
    // it is the failure path, not the happy one, that would do it.
    let forgotten: string | null = null
    const kept = await keepDocument(
      deps({
        save: async () => {
          throw new Error('the person cancelled')
        },
        forget: async path => {
          forgotten = path
        },
      }),
      DOCUMENT,
    )
    expect(kept.kept).toBe(false)
    expect(forgotten).toBe('/tmp/once-facture-2026.pdf')
  })

  it('a closed dialogue is not a failure, and the plaintext goes anyway', async () => {
    // Refermer « Enregistrer sous » est un geste ordinaire. Le rapporter
    // comme un échec ferait dire à l'écran « le document n'a pas pu être
    // enregistré » à quelqu'un qui a changé d'avis.
    //
    // Et le `finally` court pareil : une fenêtre refermée laisse le clair
    // sur le disque exactement comme une remise qui échoue.
    let forgotten: string | null = null
    const kept = await keepDocument(
      deps({
        save: async () => 'cancelled' as const,
        forget: async path => {
          forgotten = path
        },
      }),
      DOCUMENT,
    )
    expect(kept).toEqual({ kept: false, cancelled: true })
    expect(forgotten).toBe('/tmp/once-facture-2026.pdf')
  })

  it('hands the dialogue the name the sender gave', async () => {
    let suggested: string | null = null
    await keepDocument(
      deps({
        save: async (_path, name) => {
          suggested = name
          return 'saved' as const
        },
      }),
      DOCUMENT,
    )
    expect(suggested).toBe('facture-2026.pdf')
  })
})

describe('safeName', () => {
  it('keeps an ordinary filename whole', () => {
    expect(safeName('facture-2026.pdf')).toBe('facture-2026.pdf')
  })

  it('refuses a name that would climb out of the directory', () => {
    // THE NAME COMES FROM THE SENDER. `body` and `filename` are fields on an
    // event somebody else wrote, so a name is untrusted input on a path this
    // application builds -- and the one place it is joined to a directory is
    // here.
    expect(safeName('../../ailleurs.pdf')).toBeNull()
    expect(safeName('dossier/ailleurs.pdf')).toBeNull()
    expect(safeName('..')).toBeNull()
  })

  it('refuses a name that is only spaces, or nothing at all', () => {
    expect(safeName('')).toBeNull()
    expect(safeName('   ')).toBeNull()
  })

  it('refuses a name carrying a null byte', () => {
    // A byte that ends a string in the layer underneath, so a name carrying
    // one means two different things on either side of the bridge.
    expect(safeName('facture\u0000.pdf')).toBeNull()
  })
})
