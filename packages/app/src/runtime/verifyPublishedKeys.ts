import type { HttpRequester } from './pump'

/**
 * An independent round trip proving device keys are retrievable from the
 * server, not only held in the crypto machine's own memory.
 *
 * "Another client" in this ticket's own wording is read as an independent
 * request rather than a second Matrix identity: `/keys/query` is not
 * access-restricted to anyone in particular, so this account's own bearer
 * asking the server about itself, in a request the pump did not produce and
 * the machine's own cache cannot answer from, already proves what
 * "published" means here — that the upload really landed on the server. A
 * genuine third-party proof, an independent implementation decrypting what
 * this account encrypts, is #13/#14's job, once a real counterparty exists.
 *
 * One-time keys are not part of this check: `/keys/query` does not return
 * them, by protocol design — only `/keys/claim` does, which consumes one and
 * needs a genuine second party to be meaningful. Their publication is
 * verified instead through `markRequestSent`'s own `keys_upload` response,
 * whose `one_time_key_counts` field is the server confirming how many it
 * accepted. `HttpRequester` is `pump.ts`'s own — imported rather than
 * redeclared, so the two pieces of the pump cannot silently drift into two
 * different shapes for the same thing.
 */
interface KeysQueryResponse {
  device_keys?: Record<
    string,
    Record<string, { keys?: Record<string, string> }>
  >
}

export async function verifyDeviceKeysPublished(
  http: HttpRequester,
  userId: string,
  deviceId: string,
): Promise<boolean> {
  let responseJson: string
  try {
    responseJson = await http.authedRequest(
      'POST',
      '/_matrix/client/v3/keys/query',
      {},
      // An empty array asks for every device this account has: the Matrix
      // specification's own shorthand for "I do not already know which
      // devices exist," which is honestly this app's situation.
      JSON.stringify({ device_keys: { [userId]: [] } }),
    )
  } catch {
    return false
  }

  let response: KeysQueryResponse
  try {
    response = JSON.parse(responseJson) as KeysQueryResponse
  } catch {
    return false
  }

  const keys = response.device_keys?.[userId]?.[deviceId]?.keys
  if (keys == null) {
    return false
  }
  const algorithms = Object.keys(keys)
  return (
    algorithms.some(key => key.startsWith('curve25519:')) &&
    algorithms.some(key => key.startsWith('ed25519:'))
  )
}
