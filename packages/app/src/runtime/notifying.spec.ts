import { describe, expect, it } from 'vitest'

import {
  BLIND_ID,
  blindNotification,
  readNotification,
  scopeOfPress,
} from './notifying'

describe('blindNotification', () => {
  it('names nobody and quotes nothing', () => {
    // The assertion #90 asks to be pinned. What woke the device carried no
    // sender, no conversation and no content, so nothing here can name one --
    // and a test that only read the copy file would pass whatever the copy
    // said, which is why this looks for the shapes rather than the strings.
    const blind = blindNotification()
    const wire = `${blind.title} ${blind.body}`
    expect(wire).not.toMatch(/@[a-z0-9._=\-/]+:/i)
    expect(wire).not.toMatch(/![a-z0-9._=\-/]+:/i)
    expect(wire).not.toMatch(/\$[A-Za-z0-9]/)
  })

  it('says something arrived, which is all it knows', () => {
    expect(blindNotification().body.length).toBeGreaterThan(0)
  })

  it('collapses onto one, because every blind wake says the same thing', () => {
    expect(blindNotification().id).toBe(blindNotification().id)
  })
})

describe('readNotification', () => {
  it('is keyed by the conversation, so a second message replaces the first', () => {
    const one = readNotification('!a:x', 'Maria', 'first')
    const two = readNotification('!a:x', 'Maria', 'second')
    expect(one.id).toBe(two.id)
  })

  it('keys two conversations apart', () => {
    expect(readNotification('!a:x', 'Maria', 'hi').id).not.toBe(
      readNotification('!b:x', 'Jo', 'hi').id,
    )
  })

  it('carries what was decrypted, because by then it is on this device', () => {
    const read = readNotification('!a:x', 'Maria', 'see you at eight')
    expect(read.title).toBe('Maria')
    expect(read.body).toBe('see you at eight')
  })
})

describe('scopeOfPress', () => {
  it('routes a read notification to its conversation', () => {
    expect(scopeOfPress('!a:messagr.eu')).toBe('!a:messagr.eu')
  })

  it('routes the blind one nowhere', () => {
    // Nothing that woke the device said which conversation, so there is none
    // to open. Tapping it opens the application, which then syncs and shows
    // the list with something waiting -- the honest destination.
    expect(scopeOfPress(BLIND_ID)).toBeNull()
  })

  it('routes a notification with no id nowhere either', () => {
    expect(scopeOfPress(undefined)).toBeNull()
  })

  it('routes a notification this application did not draw to the list', () => {
    // SINCE #341 THE PUSH ITSELF CAN DISPLAY SOMETHING. ADR-0009's visible
    // fallback is an `aps.alert`, which iOS shows without the application
    // ever running -- on a phone that is killed and locked, which is the
    // whole point of it. Its identifier is then Apple's, a value this
    // application never chose, and every identifier used to be read as a
    // conversation to open.
    //
    // The ADR asks for the other half in the same breath: "A notification the
    // user taps must land somewhere sensible even when the wake failed and
    // the application does not yet know what arrived." Somewhere sensible is
    // the list. A room identifier begins with `!`; a system identifier does
    // not, and opening a conversation named after one is a screen for a
    // conversation that does not exist.
    expect(scopeOfPress('8C1E0C4F-0B1B-4D5B-9A2E-9E7E2B1A0000')).toBeNull()
    expect(scopeOfPress('')).toBeNull()
    expect(scopeOfPress('@her:messagr.eu')).toBeNull()
  })
})
