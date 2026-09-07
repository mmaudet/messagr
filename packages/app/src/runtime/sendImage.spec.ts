import { describe, expect, it, vi } from 'vitest'

import { sendImage, type SendingImageDeps } from './sendImage'

/**
 * What `encryptAttachment` hands back, with a key that differs per call.
 *
 * A fixture answering one constant secret would make "the thumbnail has a key
 * of its own" true for free, and the assertion that pins it worthless.
 */
const secretSealing = (nth: number) =>
  JSON.stringify({
    v: 'v2',
    key: { kty: 'oct', alg: 'A256CTR', k: `key-${nth}` },
    iv: `iv-${nth}`,
    hashes: { sha256: `sha-${nth}` },
  })

const IMAGE = {
  bytes: new Uint8Array([1, 2, 3]),
  mimeType: 'image/jpeg',
  width: 100,
  height: 50,
}

/** The same photograph, with the downscaled copy a picker can make of it. */
const IMAGE_WITH_THUMBNAIL = {
  ...IMAGE,
  thumbnail: {
    bytes: new Uint8Array([7]),
    mimeType: 'image/jpeg',
    width: 10,
    height: 5,
  },
}

function deps(over: Partial<SendingImageDeps> = {}): SendingImageDeps {
  let sealings = 0
  return {
    seal: async bytes => {
      sealings += 1
      return {
        ciphertext: new Uint8Array([...bytes].reverse()),
        secret: secretSealing(sealings),
      }
    },
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
    expect(result).toEqual({
      sent: false,
      reason: 'sealing the photograph: the machine refused',
    })
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
    expect(content.file.iv).toBe('iv-1')
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

  it('names the step, so a device failure is diagnosable from one line', async () => {
    // THE ONE THAT WOULD HAVE SAVED AN AFTERNOON. A photograph failed on a
    // Pixel with `crypto error: unknown` -- the bridge's own words for a
    // variant it cannot name -- and the report could not even say which of
    // five operations had thrown. Four of them are ordinary failures with
    // ordinary remedies; the fifth is a key problem, and telling them apart
    // is the difference between "retry" and "this peer's devices are not
    // known yet".
    //
    // Both halves are asserted: the step this file adds, and the original
    // message it must not swallow.
    expect(
      await sendImage(
        deps({
          machine: {
            encryptEvent: async () => {
              throw new Error('crypto error: unknown')
            },
          },
        }),
        '!room:x',
        IMAGE,
      ),
    ).toEqual({
      sent: false,
      reason: 'encrypting the event: crypto error: unknown',
    })
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
    ).toEqual({
      sent: false,
      reason: 'uploading the photograph: the media repository is full',
    })
  })
})

describe('sending the thumbnail beside the photograph', () => {
  /** The event that went, read back out of the payload that was encrypted. */
  async function eventFor(
    image: Parameters<typeof sendImage>[2],
    over: Partial<SendingImageDeps> = {},
  ) {
    let encrypted: Record<string, unknown> = {}
    await sendImage(
      deps({
        machine: {
          encryptEvent: async (_scope, _type, payload) => {
            encrypted = payload
            return { ciphertext: new Uint8Array() }
          },
        },
        ...over,
      }),
      '!room:x',
      image,
    )
    return encrypted as {
      file: { url: string; key: { k: string } }
      info: { thumbnail_file?: { url: string; key: { k: string } } }
    }
  }

  it("seals the thumbnail with a key that is not the photograph's", async () => {
    // The specification gives the thumbnail its own `file` object so that it
    // can be an independent sealing, and it has to be one: a key shared with
    // the photograph would mean that handing somebody the small picture hands
    // them the large one.
    const event = await eventFor(IMAGE_WITH_THUMBNAIL)
    expect(event.info.thumbnail_file?.key.k).not.toBe(event.file.key.k)
  })

  it('puts the two ciphertexts at two addresses', async () => {
    // Two uploads, two `mxc://`, and the event points at each of them. One
    // address for both would be the thumbnail overwriting the photograph.
    let uploads = 0
    const event = await eventFor(IMAGE_WITH_THUMBNAIL, {
      upload: async () => {
        uploads += 1
        return `mxc://h/${uploads}`
      },
    })
    expect(uploads).toBe(2)
    expect(event.info.thumbnail_file?.url).toBe('mxc://h/1')
    expect(event.file.url).toBe('mxc://h/2')
  })

  it('uploads the thumbnail before the photograph', async () => {
    // The order is the correctness (see the module): a thumbnail the
    // repository refuses has to fail before anything has been put in it,
    // rather than after the photograph is already there.
    const sizes: number[] = []
    await sendImage(
      deps({
        upload: async ciphertext => {
          sizes.push(ciphertext.length)
          return 'mxc://h/abc'
        },
      }),
      '!room:x',
      IMAGE_WITH_THUMBNAIL,
    )
    expect(sizes).toEqual([1, 3])
  })

  it('leaves nothing in the repository when the thumbnail cannot go', async () => {
    const upload = vi.fn(async () => {
      throw new Error('the media repository is full')
    })
    const send = vi.fn(async () => '$event')
    const result = await sendImage(
      deps({ upload, send }),
      '!room:x',
      IMAGE_WITH_THUMBNAIL,
    )
    expect(result).toEqual({
      sent: false,
      reason: 'uploading the thumbnail: the media repository is full',
    })
    expect(upload).toHaveBeenCalledTimes(1)
    expect(send).not.toHaveBeenCalled()
  })

  it('sends the photograph alone when the picker made no thumbnail', async () => {
    // The commonest case for as long as the picker cannot downscale, and the
    // only case for every event already in a conversation. It must produce
    // exactly the event it produced before there were thumbnails at all.
    const upload = vi.fn(async () => 'mxc://h/abc')
    const event = await eventFor(IMAGE, { upload })
    expect(upload).toHaveBeenCalledTimes(1)
    expect('thumbnail_file' in event.info).toBe(false)
  })
})
