import { describe, expect, it } from 'vitest'

import { mediaRepository, partsOfMxc, type Fetching } from './mediaRepository'

interface Call {
  url: string
  method: string
  headers: Record<string, string>
  body?: Uint8Array
}

function server(
  answer: {
    ok?: boolean
    status?: number
    text?: string
    bytes?: Uint8Array
  } = {},
) {
  const calls: Call[] = []
  const doFetch: Fetching = async (url, init) => {
    calls.push({ url, ...init })
    return {
      ok: answer.ok ?? true,
      status: answer.status ?? 200,
      text: async () =>
        answer.text ?? JSON.stringify({ content_uri: 'mxc://example.org/abc' }),
      arrayBuffer: async () =>
        (answer.bytes ?? new Uint8Array([1, 2, 3])).buffer as ArrayBuffer,
    }
  }
  return { doFetch, calls }
}

describe('reading a media URI', () => {
  it('splits it into a server and an id', () => {
    expect(partsOfMxc('mxc://example.org/AbCdEf')).toEqual({
      server: 'example.org',
      mediaId: 'AbCdEf',
    })
  })

  it('refuses anything that is not one', () => {
    for (const bad of [
      'https://example.org/a',
      'mxc://example.org',
      'abc',
      '',
    ]) {
      expect(() => partsOfMxc(bad)).toThrow()
    }
  })
})

describe('uploading a bundle', () => {
  it('sends the bytes with the token and answers with the location', async () => {
    const s = server()
    const media = mediaRepository('https://home.example.org', 'tok', s.doFetch)

    const url = await media.upload(
      new Uint8Array([7, 7]),
      'application/octet-stream',
    )

    expect(url).toBe('mxc://example.org/abc')
    const call = s.calls.at(-1)!
    expect(call.method).toBe('POST')
    expect(call.url).toBe('https://home.example.org/_matrix/media/v3/upload')
    expect(call.headers.Authorization).toBe('Bearer tok')
    expect(Array.from(call.body!)).toEqual([7, 7])
  })

  it('tolerates a base URL with a trailing slash', async () => {
    const s = server()
    const media = mediaRepository('https://home.example.org/', 'tok', s.doFetch)
    await media.upload(new Uint8Array(), 'application/octet-stream')
    expect(s.calls.at(-1)!.url).not.toContain('//_matrix')
  })

  it('refuses an upload the homeserver named no location for', async () => {
    // An upload this application cannot name a location for is one it cannot
    // announce, and announcing an empty location gives the recipient a URL
    // that resolves to nothing, with no second chance.
    const s = server({ text: JSON.stringify({}) })
    const media = mediaRepository('https://home.example.org', 'tok', s.doFetch)
    await expect(
      media.upload(new Uint8Array(), 'application/octet-stream'),
    ).rejects.toThrow(/no location/)
  })

  it('reports the status when the upload is refused', async () => {
    const s = server({ ok: false, status: 413 })
    const media = mediaRepository('https://home.example.org', 'tok', s.doFetch)
    await expect(
      media.upload(new Uint8Array(), 'application/octet-stream'),
    ).rejects.toThrow(/413/)
  })
})

describe('downloading a bundle', () => {
  it('uses the authenticated endpoint, with the token', async () => {
    // Not `/_matrix/media/v3/download`, which needs no credential at all:
    // the bundle is encrypted, but there is no reason to leave an
    // unauthenticated copy of key material behind a URL for as long as the
    // repository keeps anything.
    const s = server({ bytes: new Uint8Array([4, 5, 6]) })
    const media = mediaRepository('https://home.example.org', 'tok', s.doFetch)

    const bytes = await media.download('mxc://example.org/abc')

    expect(Array.from(bytes)).toEqual([4, 5, 6])
    const call = s.calls.at(-1)!
    expect(call.url).toBe(
      'https://home.example.org/_matrix/client/v1/media/download/example.org/abc',
    )
    expect(call.headers.Authorization).toBe('Bearer tok')
  })

  it('reports the status when the download is refused', async () => {
    const s = server({ ok: false, status: 404 })
    const media = mediaRepository('https://home.example.org', 'tok', s.doFetch)
    await expect(media.download('mxc://example.org/abc')).rejects.toThrow(/404/)
  })
})
