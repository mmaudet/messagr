import type { MediaDownloader } from './claimHistory'
import type { MediaUploader } from './vouch'

/**
 * Putting bytes into the homeserver's media repository, and getting them
 * back.
 *
 * The only thing this application uploads is an encrypted history bundle, so
 * this module is narrow on purpose: raw bytes in, an `mxc://` URI out, and
 * the reverse.
 *
 * # Why not the pump's `authedRequest`
 *
 * Every other request this application makes goes through `HttpRequester`,
 * whose body is a `string`. A bundle is not a string: it is ciphertext, and
 * putting it through a string would corrupt it in a way nothing reports
 * until the far side fails a hash check. So this reaches for `fetch`
 * directly, which is the narrower thing rather than the more powerful one.
 *
 * # Why the authenticated download endpoint
 *
 * `/_matrix/media/v3/download` needs no credential: anybody who learns the
 * URI can fetch the file. The bundle is encrypted, so that is not a
 * disclosure of anybody's history -- but it is an unauthenticated copy of
 * key material sitting behind a guessable-shaped URL, kept for as long as
 * the repository keeps anything, and there is no reason to accept it. The
 * `/_matrix/client/v1/media/download` endpoint, stable since Matrix 1.11,
 * requires the access token, and Synapse deployments increasingly refuse the
 * unauthenticated one outright.
 *
 * Upload has no such choice: `/_matrix/media/v3/upload` is still the only
 * upload endpoint, and it has always required a token.
 */

interface UploadResponse {
  content_uri?: unknown
}

/** Splits `mxc://server/id` into its two halves. */
export function partsOfMxc(url: string): {
  readonly server: string
  readonly mediaId: string
} {
  const match = /^mxc:\/\/([^/]+)\/(.+)$/.exec(url)
  if (match === null) {
    throw new Error(`not a media URI: ${url}`)
  }
  return { server: match[1]!, mediaId: match[2]! }
}

/**
 * The narrow slice of `fetch` this module uses, named so a test can supply
 * it without standing up a server.
 */
export type Fetching = (
  url: string,
  init: {
    method: string
    headers: Record<string, string>
    body?: Uint8Array
  },
) => Promise<{
  readonly ok: boolean
  readonly status: number
  readonly text: () => Promise<string>
  readonly arrayBuffer: () => Promise<ArrayBuffer>
}>

export function mediaRepository(
  baseUrl: string,
  accessToken: string,
  doFetch: Fetching,
): MediaUploader & MediaDownloader {
  const root = baseUrl.replace(/\/+$/, '')
  const authorization = { Authorization: `Bearer ${accessToken}` }

  return {
    upload: async (bytes, contentType) => {
      const response = await doFetch(`${root}/_matrix/media/v3/upload`, {
        method: 'POST',
        headers: { ...authorization, 'Content-Type': contentType },
        body: bytes,
      })
      if (!response.ok) {
        throw new Error(`the upload was refused with ${response.status}`)
      }
      const parsed = JSON.parse(await response.text()) as UploadResponse
      if (typeof parsed.content_uri !== 'string') {
        // Not defaulted to empty: an upload this application cannot name a
        // location for is an upload it cannot announce, and announcing an
        // empty location would give the recipient a URL that resolves to
        // nothing with no second chance.
        throw new Error('the homeserver returned no location for the upload')
      }
      return parsed.content_uri
    },

    download: async url => {
      const { server, mediaId } = partsOfMxc(url)
      const path =
        `${root}/_matrix/client/v1/media/download/` +
        `${encodeURIComponent(server)}/${encodeURIComponent(mediaId)}`
      const response = await doFetch(path, {
        method: 'GET',
        headers: authorization,
      })
      if (!response.ok) {
        throw new Error(`the download was refused with ${response.status}`)
      }
      return new Uint8Array(await response.arrayBuffer())
    },
  }
}
