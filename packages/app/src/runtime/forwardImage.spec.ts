import { describe, expect, it } from 'vitest'

import { openForForward } from './forwardImage'
import type { ImageSource } from './receiveImage'
import type { ReadFile } from '../timeline/imageEvent'

const FILE: ReadFile = {
  url: 'mxc://h/one',
  secret: '{"key":"k"}',
  mimeType: 'image/png',
  width: null,
  height: null,
}

function source(over: Partial<ImageSource> = {}): ImageSource {
  return {
    download: async () => new Uint8Array([1, 2, 3]),
    open: async () => new Uint8Array([9, 8, 7]),
    ...over,
  } as ImageSource
}

describe('a photograph made ready for another conversation', () => {
  it('answers the decrypted bytes, not the ciphertext', async () => {
    // THE WHOLE POINT. Sending the ciphertext on would hand the destination
    // the original file's key, which is access to the upload rather than a
    // copy of the picture.
    const found = await openForForward(source(), FILE)
    expect(found.ready).toBe(true)
    if (found.ready) expect([...found.image.bytes]).toEqual([9, 8, 7])
  })

  it('carries the type the original said', async () => {
    const found = await openForForward(source(), FILE)
    if (found.ready) expect(found.image.mimeType).toBe('image/png')
  })

  it('assumes a type when the original said none', async () => {
    const found = await openForForward(source(), {
      ...FILE,
      mimeType: null,
    })
    if (found.ready) expect(found.image.mimeType).toBe('image/jpeg')
  })

  it('carries the dimensions the original said', async () => {
    const found = await openForForward(source(), {
      ...FILE,
      width: 800,
      height: 600,
    })
    if (found.ready) {
      expect(found.image.width).toBe(800)
      expect(found.image.height).toBe(600)
    }
  })

  it('answers zero rather than measuring a picture it cannot decode', async () => {
    // A zero reaches `info` and a recipient falls back to its default
    // proportions -- the same thing it does for a client that said nothing.
    const found = await openForForward(source(), FILE)
    if (found.ready) {
      expect(found.image.width).toBe(0)
      expect(found.image.height).toBe(0)
    }
  })

  it('says why rather than throwing when the download fails', async () => {
    const found = await openForForward(
      source({
        download: async () => {
          throw new Error('the media repository refused')
        },
      }),
      FILE,
    )
    expect(found).toEqual({
      ready: false,
      reason: 'the media repository refused',
    })
  })

  it('says why rather than throwing when it will not decrypt', async () => {
    const found = await openForForward(
      source({
        open: async () => {
          throw new Error('the file key did not fit')
        },
      }),
      FILE,
    )
    expect(found.ready).toBe(false)
  })
})
