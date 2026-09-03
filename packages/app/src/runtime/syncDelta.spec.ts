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
  it('fetches one non-blocking sync', async () => {
    const http = fakeHttp('{}')
    const encryptionSlice = vi.fn(() => ({}))
    await fetchEncryptionSyncDelta(http, encryptionSlice)
    expect(http.calls).toEqual([
      {
        method: 'GET',
        path: '/_matrix/client/v3/sync',
        queryParams: { timeout: '0' },
        body: undefined,
      },
    ])
  })

  it('parses the response and reduces it through the injected encryptionSlice', async () => {
    const http = fakeHttp(
      '{"device_lists":{"changed":["@a:x"]},"next_batch":"s_2"}',
    )
    const encryptionSlice = vi.fn(() => ({
      changed_devices: { changed: ['@a:x'], left: [] },
      next_batch_token: 's_2',
    }))
    const delta = await fetchEncryptionSyncDelta(http, encryptionSlice)
    expect(encryptionSlice).toHaveBeenCalledWith({
      device_lists: { changed: ['@a:x'] },
      next_batch: 's_2',
    })
    expect(delta).toEqual({
      changed_devices: { changed: ['@a:x'], left: [] },
      next_batch_token: 's_2',
    })
  })

  it('does not reduce a response that fails to parse as JSON', async () => {
    const http = fakeHttp('not json')
    const encryptionSlice = vi.fn(() => ({}))
    await expect(
      fetchEncryptionSyncDelta(http, encryptionSlice),
    ).rejects.toThrow()
    expect(encryptionSlice).not.toHaveBeenCalled()
  })
})
