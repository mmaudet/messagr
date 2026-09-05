import { describe, expect, it } from 'vitest'

import type { HttpRequester } from './pump'
import { fetchSync, readChangedScopes, readNextBatch } from './syncResponse'

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

describe('fetchSync', () => {
  it('omits since entirely on the first poll of an install', async () => {
    const http = fakeHttp('{}')
    await fetchSync(http, null, 0)
    expect(http.calls).toEqual([
      {
        method: 'GET',
        path: '/_matrix/client/v3/sync',
        queryParams: { timeout: '0' },
        body: undefined,
      },
    ])
  })

  it('resumes from a token, and holds the poll open for the given timeout', async () => {
    const http = fakeHttp('{}')
    await fetchSync(http, 's_12', 30_000)
    expect(http.calls[0]?.queryParams).toEqual({
      timeout: '30000',
      since: 's_12',
    })
  })

  it('parses the response', async () => {
    const http = fakeHttp('{"next_batch":"s_2"}')
    expect(await fetchSync(http, null, 0)).toEqual({ next_batch: 's_2' })
  })

  it('rejects a response that is not JSON rather than returning something empty', async () => {
    await expect(fetchSync(fakeHttp('not json'), null, 0)).rejects.toThrow()
  })
})

describe('readNextBatch', () => {
  it('reads the token', () => {
    expect(readNextBatch({ next_batch: 's_2' })).toBe('s_2')
  })

  it('is null when the response carries none', () => {
    expect(readNextBatch({})).toBeNull()
  })

  it('is null for a token that is empty or not a string', () => {
    expect(readNextBatch({ next_batch: '' })).toBeNull()
    expect(readNextBatch({ next_batch: 12 })).toBeNull()
  })
})

describe('readChangedScopes', () => {
  it('reports a joined space whose timeline carries an event', () => {
    expect(
      readChangedScopes({
        rooms: {
          join: {
            '!a:x': { timeline: { events: [{ type: 'm.room.encrypted' }] } },
          },
        },
      }),
    ).toEqual(['!a:x'])
  })

  it('reports a membership change, which arrives in the same timeline', () => {
    expect(
      readChangedScopes({
        rooms: {
          join: {
            '!a:x': { timeline: { events: [{ type: 'm.room.member' }] } },
          },
        },
      }),
    ).toEqual(['!a:x'])
  })

  it('does not report a space whose timeline is empty', () => {
    expect(
      readChangedScopes({
        rooms: { join: { '!a:x': { timeline: { events: [] } } } },
      }),
    ).toEqual([])
  })

  it('does not report a space that moved only in a section nothing reads', () => {
    expect(
      readChangedScopes({
        rooms: {
          join: { '!a:x': { ephemeral: { events: [{ type: 'm.typing' }] } } },
        },
      }),
    ).toEqual([])
  })

  it('reports every joined space that moved', () => {
    expect(
      readChangedScopes({
        rooms: {
          join: {
            '!a:x': { timeline: { events: [{}] } },
            '!b:x': { timeline: { events: [] } },
            '!c:x': { timeline: { events: [{}] } },
          },
        },
      }),
    ).toEqual(['!a:x', '!c:x'])
  })

  it('finds nothing in a response with no rooms at all', () => {
    expect(readChangedScopes({})).toEqual([])
    expect(readChangedScopes({ rooms: {} })).toEqual([])
  })

  it('finds nothing rather than throwing when the shape is not what it expects', () => {
    expect(readChangedScopes({ rooms: 'unexpected' })).toEqual([])
    expect(readChangedScopes({ rooms: { join: [] } })).toEqual([])
    expect(readChangedScopes({ rooms: { join: { '!a:x': null } } })).toEqual([])
    expect(
      readChangedScopes({ rooms: { join: { '!a:x': { timeline: 7 } } } }),
    ).toEqual([])
  })
})
