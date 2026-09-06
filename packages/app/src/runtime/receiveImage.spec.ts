import { beforeEach, describe, expect, it } from 'vitest'

import { base64Of, fetchImage, forgetShownImages } from './receiveImage'

const READ = {
  url: 'mxc://h/abc',
  secret: '{"v":"v2"}',
  mimeType: 'image/jpeg',
  width: 10,
  height: 5,
}

describe('base64Of', () => {
  it('encodes bytes the way a data URI needs them', () => {
    expect(base64Of(new Uint8Array([77, 97, 110]))).toBe('TWFu')
  })

  it('pads a length that is not a multiple of three', () => {
    expect(base64Of(new Uint8Array([77]))).toBe('TQ==')
    expect(base64Of(new Uint8Array([77, 97]))).toBe('TWE=')
  })

  it('is nothing for nothing', () => {
    expect(base64Of(new Uint8Array())).toBe('')
  })

  it('encodes every byte value, including the ones above 127', () => {
    // A photograph is arbitrary bytes. An encoder built on a string
    // conversion that assumed text would corrupt exactly these.
    const all = new Uint8Array(256).map((_, i) => i)
    const back = Uint8Array.from(atob(base64Of(all)), c => c.charCodeAt(0))
    expect([...back]).toEqual([...all])
  })
})

describe('fetchImage', () => {
  // Module state: without this, one test's answer is another's cache hit.
  beforeEach(forgetShownImages)

  it('downloads the ciphertext and hands back what it decrypts to', async () => {
    const shown = await fetchImage(
      {
        download: async url => {
          expect(url).toBe('mxc://h/abc')
          return new Uint8Array([9, 9])
        },
        open: async (ciphertext, secret) => {
          expect([...ciphertext]).toEqual([9, 9])
          expect(secret).toBe('{"v":"v2"}')
          return new Uint8Array([77, 97, 110])
        },
      },
      READ,
    )
    expect(shown).toEqual({
      shown: true,
      uri: 'data:image/jpeg;base64,TWFu',
    })
  })

  it('falls back to a generic type when the sender named none', async () => {
    // A data URI needs a type. `application/octet-stream` renders nothing,
    // so the fallback is the commonest photograph rather than the most
    // honest nothing -- and it is a rendering hint, not a claim.
    const shown = await fetchImage(
      {
        download: async () => new Uint8Array(),
        open: async () => new Uint8Array([77, 97, 110]),
      },
      { ...READ, mimeType: null },
    )
    expect(shown).toEqual({ shown: true, uri: 'data:image/jpeg;base64,TWFu' })
  })

  it('says the download failed rather than throwing into a screen', async () => {
    expect(
      await fetchImage(
        {
          download: async () => {
            throw new Error('the media repository refused')
          },
          open: async () => new Uint8Array(),
        },
        READ,
      ),
    ).toEqual({ shown: false, reason: 'the media repository refused' })
  })

  it('says the decryption failed, which is a different thing', async () => {
    // Worth telling apart: a download worth retrying, versus a key that will
    // never open these bytes however many times they are fetched.
    expect(
      await fetchImage(
        {
          download: async () => new Uint8Array([1]),
          open: async () => {
            throw new Error('the secret is malformed')
          },
        },
        READ,
      ),
    ).toEqual({ shown: false, reason: 'the secret is malformed' })
  })
})

describe('fetching the same photograph twice', () => {
  it('downloads it once', async () => {
    // Leaving a conversation and coming back -- switching tabs does it --
    // remounted every Photograph and fetched the lot again. Found in review.
    forgetShownImages()
    let downloads = 0
    const source = {
      download: async () => {
        downloads += 1
        return new Uint8Array([1])
      },
      open: async () => new Uint8Array([77, 97, 110]),
    }
    const image = { ...READ, url: 'mxc://h/once' }
    await fetchImage(source, image)
    await fetchImage(source, image)
    expect(downloads).toBe(1)
  })

  it('does not keep a failure, because a download can be worth retrying', async () => {
    forgetShownImages()
    let attempts = 0
    const source = {
      download: async () => {
        attempts += 1
        if (attempts === 1) throw new Error('the network went away')
        return new Uint8Array([1])
      },
      open: async () => new Uint8Array([77, 97, 110]),
    }
    const image = { ...READ, url: 'mxc://h/flaky' }
    expect((await fetchImage(source, image)).shown).toBe(false)
    expect((await fetchImage(source, image)).shown).toBe(true)
  })

  it('holds a bounded number, so a long conversation is not an OOM', async () => {
    forgetShownImages()
    let downloads = 0
    const source = {
      download: async () => {
        downloads += 1
        return new Uint8Array([1])
      },
      open: async () => new Uint8Array([77, 97, 110]),
    }
    for (let at = 0; at < 20; at += 1) {
      await fetchImage(source, { ...READ, url: `mxc://h/${at}` })
    }
    // The first is gone, so asking for it again fetches it again.
    await fetchImage(source, { ...READ, url: 'mxc://h/0' })
    expect(downloads).toBe(21)
    // The most recent is still held.
    await fetchImage(source, { ...READ, url: 'mxc://h/19' })
    expect(downloads).toBe(21)
  })
})
