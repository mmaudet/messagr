import { describe, expect, it } from 'vitest'

import { downloadKeys, publishVersion, readVersion } from './backupCalls'
import type { HttpRequester } from './pump'

type Seen = {
  method?: string
  path?: string
  query?: Record<string, string>
  body?: string
}

function http(
  respond: (seen: Seen) => Promise<string>,
): HttpRequester & { seen: Seen } {
  const seen: Seen = {}
  return {
    seen,
    authedRequest: async (method, path, query, body) => {
      seen.method = method
      seen.path = path
      seen.query = query
      seen.body = body
      return respond(seen)
    },
  }
}

/** What a Matrix 404 looks like to the caller that has to recognise it. */
class NotFound extends Error {
  readonly errcode = 'M_NOT_FOUND'
}
const isNotFound = (cause: unknown) => cause instanceof NotFound

describe('publishing a backup version', () => {
  it('posts the body the bridge produced and answers with the version', async () => {
    const transport = http(async () => '{"version":"947281"}')
    const body = { algorithm: 'm.megolm_backup.v1.curve25519-aes-sha2' }

    expect(await publishVersion(transport, body)).toBe('947281')
    expect(transport.seen.method).toBe('POST')
    expect(transport.seen.path).toBe('/_matrix/client/v3/room_keys/version')
    expect(transport.seen.body).toBe(JSON.stringify(body))
  })

  it('keeps a six-digit version exactly as it came', async () => {
    // Continuwuity 26.7.2 answers with a six-digit integer where Synapse
    // answers with a counter from "1". The leading zero is the assertion: a
    // round trip through a number loses it and the homeserver then answers
    // for some other backup, or for none.
    const transport = http(async () => '{"version":"047281"}')

    expect(await publishVersion(transport, {})).toBe('047281')
  })

  it('refuses a version that is not a string', async () => {
    // Exactly what `{"version": 947281}` would give a client that trusted
    // JSON.parse. Refused here rather than carried, because the bridge and
    // the query string both want the opaque string the specification
    // describes.
    const transport = http(async () => '{"version":947281}')

    await expect(publishVersion(transport, {})).rejects.toThrow(/version/)
  })

  it('refuses an answer with no version at all', async () => {
    await expect(
      publishVersion(
        http(async () => '{}'),
        {},
      ),
    ).rejects.toThrow(/version/)
  })
})

describe('reading the backup on this account', () => {
  it('answers with the version and the whole description', async () => {
    const described = {
      algorithm: 'm.megolm_backup.v1.curve25519-aes-sha2',
      auth_data: { public_key: 'c3VyZmFjZQ' },
      version: '947281',
      count: 1240,
      etag: 'opaque',
    }
    const transport = http(async () => JSON.stringify(described))

    const found = await readVersion(transport, isNotFound)

    expect(found?.version).toBe('947281')
    // The whole thing, because `restoreKeyMatches` reads `algorithm` and
    // `auth_data` out of it and a caller should not have to take it apart.
    expect(found?.info).toEqual(described)
    expect(transport.seen.method).toBe('GET')
  })

  it('says there is none when the homeserver says not found', async () => {
    // The ordinary answer for most accounts, and what `offerRestore` turns
    // on. Reported as an absence rather than raised as a failure.
    const transport = http(async () => {
      throw new NotFound('no backup')
    })

    expect(await readVersion(transport, isNotFound)).toBeNull()
  })

  it('lets any other refusal through', async () => {
    // A caller that could not tell "there is none" from "the server is
    // unreachable" would tell somebody their past is gone during an outage.
    const transport = http(async () => {
      throw new Error('502 Bad Gateway')
    })

    await expect(readVersion(transport, isNotFound)).rejects.toThrow(/502/)
  })

  it('treats a description with no usable version as no backup', async () => {
    // Safe direction: it offers nothing, rather than offering a restore that
    // cannot run.
    const transport = http(async () => '{"algorithm":"whatever"}')

    expect(await readVersion(transport, isNotFound)).toBeNull()
  })
})

describe('downloading a backup', () => {
  it('asks for the named version in the query string', async () => {
    const held = { rooms: { '!scope:example.org': { sessions: {} } } }
    const transport = http(async () => JSON.stringify(held))

    expect(await downloadKeys(transport, '047281')).toEqual(held)
    expect(transport.seen.path).toBe('/_matrix/client/v3/room_keys/keys')
    // In the query string and not the path, and not turned into a number.
    expect(transport.seen.query).toEqual({ version: '047281' })
    expect(transport.seen.body).toBeUndefined()
  })
})
