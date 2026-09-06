import { describe, expect, it } from 'vitest'

import { blindNotification, readNotification } from './notifying'

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
