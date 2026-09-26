import { describe, expect, it } from 'vitest'

import { parseInvitationLink } from './invitationLink'

describe('parseInvitationLink', () => {
  it('reads the token and the instance out of a link', () => {
    expect(parseInvitationLink('https://messagr.eu/i/abc123')).toEqual({
      token: 'abc123',
      homeserver: 'https://messagr.eu',
      service: 'https://messagr.eu/_messagr',
      declared: null,
    })
  })

  it('keeps a non-default port, because a bench is not the production instance', () => {
    const link = parseInvitationLink('https://bench.example.org:8448/i/xyz')
    expect(link?.homeserver).toBe('https://bench.example.org:8448')
  })

  it('accepts the application scheme as well as https', () => {
    // The specification's own protocol handler. A link that arrives through
    // the operating system rather than a browser must open the same door, and
    // the whole result is asserted rather than the token alone: on a device it
    // was the host that came back empty, which the token alone never showed.
    expect(parseInvitationLink('messagr://messagr.eu/i/abc123')).toEqual({
      token: 'abc123',
      homeserver: 'https://messagr.eu',
      service: 'https://messagr.eu/_messagr',
      declared: null,
    })
  })

  it('does not consult the runtime for a URL, because React Native lies about one', () => {
    // React Native ships a URL polyfill whose accessors hard-code the http
    // schemes, so it reads `messagr://host/i/tok` as host '' and path '/' --
    // exactly the application's own scheme, the only one a device ever hands
    // over. These tests run on Node, whose URL is correct, so no ordinary
    // assertion here can tell the two runtimes apart. That is how the defect
    // reached an emulator. Standing in a hostile URL is what closes the gap.
    const real = globalThis.URL
    globalThis.URL = class {
      constructor() {
        throw new Error('the parser must not depend on the runtime URL')
      }
    } as unknown as typeof globalThis.URL
    try {
      expect(parseInvitationLink('messagr://messagr.eu/i/abc123')).toEqual({
        token: 'abc123',
        homeserver: 'https://messagr.eu',
        service: 'https://messagr.eu/_messagr',
        declared: null,
      })
    } finally {
      globalThis.URL = real
    }
  })

  it('tolerates a trailing slash and an upper-case host, but never touches the token', () => {
    // Host names are case-insensitive and this one becomes a base URL. A
    // token is a credential: lowering it would silently hand the service
    // something other than what was issued.
    expect(parseInvitationLink('messagr://Messagr.EU/i/AbC123/')).toEqual({
      token: 'AbC123',
      homeserver: 'https://messagr.eu',
      service: 'https://messagr.eu/_messagr',
      declared: null,
    })
  })

  it('ignores anything after the token, so a tracking suffix cannot break entry', () => {
    expect(
      parseInvitationLink('https://messagr.eu/i/abc123?utm=x')?.token,
    ).toBe('abc123')
  })

  it('refuses a link that names no token', () => {
    expect(parseInvitationLink('https://messagr.eu/i/')).toBeNull()
    expect(parseInvitationLink('https://messagr.eu/')).toBeNull()
  })

  it('refuses a path that is not an invitation', () => {
    // Not every link into this instance is an invitation, and treating one as
    // such would spend a token that was never offered.
    expect(parseInvitationLink('https://messagr.eu/about/i/abc')).toBeNull()
    expect(parseInvitationLink('messagr://messagr.eu/i/abc/extra')).toBeNull()
  })

  it('refuses a link that names no host', () => {
    expect(parseInvitationLink('messagr:///i/abc123')).toBeNull()
  })

  it('refuses what is not a link at all, rather than throwing', () => {
    expect(parseInvitationLink('not a link')).toBeNull()
    expect(parseInvitationLink('')).toBeNull()
  })

  it('refuses a scheme that is neither https nor the application', () => {
    // http would carry the token in clear text, and a token is a bearer
    // credential: whoever reads it is the invited person.
    expect(parseInvitationLink('http://messagr.eu/i/abc123')).toBeNull()
  })
})

describe('the name the link carries', () => {
  it('reads the name the inviter gave themselves, out of the fragment', () => {
    // #329. A FRAGMENT NEVER REACHES THE SERVER -- not nginx, not its log,
    // not an intermediary -- which is what lets a name travel with an
    // invitation without the service ever holding it.
    expect(parseInvitationLink('https://messagr.eu/i/abc123#n=Nadia')).toEqual({
      token: 'abc123',
      homeserver: 'https://messagr.eu',
      service: 'https://messagr.eu/_messagr',
      declared: 'Nadia',
    })
  })

  it('reads it off the application scheme too, which is the same link', () => {
    expect(
      parseInvitationLink('messagr://messagr.eu/i/abc123#n=Nadia')?.declared,
    ).toBe('Nadia')
  })

  it('reads it past a trailing slash and a tracking query', () => {
    expect(
      parseInvitationLink('https://messagr.eu/i/abc123/?utm=x#n=Nadia')
        ?.declared,
    ).toBe('Nadia')
  })

  it('NEVER reads a name out of the query, which the server would see', () => {
    // The query reaches nginx and its log; #313 took the token out of that
    // log and nothing may put a name back into it. A `?n=` is read as what
    // it is -- a tracking parameter -- and ignored.
    const link = parseInvitationLink('https://messagr.eu/i/abc123?n=Nadia')
    expect(link?.token).toBe('abc123')
    expect(link?.declared).toBeNull()
  })

  it('still reads the token when the fragment carries nothing usable', () => {
    // The link is what gets somebody in; the name is a courtesy on top of
    // it. A fragment that arrived mangled must never cost an entry.
    expect(parseInvitationLink('https://messagr.eu/i/abc123#n=%')).toEqual({
      token: 'abc123',
      homeserver: 'https://messagr.eu',
      service: 'https://messagr.eu/_messagr',
      declared: null,
    })
    expect(
      parseInvitationLink('https://messagr.eu/i/abc123#utm=x')?.declared,
    ).toBeNull()
  })
})
