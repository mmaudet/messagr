import { describe, expect, it } from 'vitest'

import { iceConfigFrom, type IceConfig } from './ice'

/**
 * The privacy rules, tested without a homeserver.
 *
 * This is why `iceConfigFrom` is pure. Every one of these is a way somebody's
 * address could reach the peer, and none of them should need a network to
 * catch.
 */

function config(answer: Parameters<typeof iceConfigFrom>[0]): IceConfig {
  const result = iceConfigFrom(answer)
  if (!result.ok)
    throw new Error(`expected a config, got ${result.failure.kind}`)
  return result.config
}

function failure(answer: Parameters<typeof iceConfigFrom>[0]) {
  const result = iceConfigFrom(answer)
  if (result.ok) throw new Error('expected a failure, got a config')
  return result.failure
}

describe('iceConfigFrom', () => {
  it('keeps a turn: uri', () => {
    expect(config({ uris: ['turn:relay.example.org:3478'] }).uris).toEqual([
      'turn:relay.example.org:3478',
    ])
  })

  it('keeps a turns: uri, which is the same thing over TLS', () => {
    expect(config({ uris: ['turns:relay.example.org:5349'] }).uris).toEqual([
      'turns:relay.example.org:5349',
    ])
  })

  it('drops a stun: uri, because STUN cannot relay', () => {
    // The whole point. A stun: URI under relay-only buys nothing -- it
    // discovers an address, it does not carry media -- and keeping it would
    // let a candidate be gathered that names this device.
    const kept = config({
      uris: ['stun:stun.example.org:3478', 'turn:relay.example.org:3478'],
    })
    expect(kept.uris).toEqual(['turn:relay.example.org:3478'])
  })

  it('reads the scheme without caring about its case', () => {
    // `TURN:` is the same URI. A filter that missed it would fail closed on a
    // homeserver that is correctly configured, which is a refusal nobody
    // could diagnose from the message.
    expect(
      config({ uris: ['TURNS:relay.example.org:5349'] }).uris,
    ).toHaveLength(1)
  })

  it('refuses when the homeserver offers nothing at all', () => {
    // 404 M_NOT_FOUND, or an endpoint that is not implemented. No relay, no
    // call: the alternative is this device's address on the wire to the peer
    // under an interface that says otherwise.
    expect(failure({ uris: [] }).kind).toBe('no-relay-configured')
    expect(failure({}).kind).toBe('no-relay-configured')
  })

  it('refuses differently when it offered something that cannot relay', () => {
    // Told apart on purpose: nothing offered is a homeserver with no relay,
    // and something offered that does not relay is an operator who meant to
    // configure one. Two different conversations, so two different answers.
    const why = failure({ uris: ['stun:stun.example.org:3478'] })
    expect(why.kind).toBe('no-relay-uris')
    expect(why.kind === 'no-relay-uris' && why.dropped).toBe(1)
  })

  it('never answers with a policy other than relay-only', () => {
    // There is one, and the type is what keeps it that way. This is the test
    // that fails the day somebody adds a second and forgets that adding it
    // here is the decision.
    expect(config({ uris: ['turn:relay.example.org'] }).transportPolicy).toBe(
      'relay-only',
    )
  })

  it('passes the credentials through untouched', () => {
    const kept = config({
      uris: ['turn:relay.example.org'],
      username: '1699999999:@her:example.org',
      password: 'c2VjcmV0',
      ttl: 86400,
    })
    expect(kept.username).toBe('1699999999:@her:example.org')
    expect(kept.credential).toBe('c2VjcmV0')
    expect(kept.ttlSeconds).toBe(86400)
  })

  it('survives an answer whose fields are the wrong type', () => {
    // A body off a network. Credentials that arrived as a number would fail
    // at the relay with a message about authentication rather than about a
    // malformed answer, which is a much longer afternoon.
    const kept = config({
      uris: ['turn:relay.example.org', 42, null],
      username: 7,
      ttl: 'soon',
    })
    expect(kept.uris).toEqual(['turn:relay.example.org'])
    expect(kept.username).toBe('')
    expect(kept.ttlSeconds).toBe(0)
  })
})
