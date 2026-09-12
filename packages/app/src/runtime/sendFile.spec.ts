import { describe, expect, it, vi } from 'vitest'

import { sendFile, type SendingFileDeps } from './sendFile'
import { LARGEST_DOCUMENT_BYTES } from './pickDocument'

const SECRET = JSON.stringify({
  v: 'v2',
  key: { kty: 'oct', alg: 'A256CTR', k: 'key' },
  iv: 'iv',
  hashes: { sha256: 'sha' },
})

const DOCUMENT = {
  bytes: new Uint8Array([1, 2, 3]),
  mimeType: 'application/pdf',
  name: 'facture-2026.pdf',
}

function deps(over: Partial<SendingFileDeps> = {}): SendingFileDeps {
  return {
    shareTheKey: async () => undefined,
    seal: async bytes => ({
      ciphertext: new Uint8Array([...bytes].reverse()),
      secret: SECRET,
    }),
    upload: async () => 'mxc://h/abc',
    machine: {
      encryptEvent: async (_scope, _type, payload) => ({
        ciphertext: new TextEncoder().encode(JSON.stringify(payload)),
      }),
    },
    send: async () => '$event',
    ...over,
  }
}

describe('sendFile', () => {
  it('uploads the ciphertext and never the document', async () => {
    const upload = vi.fn(async (_ciphertext: Uint8Array) => 'mxc://h/abc')
    await sendFile(deps({ upload }), '!room', DOCUMENT)
    expect(upload).toHaveBeenCalledTimes(1)
    const uploaded = upload.mock.calls[0]?.[0]
    expect(uploaded).toBeDefined()
    expect([...(uploaded ?? [])]).toEqual([3, 2, 1])
    expect([...(uploaded ?? [])]).not.toEqual([...DOCUMENT.bytes])
  })

  it('shares the room key before it encrypts the event', async () => {
    const order: string[] = []
    await sendFile(
      deps({
        shareTheKey: async () => {
          order.push('share')
        },
        machine: {
          encryptEvent: async () => {
            order.push('encrypt')
            return { ciphertext: new Uint8Array([1]) }
          },
        },
      }),
      '!room',
      DOCUMENT,
    )
    // The order `sendImage.ts` argues at length: encrypting into a scope
    // whose key nobody received produces a message nobody can read.
    expect(order).toEqual(['share', 'encrypt'])
  })

  it('refuses a document too large without touching the network', async () => {
    const upload = vi.fn(async () => 'mxc://h/abc')
    const sent = await sendFile(deps({ upload }), '!room', {
      ...DOCUMENT,
      bytes: new Uint8Array(LARGEST_DOCUMENT_BYTES + 1),
    })
    expect(sent).toEqual({ sent: false, reason: 'too-large' })
    expect(upload).not.toHaveBeenCalled()
  })

  it('names the step that failed', async () => {
    // The lesson of 7 September 2026, transposed: « crypto error: unknown »
    // names nothing, and five operations in one `try` cannot say which of
    // them threw.
    const sent = await sendFile(
      deps({
        upload: async () => {
          throw new Error('the media repository said no')
        },
      }),
      '!room',
      DOCUMENT,
    )
    expect(sent.sent).toBe(false)
    if (!sent.sent) {
      expect(sent.reason).toContain('uploading the document')
      expect(sent.reason).toContain('the media repository said no')
    }
  })
})
