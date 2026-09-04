import { describe, expect, it } from 'vitest'

import type { HttpRequester } from './pump'
import { countOneTimeKeysOnServer } from './verifyOneTimeKeys'

function fakeHttp(
  responseJson: string,
): HttpRequester & { calls: Array<{ method: string; body?: string }> } {
  const calls: Array<{ method: string; body?: string }> = []
  return {
    authedRequest: async (method, _path, _query, body) => {
      calls.push({ method, body })
      return responseJson
    },
    calls,
  }
}

describe('countOneTimeKeysOnServer', () => {
  it('asks the server without uploading anything', async () => {
    const http = fakeHttp('{"one_time_key_counts":{"signed_curve25519":42}}')
    await countOneTimeKeysOnServer(http)
    // An empty body is what makes this a question rather than an upload:
    // the endpoint answers with the current counts and stores nothing.
    expect(http.calls[0]?.method).toBe('POST')
    expect(http.calls[0]?.body).toBe('{}')
  })

  it('reports how many signed curve25519 keys the server holds', async () => {
    const http = fakeHttp('{"one_time_key_counts":{"signed_curve25519":42}}')
    await expect(countOneTimeKeysOnServer(http)).resolves.toBe(42)
  })

  it('is zero when the server names no count for that algorithm', async () => {
    const http = fakeHttp('{"one_time_key_counts":{"curve25519":7}}')
    await expect(countOneTimeKeysOnServer(http)).resolves.toBe(0)
  })

  it('is null rather than zero when the question could not be asked', async () => {
    // Zero would be a claim about the server. A failed request is not one.
    const http: HttpRequester = {
      authedRequest: async () => {
        throw new Error('network unreachable')
      },
    }
    await expect(countOneTimeKeysOnServer(http)).resolves.toBeNull()
  })

  it('is null rather than zero when the answer does not parse', async () => {
    await expect(
      countOneTimeKeysOnServer(fakeHttp('not json')),
    ).resolves.toBeNull()
  })
})
