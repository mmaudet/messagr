import { describe, expect, it } from 'vitest'

import { whatALinkSays, whatIsKnown } from './invitationOnScreen'

const named = new Map([['@her:messagr.eu', 'Nadia']])

describe('whatIsKnown', () => {
  it('carries the conversation, which is what the two actions act on', () => {
    const known = whatIsKnown(
      { scope: '!a:messagr.eu', from: '@her:messagr.eu' },
      '@me:messagr.eu',
      new Map(),
    )
    expect(known.scope).toBe('!a:messagr.eu')
  })

  it('calls the account by the name this device gave it', () => {
    const known = whatIsKnown(
      { scope: '!a:messagr.eu', from: '@her:messagr.eu' },
      '@me:messagr.eu',
      named,
    )
    expect(known).toMatchObject({ who: 'Nadia', named: true })
  })

  it('falls back to the localpart, which is what a row does', () => {
    // `givenName.ts` argues the fallback at length: the `@prefix#SUFFIX` form
    // is not minted yet, and inventing a suffix would invent structure.
    const known = whatIsKnown(
      { scope: '!a:messagr.eu', from: '@rabr642vve6v:messagr.eu' },
      '@me:messagr.eu',
      new Map(),
    )
    expect(known).toMatchObject({ who: '@rabr642vve6v', named: false })
  })

  it('draws the identifier itself under the name', () => {
    const known = whatIsKnown(
      { scope: '!a:messagr.eu', from: '@her:messagr.eu' },
      '@me:messagr.eu',
      named,
    )
    expect(known.identifier).toBe('@her:messagr.eu')
  })

  it('reads the instance off the identifier', () => {
    const known = whatIsKnown(
      { scope: '!a:messagr.eu', from: '@her:messagr.eu' },
      '@me:messagr.eu',
      new Map(),
    )
    expect(known).toMatchObject({ instance: 'messagr.eu', elsewhere: false })
  })

  it('says when the instance is not the one this account lives on', () => {
    const known = whatIsKnown(
      { scope: '!a:other.example', from: '@her:other.example' },
      '@me:messagr.eu',
      new Map(),
    )
    expect(known).toMatchObject({
      instance: 'other.example',
      elsewhere: true,
    })
  })

  it('keeps the port, which is part of the server name', () => {
    const known = whatIsKnown(
      { scope: '!a:x', from: '@her:other.example:8448' },
      '@me:messagr.eu',
      new Map(),
    )
    expect(known.instance).toBe('other.example:8448')
  })

  it('compares two spellings of one server as one server', () => {
    // A domain name reads the same in either case, and a screen that called
    // the account holder's own server somebody else's would be a warning
    // about nothing.
    const known = whatIsKnown(
      { scope: '!a:x', from: '@her:Messagr.EU' },
      '@me:messagr.eu',
      new Map(),
    )
    expect(known.elsewhere).toBe(false)
  })

  it('names nobody when the stripped state carried no creation event', () => {
    // A homeserver may leave `m.room.create` out, and then there is no
    // creator to name. The screen says that rather than drawing a blank line.
    const known = whatIsKnown(
      { scope: '!a:x', from: null },
      '@me:messagr.eu',
      named,
    )
    expect(known).toMatchObject({
      who: '',
      named: false,
      identifier: '',
      instance: null,
      elsewhere: false,
    })
  })

  it('names nobody rather than half of an identifier with no server', () => {
    const known = whatIsKnown(
      { scope: '!a:x', from: '@her' },
      '@me:messagr.eu',
      new Map(),
    )
    expect(known).toMatchObject({ who: '@her', instance: null })
  })

  it('carries no declared name, because nothing travels with a Matrix invitation', () => {
    // §13.26's « Se présente comme » is for a name its bearer declared, and
    // an invitation standing on the threshold carries none: the link it came
    // from was never held on this telephone. The screen must not borrow the
    // formula for a name this device gave somebody.
    const known = whatIsKnown(
      { scope: '!a:messagr.eu', from: '@her:messagr.eu' },
      '@me:messagr.eu',
      named,
    )
    expect(known).toMatchObject({ source: 'threshold', declared: '' })
  })
})

describe('whatALinkSays', () => {
  it('reads the declared name and the instance off the link itself', () => {
    expect(
      whatALinkSays({
        instance: 'messagr.eu',
        declared: 'Nadia',
        elsewhere: false,
        answered: false,
      }),
    ).toEqual({
      source: 'link',
      scope: '',
      declared: 'Nadia',
      who: '',
      named: false,
      identifier: '',
      instance: 'messagr.eu',
      elsewhere: false,
    })
  })

  it('names no identifier, because the link names none', () => {
    // THE TWO HALVES ARE COMPLEMENTARY, and that is structural. A link says
    // who the inviter claims to be and which instance it leads to, and knows
    // no Matrix identifier: the account is drawn at the moment the link is
    // spent, and nothing has been spent yet. An invitation on the threshold
    // is the other way round.
    const known = whatALinkSays({
      instance: 'messagr.eu',
      declared: null,
      elsewhere: false,
      answered: false,
    })
    expect(known.identifier).toBe('')
    expect(known.who).toBe('')
    expect(known.declared).toBe('')
  })

  it('carries through that the link leads somewhere else', () => {
    // Read by entry with `sameOrigin`, which is what already decides it, and
    // not guessed again here: an account may reach its server under a name
    // the identifier does not carry.
    expect(
      whatALinkSays({
        instance: 'other.example',
        declared: 'Nadia',
        elsewhere: true,
        answered: false,
      }),
    ).toMatchObject({ instance: 'other.example', elsewhere: true })
  })
})
