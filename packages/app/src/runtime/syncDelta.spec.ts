import { describe, expect, it, vi } from 'vitest'

import type { HttpRequester } from './pump'
import { fetchEncryptionSyncDelta } from './syncDelta'

function fakeHttp(responseJson: string): HttpRequester & {
  calls: Array<{
    method: string
    path: string
    queryParams: Record<string, string>
    body: string | undefined
  }>
} {
  const calls: Array<{
    method: string
    path: string
    queryParams: Record<string, string>
    body: string | undefined
  }> = []
  return {
    authedRequest: async (method, path, queryParams, body) => {
      calls.push({ method, path, queryParams, body })
      return responseJson
    },
    calls,
  }
}

describe('fetchEncryptionSyncDelta', () => {
  it('fetches an initial sync with no since token', async () => {
    const http = fakeHttp('{}')
    const encryptionSlice = vi.fn(() => ({}))
    await fetchEncryptionSyncDelta(http, null, encryptionSlice)
    expect(http.calls).toEqual([
      {
        method: 'GET',
        path: '/_matrix/client/v3/sync',
        queryParams: { timeout: '0' },
        body: undefined,
      },
    ])
  })

  it('carries the since token when one is held', async () => {
    const http = fakeHttp('{}')
    const encryptionSlice = vi.fn(() => ({}))
    await fetchEncryptionSyncDelta(http, 's_123', encryptionSlice)
    expect(http.calls[0]?.queryParams).toEqual({
      timeout: '0',
      since: 's_123',
    })
  })

  it('parses the response and reduces it through the injected encryptionSlice', async () => {
    const http = fakeHttp(
      '{"device_lists":{"changed":["@a:x"]},"next_batch":"s_2"}',
    )
    const encryptionSlice = vi.fn(() => ({
      changed_devices: { changed: ['@a:x'], left: [] },
      next_batch_token: 's_2',
    }))
    const result = await fetchEncryptionSyncDelta(http, null, encryptionSlice)
    expect(encryptionSlice).toHaveBeenCalledWith({
      device_lists: { changed: ['@a:x'] },
      next_batch: 's_2',
    })
    expect(result.delta).toEqual({
      changed_devices: { changed: ['@a:x'], left: [] },
      next_batch_token: 's_2',
    })
    expect(result.nextBatchToken).toBe('s_2')
  })

  it('reports an undefined next batch token when the slice names none', async () => {
    const http = fakeHttp('{}')
    const result = await fetchEncryptionSyncDelta(http, null, () => ({}))
    expect(result.nextBatchToken).toBeUndefined()
  })

  it('does not reduce a response that fails to parse as JSON', async () => {
    const http = fakeHttp('not json')
    const encryptionSlice = vi.fn(() => ({}))
    await expect(
      fetchEncryptionSyncDelta(http, null, encryptionSlice),
    ).rejects.toThrow()
    expect(encryptionSlice).not.toHaveBeenCalled()
  })
})
