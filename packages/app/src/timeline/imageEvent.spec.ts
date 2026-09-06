import { describe, expect, it } from 'vitest'

import { describeImage, readImageEvent, smallestCopyOf } from './imageEvent'

/** What `encryptAttachment` actually hands back, shape and all. */
const SECRET = JSON.stringify({
  v: 'v2',
  key: { kty: 'oct', key_ops: ['encrypt', 'decrypt'], alg: 'A256CTR', k: 'AA' },
  iv: 'BB',
  hashes: { sha256: 'CC' },
})

/** The same shape, with the key material a second sealing would produce. */
const OTHER_SECRET = JSON.stringify({
  v: 'v2',
  key: { kty: 'oct', key_ops: ['encrypt', 'decrypt'], alg: 'A256CTR', k: 'ZZ' },
  iv: 'YY',
  hashes: { sha256: 'XX' },
})

const AT = { url: 'mxc://h/abc', secret: SECRET }
const THUMB_AT = { url: 'mxc://h/small', secret: OTHER_SECRET }

const PICKED = {
  bytes: new Uint8Array(9),
  mimeType: 'image/jpeg',
  width: 1024,
  height: 768,
}

const PICKED_WITH_THUMBNAIL = {
  ...PICKED,
  thumbnail: {
    bytes: new Uint8Array(3),
    mimeType: 'image/jpeg',
    width: 800,
    height: 600,
  },
}

describe('describeImage', () => {
  it('builds an m.image the specification would recognise', () => {
    const content = describeImage(PICKED, AT, null)
    expect(content.msgtype).toBe('m.image')
    expect(content.info).toEqual({
      mimetype: 'image/jpeg',
      w: 1024,
      h: 768,
      size: 9,
    })
  })

  it('puts the url inside the file, and nothing beside it', () => {
    // An `m.image` carrying both `url` and `file` is one a client may fetch
    // unencrypted. There is nothing at that address to fetch, so it would
    // render as broken rather than as encrypted.
    const content = describeImage(PICKED, AT, null)
    expect(content.file).toMatchObject({ url: 'mxc://h/abc', v: 'v2' })
    expect('url' in content).toBe(false)
  })

  it('names the file something that is not the file', () => {
    // `body` is a fallback shown by clients that cannot render the image, and
    // it travels inside the encryption like everything else. A filename off
    // somebody's camera roll would leak a date, a place or a person's name to
    // whoever is in the conversation, which nobody asked to share.
    expect(describeImage(PICKED, AT, null).body).toBe('image.jpg')
  })

  it('names it by what it is, so a png is not called a jpg', () => {
    const png = describeImage({ ...PICKED, mimeType: 'image/png' }, AT, null)
    expect(png.body).toBe('image.png')
  })

  it('refuses a secret it cannot read rather than sending a broken event', () => {
    // The secret is the bridge's, and the bridge calls it opaque. Reading it
    // is deliberate (see the module), and the price of reading it is having
    // to say what happens when it is not what was expected.
    expect(() =>
      describeImage(PICKED, { url: 'mxc://h/abc', secret: 'not json' }, null),
    ).toThrow(/secret/i)
  })

  it('says nothing about a thumbnail when the picker made none', () => {
    // Absent rather than null or empty: a client reading `thumbnail_file` gets
    // the answer the specification defines for an event that has none, which
    // is every event this application sent before #117.
    const info = describeImage(PICKED, AT, null).info
    expect('thumbnail_file' in info).toBe(false)
    expect('thumbnail_info' in info).toBe(false)
  })

  it('carries the thumbnail as its own encrypted file, in info', () => {
    const info = describeImage(PICKED_WITH_THUMBNAIL, AT, THUMB_AT).info
    expect(info.thumbnail_file).toMatchObject({
      url: 'mxc://h/small',
      v: 'v2',
    })
  })

  it('states the thumbnail by its own size, never the photograph', () => {
    // A screen sizes its frame from these before the bytes land. Given the
    // photograph's numbers it would reserve the wrong shape and reflow when
    // the thumbnail arrives, which is the defect the frame exists to prevent.
    const info = describeImage(PICKED_WITH_THUMBNAIL, AT, THUMB_AT).info
    expect(info.thumbnail_info).toEqual({
      mimetype: 'image/jpeg',
      w: 800,
      h: 600,
      size: 3,
    })
  })

  it('refuses to point at a thumbnail whose bytes were never picked', () => {
    // An address with no dimensions beside it is an `info` a recipient cannot
    // size a tile from, and it can only mean the caller uploaded something
    // other than what it is describing.
    expect(() => describeImage(PICKED, AT, THUMB_AT)).toThrow(/thumbnail/i)
  })
})

