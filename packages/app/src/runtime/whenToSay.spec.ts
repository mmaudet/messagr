import { describe, expect, it } from 'vitest'

import { whenToSay } from './whenToSay'

describe('whenToSay', () => {
  it('says a link was used only after the pump, which a stranded device never reaches', () => {
    // « La conversation qu'elle ouvre va apparaître » is true of a device that
    // can read what arrives. A device stranded by a reinstall cannot, and its
    // launch stops before the pump, so that is where the sentence waits.
    expect(whenToSay({ kind: 'used' })).toBe('after-the-pump')
  })

  it('says a link was refused only after the pump, which a launch that could not reach its service never reaches', () => {
    // « Demandez-en une nouvelle » sends somebody to ask for another link.
    // When the service could not be reached, the link may be perfectly good,
    // and the launch that could not reach it stops before the pump too.
    expect(
      whenToSay({
        kind: 'refused',
        reason: 'the invitation service could not be reached',
      }),
    ).toBe('after-the-pump')
  })

  it('says at once that a yes could not be carried out, however it failed', () => {
    // Said after the pump, these waited on the old account's server, which
    // somebody leaving it may no longer reach -- and then nothing was said. A
    // link that cannot be used, a service out of reach and a device that could
    // not keep the new account each have a sentence of their own, and each is
    // owed at once.
    const failures = [
      { kind: 'unusable', reason: 'this invitation cannot be used' },
      { kind: 'retry', reason: 'the invitation service could not be reached' },
      { kind: 'spent', reason: 'this device could not keep the new account' },
    ] as const
    expect(failures.map(failure => whenToSay(failure))).toEqual([
      'on-entry',
      'on-entry',
      'on-entry',
    ])
  })

  it('says at once why a link into another server was not followed', () => {
    // #304 asks for the reason however the rest of the launch goes: a device
    // that kept its account, or one told to reopen Messagr, is told why even
    // when it is stranded.
    expect(whenToSay({ kind: 'elsewhere' })).toBe('on-entry')
    expect(whenToSay({ kind: 'reopen' })).toBe('on-entry')
  })
})
