import { describe, expect, it } from 'vitest'

import { spentLinks } from './spentLinks'

const LINK = 'https://messagr.eu/i/abc123'

describe('spentLinks', () => {
  it('spends a link the first time it is seen and not again', () => {
    // The duplicate a cold launch can produce: getInitialURL and then a url
    // event, the same string twice. The second is turned away.
    const links = spentLinks()
    expect(links.fresh(LINK)).toBe(true)
    expect(links.fresh(LINK)).toBe(false)
  })

  it('turns the same link away however many times it arrives', () => {
    const links = spentLinks()
    expect(links.fresh(LINK)).toBe(true)
    expect(links.fresh(LINK)).toBe(false)
    expect(links.fresh(LINK)).toBe(false)
  })

  it('spends two different invitations each on its own', () => {
    // Two real invitations differ in their token and so in their string, and
    // neither is the other's duplicate.
    const links = spentLinks()
    expect(links.fresh('https://messagr.eu/i/abc123')).toBe(true)
    expect(links.fresh('https://messagr.eu/i/def456')).toBe(true)
  })

  it('keeps the application-scheme form apart from the https form', () => {
    // They are the same invitation, but they are not the string the system
    // hands over twice in one launch: only one scheme is delivered per launch.
    // Treating them as one would need parsing this deliberately does not do.
    const links = spentLinks()
    expect(links.fresh('https://messagr.eu/i/abc123')).toBe(true)
    expect(links.fresh('messagr://messagr.eu/i/abc123')).toBe(true)
  })

  it('starts empty for each run, so a relaunch can spend the same link again', () => {
    // A claim a previous run did not finish must be retriable. The keystore is
    // what remembers a session that was actually obtained, not this.
    const first = spentLinks()
    const second = spentLinks()
    expect(first.fresh(LINK)).toBe(true)
    expect(second.fresh(LINK)).toBe(true)
  })
})
