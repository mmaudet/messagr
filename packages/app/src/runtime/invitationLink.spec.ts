import { describe, expect, it } from 'vitest'

import { parseInvitationLink } from './invitationLink'

describe('parseInvitationLink', () => {
  it('reads the token and the instance out of a link', () => {
    expect(parseInvitationLink('https://messagr.eu/i/abc123')).toEqual({
      token: 'abc123',
      homeserver: 'https://messagr.eu',
      service: 'https://messagr.eu/_messagr',
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
