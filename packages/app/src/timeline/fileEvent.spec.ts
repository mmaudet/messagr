import { describe, expect, it } from 'vitest'

import { describeFile, readFileEvent } from './fileEvent'

/** What `encryptAttachment` actually hands back, shape and all. */
const SECRET = JSON.stringify({
  v: 'v2',
  key: { kty: 'oct', key_ops: ['encrypt', 'decrypt'], alg: 'A256CTR', k: 'AA' },
  iv: 'BB',
  hashes: { sha256: 'CC' },
})

const AT = { url: 'mxc://h/abc', secret: SECRET }

const PICKED = {
  bytes: new Uint8Array(9),
  mimeType: 'application/pdf',
  name: 'facture-2026.pdf',
}

describe('describeFile', () => {
  it('builds an m.file the specification would recognise', () => {
    const content = describeFile(PICKED, AT)
    expect(content.msgtype).toBe('m.file')
    expect(content.info).toEqual({
      mimetype: 'application/pdf',
      size: 9,
    })
  })
})

describe('readFileEvent', () => {
  it('reads back what describeFile wrote, name included', () => {
    // The round trip, and the one field a photograph deliberately does not
    // carry: `imageEvent.ts` names a picture `image.jpg` on purpose, and a
    // document whose name did not survive would be a row with nothing to say.
    const read = readFileEvent(
      describeFile(PICKED, AT) as unknown as Record<string, unknown>,
    )
    expect(read).not.toBeNull()
    expect(read?.name).toBe('facture-2026.pdf')
    expect(read?.mimeType).toBe('application/pdf')
    expect(read?.size).toBe(9)
    expect(read?.url).toBe('mxc://h/abc')
  })

  it('reads an info section with no size, rather than refusing it', () => {
    // A sender that states no size is not a defect: `size` is optional in
    // Matrix's `FileInfo`, and a row can say a name without saying a weight.
    const read = readFileEvent({
      msgtype: 'm.file',
      body: 'notes.txt',
      info: { mimetype: 'text/plain' },
      file: { url: 'mxc://h/x', v: 'v2' },
    })
    expect(read?.size).toBeNull()
    expect(read?.name).toBe('notes.txt')
  })

  it('refuses a file sent in the clear', () => {
    // An unencrypted `m.file` in an encrypted conversation, refused for the
    // reason `readImageEvent` refuses one: this application does not fetch
    // plaintext media, and rendering it would say the conversation carries
    // something it does not.
    expect(
      readFileEvent({
        msgtype: 'm.file',
        body: 'notes.txt',
        url: 'mxc://h/x',
        info: { mimetype: 'text/plain' },
      }),
    ).toBeNull()
  })

  it('falls back to the filename field when the body is missing', () => {
    // Two fields say the same thing and a sender may fill either. A row
    // headed by nothing is worse than a row headed by the other one.
    expect(
      readFileEvent({
        msgtype: 'm.file',
        filename: 'contrat.pdf',
        info: { mimetype: 'application/pdf' },
        file: { url: 'mxc://h/x', v: 'v2' },
      })?.name,
    ).toBe('contrat.pdf')
  })
})
