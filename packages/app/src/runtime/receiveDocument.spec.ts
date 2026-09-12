import { describe, expect, it, vi } from 'vitest'

import { fetchDocument } from './receiveDocument'

const FILE = {
  url: 'mxc://h/abc',
  secret: '{"v":"v2"}',
  name: 'facture-2026.pdf',
  mimeType: 'application/pdf',
  size: 3,
}

describe('fetchDocument', () => {
  it('downloads, decrypts, and hands back base64', async () => {
    const got = await fetchDocument(
      {
        download: async () => new Uint8Array([9, 9, 9]),
        open: async () => new Uint8Array([0, 1, 2]),
      },
      FILE,
    )
    expect(got).toEqual({ ready: true, base64: 'AAEC', name: FILE.name })
  })

  it('keeps nothing between calls', async () => {
    // DELIBERATELY NOT `fetchImage`'s CACHE, and this is the difference
    // between the two paths. That cache holds twelve `data:` URIs so a
    // conversation can draw the same picture on several surfaces without
    // paying twice. A document is drawn nowhere: it is fetched once, for one
    // gesture, and twelve PDFs held as base64 strings would be the crash the
    // image cache's own bound exists to prevent.
    const download = vi.fn(async () => new Uint8Array([9]))
    const source = { download, open: async () => new Uint8Array([0]) }
    await fetchDocument(source, FILE)
    await fetchDocument(source, FILE)
    expect(download).toHaveBeenCalledTimes(2)
  })

  it('says which half failed', async () => {
    // The distinction `receiveImage.spec.ts` also draws: a download that
    // failed is a network to retry, a decryption that failed is a key that
    // never arrived, and the two have nothing to do with each other.
    const got = await fetchDocument(
      {
        download: async () => {
          throw new Error('404')
        },
        open: async () => new Uint8Array([0]),
      },
      FILE,
    )
    expect(got.ready).toBe(false)
    if (!got.ready) expect(got.reason).toContain('404')
  })
})