describe('readImageEvent', () => {
  it('reads back what describeImage wrote', () => {
    const content = describeImage(PICKED, AT, null)
    const read = readImageEvent(content as unknown as Record<string, unknown>)
    expect(read).toEqual({
      url: 'mxc://h/abc',
      secret: SECRET,
      mimeType: 'image/jpeg',
      width: 1024,
      height: 768,
      thumbnail: null,
    })
  })

  it('hands the secret back without the url in it', () => {
    // `decryptAttachment` is given the secret unchanged. `url` was added on
    // the way out and has to come off on the way back, or the bridge is
    // handed a structure it did not produce.
    const content = describeImage(PICKED, AT, null)
    const read = readImageEvent(content as unknown as Record<string, unknown>)
    expect(JSON.parse(read!.secret)).not.toHaveProperty('url')
  })

  it('is nothing for a message that is not an image', () => {
    expect(readImageEvent({ msgtype: 'm.text', body: 'hello' })).toBeNull()
  })

  it('is nothing for an image with no encrypted file', () => {
    // An unencrypted `m.image` in an encrypted conversation. Refused rather
    // than rendered: this application does not fetch plaintext media, and
    // showing one would say the conversation carries things it does not.
    expect(
      readImageEvent({ msgtype: 'm.image', url: 'mxc://h/abc' }),
    ).toBeNull()
  })

  it('is nothing for a file with no address', () => {
    expect(readImageEvent({ msgtype: 'm.image', file: { v: 'v2' } })).toBeNull()
  })

  it('survives an info section the sender shaped differently', () => {
    // Dimensions are a rendering hint, not a fact this depends on. A sender
    // that omits them is a picture drawn at its natural size, not an event
    // to drop.
    const read = readImageEvent({
      msgtype: 'm.image',
      file: { url: 'mxc://h/abc', v: 'v2' },
    })
    expect(read?.width).toBeNull()
    expect(read?.mimeType).toBeNull()
  })

  it('reads the thumbnail as a file with its own address and its own key', () => {
    const content = describeImage(PICKED_WITH_THUMBNAIL, AT, THUMB_AT)
    const read = readImageEvent(content as unknown as Record<string, unknown>)
    expect(read?.thumbnail).toEqual({
      url: 'mxc://h/small',
      secret: OTHER_SECRET,
      mimeType: 'image/jpeg',
      width: 800,
      height: 600,
    })
  })

  it('has no thumbnail for an event sent before there were any', () => {
    const read = readImageEvent({
      msgtype: 'm.image',
      file: { url: 'mxc://h/abc', v: 'v2' },
      info: { mimetype: 'image/jpeg', w: 4, h: 3, size: 9 },
    })
    expect(read?.thumbnail).toBeNull()
  })

  it('drops a thumbnail it cannot read without dropping the photograph', () => {
    // A thumbnail is an optimisation. Losing the picture because the small
    // copy of it was malformed would trade the thing somebody sent for the
    // thing that made it quick.
    const read = readImageEvent({
      msgtype: 'm.image',
      file: { url: 'mxc://h/abc', v: 'v2' },
      info: { thumbnail_file: { v: 'v2' }, thumbnail_info: { w: 8 } },
    })
    expect(read?.url).toBe('mxc://h/abc')
    expect(read?.thumbnail).toBeNull()
  })
})

describe('smallestCopyOf', () => {
  it('answers the thumbnail when the sender made one', () => {
    const content = describeImage(PICKED_WITH_THUMBNAIL, AT, THUMB_AT)
    const read = readImageEvent(content as unknown as Record<string, unknown>)!
    expect(smallestCopyOf(read).url).toBe('mxc://h/small')
  })

  it('answers the photograph when there is no thumbnail, which is most events', () => {
    const content = describeImage(PICKED, AT, null)
    const read = readImageEvent(content as unknown as Record<string, unknown>)!
    expect(smallestCopyOf(read).url).toBe('mxc://h/abc')
  })
})
