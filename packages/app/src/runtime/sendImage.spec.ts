import { describe, expect, it, vi } from 'vitest'

import { sendImage, type SendingImageDeps } from './sendImage'

const SECRET = JSON.stringify({
  v: 'v2',
  key: { kty: 'oct', alg: 'A256CTR', k: 'AA' },
  iv: 'BB',
  hashes: { sha256: 'CC' },
})

const IMAGE = {
  bytes: new Uint8Array([1, 2, 3]),
  mimeType: 'image/jpeg',
  width: 100,
  height: 50,
}

function deps(over: Partial<SendingImageDeps> = {}): SendingImageDeps {
  return {
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

describe('sendImage', () => {
  it('uploads the ciphertext and never the image', async () => {
    const uploaded: Uint8Array[] = []
    await sendImage(
      deps({
        upload: async bytes => {
          uploaded.push(bytes)
          return 'mxc://h/abc'
        },
      }),
      '!room:x',
      IMAGE,
    )
    expect(uploaded).toHaveLength(1)
    // The bytes that went are the sealed ones, and are not the picture. If
    // this ever passes with the plaintext, ADR-0006 is broken by the one
    // path that exists to carry a file.
    expect([...uploaded[0]!]).toEqual([3, 2, 1])
  })

  it('seals before it uploads, and does not upload if sealing fails', async () => {
    const upload = vi.fn(async () => 'mxc://h/abc')
    const result = await sendImage(
      deps({
        seal: async () => {
          throw new Error('the machine refused')
        },
        upload,
      }),
      '!room:x',
      IMAGE,
    )
    expect(upload).not.toHaveBeenCalled()
    expect(result).toEqual({ sent: false, reason: 'the machine refused' })
  })

  it('puts the secret inside the conversation encryption, not beside it', async () => {
    let encrypted: unknown = null
    await sendImage(
      deps({
        machine: {
          encryptEvent: async (_scope, _type, payload) => {
            encrypted = payload
            return { ciphertext: new Uint8Array() }
          },
        },
      }),
      '!room:x',
      IMAGE,
    )
    const content = encrypted as { file: Record<string, unknown> }
    expect(content.file.url).toBe('mxc://h/abc')
    expect(content.file.iv).toBe('BB')
  })

  it('reports the event it sent', async () => {
    expect(await sendImage(deps(), '!room:x', IMAGE)).toEqual({
      sent: true,
      eventId: '$event',
    })
  })

  it('refuses an image too large to hold twice', async () => {
    // `encryptAttachment` holds the plaintext and the ciphertext at once. The
    // refusal is a sentence, not a crash by the operating system.
    const huge = { ...IMAGE, bytes: new Uint8Array(13 * 1024 * 1024) }
    const upload = vi.fn(async () => 'mxc://h/abc')
    const result = await sendImage(deps({ upload }), '!room:x', huge)
    expect(result).toEqual({ sent: false, reason: 'too-large' })
    expect(upload).not.toHaveBeenCalled()
  })

  it('says what went wrong when the upload does', async () => {
    expect(
      await sendImage(
        deps({
          upload: async () => {
            throw new Error('the media repository is full')
          },
        }),
        '!room:x',
        IMAGE,
      ),
    ).toEqual({ sent: false, reason: 'the media repository is full' })
  })
})
