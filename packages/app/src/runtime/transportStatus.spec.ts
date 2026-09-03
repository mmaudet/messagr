import { describe, expect, it } from 'vitest'

import { computeTransportStatus } from './transportStatus'

const workingClient = {
  getCrypto: () => undefined,
  getHomeserverUrl: () => 'https://homeserver.invalid',
}

describe('computeTransportStatus', () => {
  it('reports the homeserver when the client is built with no crypto', () => {
    expect(
      computeTransportStatus(() => workingClient, 'https://homeserver.invalid'),
    ).toEqual({ created: true, homeserver: 'https://homeserver.invalid' })
  })

  it('refuses a client that already carries a crypto backend', () => {
    // ADR-0001 allows exactly one crypto implementation in the binary, and it
    // is the native bridge. A transport that initialised its own would be a
    // second one, so this is a refusal rather than a warning.
    const status = computeTransportStatus(
      () => ({ ...workingClient, getCrypto: () => ({ name: 'rust-crypto' }) }),
      'https://homeserver.invalid',
    )
    expect(status).toEqual({
      created: false,
      reason: 'the transport initialised its own crypto backend',
    })
  })

  it('refuses a client with the external-crypto flag on', () => {
    // The flag reads like a description of this exact architecture and does
    // the opposite: it sends plaintext into rooms the client believes are
    // encrypted, for a proxy that is archived. Asserted rather than assumed,
    // because nothing else in the application would notice it being on.
    const status = computeTransportStatus(
      () => ({ ...workingClient, usingExternalCrypto: true }),
      'https://homeserver.invalid',
    )
    expect(status).toEqual({
      created: false,
      reason: 'the transport would send plaintext into encrypted rooms',
    })
  })

  it('accepts the flag left off, which is the default the SDK applies', () => {
    const status = computeTransportStatus(
      () => ({ ...workingClient, usingExternalCrypto: false }),
      'https://homeserver.invalid',
    )
    expect(status.created).toBe(true)
  })

  it('carries the reason when the factory throws', () => {
    const status = computeTransportStatus(() => {
      throw new Error('crypto.getRandomValues is not a function')
    }, 'https://homeserver.invalid')
    expect(status).toEqual({
      created: false,
      reason: 'crypto.getRandomValues is not a function',
    })
  })

  it('survives a factory that rejects with something that is not an Error', () => {
    const status = computeTransportStatus(() => {
      throw 'nope'
    }, 'https://homeserver.invalid')
    expect(status.created).toBe(false)
  })

  it('passes the base url the caller asked for', () => {
    let seen = ''
    computeTransportStatus(opts => {
      seen = opts.baseUrl
      return workingClient
    }, 'https://elsewhere.invalid')
    expect(seen).toBe('https://elsewhere.invalid')
  })
})
