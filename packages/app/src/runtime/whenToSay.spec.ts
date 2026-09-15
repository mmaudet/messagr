import { describe, expect, it } from 'vitest'

import { whenToSay } from './whenToSay'

describe('whenToSay', () => {
  it('says a link was used only after the pump, which a stranded device never reaches', () => {
    // « La conversation qu'elle ouvre va apparaître » is true of a device that
    // can read what arrives. A device stranded by a reinstall cannot, and its
    // launch stops before the pump, so that is where the sentence waits.
    expect(whenToSay({ kind: 'used' })).toBe('after-the-pump')
  })

  it('says a link was refused only after the pump, as it always was', () => {
    // « Demandez-en une nouvelle » sends somebody to ask for another link, so
    // it is said only of a link the service refused. It used to be said of a
    // service that could not be reached too, on the reasoning that such a
    // launch stops before the pump. A 502 from nginx in front of a restarting
    // service does not stop it (#306): that claim is `retry` now.
    expect(
      whenToSay({ kind: 'refused', reason: 'this invitation cannot be used' }),
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
