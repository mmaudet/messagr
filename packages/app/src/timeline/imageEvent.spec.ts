import { describe, expect, it } from 'vitest'

import { describeImage, readImageEvent } from './imageEvent'

/** What `encryptAttachment` actually hands back, shape and all. */
const SECRET = JSON.stringify({
  v: 'v2',
  key: { kty: 'oct', key_ops: ['encrypt', 'decrypt'], alg: 'A256CTR', k: 'AA' },
  iv: 'BB',
  hashes: { sha256: 'CC' },
})

const PICKED = {
  bytes: new Uint8Array(9),
  mimeType: 'image/jpeg',
  width: 1024,
  height: 768,
}

describe('describeImage', () => {
  it('builds an m.image the specification would recognise', () => {
    const content = describeImage(PICKED, 'mxc://h/abc', SECRET)
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
    const content = describeImage(PICKED, 'mxc://h/abc', SECRET)
    expect(content.file).toMatchObject({ url: 'mxc://h/abc', v: 'v2' })
    expect('url' in content).toBe(false)
  })

  it('names the file something that is not the file', () => {
    // `body` is a fallback shown by clients that cannot render the image, and
    // it travels inside the encryption like everything else. A filename off
    // somebody's camera roll would leak a date, a place or a person's name to
    // whoever is in the conversation, which nobody asked to share.
    expect(describeImage(PICKED, 'mxc://h/abc', SECRET).body).toBe('image.jpg')
  })

  it('names it by what it is, so a png is not called a jpg', () => {
    const png = describeImage(
      { ...PICKED, mimeType: 'image/png' },
      'mxc://h/abc',
      SECRET,
    )
    expect(png.body).toBe('image.png')
  })

  it('refuses a secret it cannot read rather than sending a broken event', () => {
    // The secret is the bridge's, and the bridge calls it opaque. Reading it
    // is deliberate (see the module), and the price of reading it is having
    // to say what happens when it is not what was expected.
    expect(() => describeImage(PICKED, 'mxc://h/abc', 'not json')).toThrow(
      /secret/i,
    )
  })
})

describe('readImageEvent', () => {
  it('reads back what describeImage wrote', () => {
    const content = describeImage(PICKED, 'mxc://h/abc', SECRET)
    const read = readImageEvent(content as unknown as Record<string, unknown>)
    expect(read).toEqual({
      url: 'mxc://h/abc',
      secret: SECRET,
      mimeType: 'image/jpeg',
      width: 1024,
      height: 768,
    })
  })

  it('hands the secret back without the url in it', () => {
    // `decryptAttachment` is given the secret unchanged. `url` was added on
    // the way out and has to come off on the way back, or the bridge is
    // handed a structure it did not produce.
    const content = describeImage(PICKED, 'mxc://h/abc', SECRET)
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
})
