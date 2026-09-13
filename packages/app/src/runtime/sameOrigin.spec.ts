import { describe, expect, it } from 'vitest'

import { sameOrigin } from './sameOrigin'

describe('sameOrigin', () => {
  it('holds for the same scheme, host and path-free base URL', () => {
    expect(sameOrigin('https://messagr.eu', 'https://messagr.eu')).toBe(true)
  })

  it('ignores a path on either side, comparing only the origin', () => {
    // A homeserver base URL may carry a path; the origin is still the part
    // that decides where a request goes.
    expect(
      sameOrigin('https://messagr.eu/i/abc123', 'https://messagr.eu'),
    ).toBe(true)
  })

  it('treats the host case-insensitively', () => {
    // Host names are not case-sensitive. A link written with a capital and a
    // session stored in lower case name the same instance.
    expect(sameOrigin('https://MESSAGR.EU', 'https://messagr.eu')).toBe(true)
    expect(sameOrigin('https://Messagr.Eu/i/x', 'https://messagr.eu')).toBe(
      true,
    )
  })

  it('reads an explicit default port as the implicit one', () => {
    expect(sameOrigin('https://messagr.eu:443', 'https://messagr.eu')).toBe(
      true,
    )
  })

  it('holds when both name the same non-default port', () => {
    expect(
      sameOrigin(
        'https://bench.example:8448/i/x',
        'https://bench.example:8448',
      ),
    ).toBe(true)
  })

  it('fails when only one names a non-default port', () => {
    // A bench on another port is another instance, and credentials for one do
    // not belong to the other.
    expect(sameOrigin('https://messagr.eu:8448', 'https://messagr.eu')).toBe(
      false,
    )
  })

  it('fails for different hosts', () => {
    expect(sameOrigin('https://other.example', 'https://messagr.eu')).toBe(
      false,
    )
  })

  it('is not fooled by a host placed in the userinfo', () => {
    // `messagr.eu@other.example` is a request to other.example carrying a
    // username; the origin is other.example, and it is not messagr.eu.
    expect(
      sameOrigin('https://messagr.eu@other.example/i/x', 'https://messagr.eu'),
    ).toBe(false)
  })

  it('does not depend on the runtime URL, which React Native reports wrongly', () => {
    // The same standin invitationLink.spec.ts uses: on a device the platform
    // URL answers an empty host for a non-http scheme, so a comparison that
    // consulted it would let a credential leave for a host it misread. These
    // tests run on Node, whose URL is correct, so only refusing to touch it
    // exercises the code the device runs.
    const real = globalThis.URL
    globalThis.URL = class {
      constructor() {
        throw new Error('the comparison must not depend on the runtime URL')
      }
    } as unknown as typeof globalThis.URL
    try {
      expect(sameOrigin('https://messagr.eu', 'https://messagr.eu')).toBe(true)
      expect(sameOrigin('https://other.example', 'https://messagr.eu')).toBe(
        false,
      )
    } finally {
      globalThis.URL = real
    }
  })

  it('refuses rather than matches when a side is not a URL it can read', () => {
    expect(sameOrigin('not a url', 'https://messagr.eu')).toBe(false)
    expect(sameOrigin('https://messagr.eu', '')).toBe(false)
  })
})
