import { describe, expect, it } from 'vitest'

import { afterReinstall } from './afterReinstall'

const LAUNCH = { claimed: false, storeExists: true, password: 'kept' }

describe('what a launch does about a store that is gone', () => {
  it('does nothing on an ordinary launch, which is almost every launch', () => {
    expect(afterReinstall(LAUNCH)).toEqual({ kind: 'ordinary' })
  })

  it('does nothing on the first launch after claiming', () => {
    // No store yet either, and it is not a reinstall: this launch is
    // creating the account rather than returning to one.
    expect(
      afterReinstall({ claimed: true, storeExists: false, password: null }),
    ).toEqual({ kind: 'ordinary' })
  })

  it('says it came back on the first launch of the device a lost access came back as (#391)', () => {
    // « Revenir sur ce compte » kept a new session while the old device's
    // machine still ran: its store is not there yet, and a launch that took
    // that for a reinstall would log in a second time and make another device.
    expect(
      afterReinstall({ ...LAUNCH, storeExists: false, newDevice: true }),
    ).toEqual({ kind: 'came-back' })
  })

  it('is an ordinary launch once the device that came back has its store', () => {
    expect(afterReinstall({ ...LAUNCH, newDevice: true })).toEqual({
      kind: 'ordinary',
    })
  })

  it('does not come back by itself when its server refused the token (#391)', () => {
    // Taken off the account, or the account gone: coming back is the
    // person's to ask for, never a reinstall's to do.
    expect(
      afterReinstall({ ...LAUNCH, storeExists: false, refused: true }),
    ).toEqual({ kind: 'lost' })
  })

  it('is lost rather than stranded when its server refused the token', () => {
    expect(
      afterReinstall({
        ...LAUNCH,
        storeExists: false,
        password: null,
        refused: true,
      }),
    ).toEqual({ kind: 'lost' })
  })

  it('leaves a refused token to the first sync when the store is there', () => {
    // An ordinary launch does not ask: its first sync hears the refusal.
    expect(afterReinstall({ ...LAUNCH, refused: true })).toEqual({
      kind: 'ordinary',
    })
  })

  it('comes back as a new device when a password was kept', () => {
    expect(afterReinstall({ ...LAUNCH, storeExists: false })).toEqual({
      kind: 'reenter',
      password: 'kept',
    })
  })

  it('is stranded when the store is gone and no password was kept', () => {
    // An account claimed before the password was kept, or a keystore that
    // would not give it up. Nothing may be published under the old device
    // identifier either way.
    expect(
      afterReinstall({ ...LAUNCH, storeExists: false, password: null }),
    ).toEqual({ kind: 'stranded' })
  })

  it('holds a password without a missing store as an ordinary launch', () => {
    // The password is kept on every device from now on. Its presence is not
    // an event; the store's absence is.
    expect(afterReinstall({ ...LAUNCH, password: 'kept' })).toEqual({
      kind: 'ordinary',
    })
  })
})
