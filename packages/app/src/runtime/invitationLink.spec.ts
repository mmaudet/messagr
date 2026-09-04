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
    // the operating system rather than a browser must open the same door.
    expect(parseInvitationLink('messagr://messagr.eu/i/abc123')?.token).toBe(
      'abc123',
    )
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
