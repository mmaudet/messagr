import type { HttpRequester } from './pump'

/**
 * How many one-time keys the server currently holds for this device.
 *
 * This exists because the pump's own `oneTimeKeysPublished` answers a
 * narrower question than its name suggests: whether a `keys_upload`
 * succeeded **during this run**. On a warm store nothing is queued, because
 * nothing needs to be, and the field reads false while the server holds a
 * full set. The boot suite asserted that field and passed only because it
 * happened to run on a cold launch — a flake waiting for the day the test
 * order changes.
 *
 * `/keys/upload` with an empty body is the protocol's own way to ask: it
 * stores nothing and answers with the current counts. Asking the server is
 * the only way to learn what the server has.
 *
 * `null` rather than zero when the question could not be asked or answered.
 * Zero is a claim about the server, and a failed request is not one.
 */
interface UploadResponse {
  one_time_key_counts?: Record<string, unknown>
}

const ALGORITHM = 'signed_curve25519'

export async function countOneTimeKeysOnServer(
  http: HttpRequester,
): Promise<number | null> {
  let responseJson: string
  try {
    responseJson = await http.authedRequest(
      'POST',
      '/_matrix/client/v3/keys/upload',
      {},
      '{}',
    )
  } catch {
    return null
  }

  let response: UploadResponse
  try {
    response = JSON.parse(responseJson) as UploadResponse
  } catch {
    return null
  }

  const count = response.one_time_key_counts?.[ALGORITHM]
  return typeof count === 'number' ? count : 0
}
