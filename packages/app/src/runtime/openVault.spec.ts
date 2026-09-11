import { describe, expect, it } from 'vitest'

import { openVault, type Opening } from './openVault'

const ARMOUR = '-----BEGIN MEGOLM SESSION DATA-----\nAdnk…'

/** What the bridge raises: a kind, not a sentence. */
function refusal(kind: string) {
  return Object.assign(new Error('refused'), { kind })
}

function opening(over: Partial<Opening> = {}): Opening {
  return {
    choose: async () => ({ picked: true, text: ARMOUR }),
    open: async () => ({ imported: 412 }),
    ...over,
  }
}

describe('opening a vault', () => {
  it('hands the file to the bridge and says what came back', async () => {
    const seen: { vault?: string; passphrase?: string } = {}

    const outcome = await openVault(
      opening({
        open: async (vault, passphrase) => {
          seen.vault = vault
          seen.passphrase = passphrase
          return { imported: 412 }
        },
      }),
      'un mot de passe',
    )

    expect(outcome).toEqual({ opened: true, imported: 412 })
    expect(seen).toEqual({ vault: ARMOUR, passphrase: 'un mot de passe' })
  })

  it('accepts a vault that came from somewhere else', async () => {
    // The acceptance criterion, and the whole reason for using the standard
    // Matrix format rather than one of this product's own: nothing here
    // knows or cares which client wrote the armour.
    const fromElement = '-----BEGIN MEGOLM SESSION DATA-----\nfromElement…'

    expect(
      await openVault(
        opening({ choose: async () => ({ picked: true, text: fromElement }) }),
        'x',
      ),
    ).toEqual({ opened: true, imported: 412 })
  })

  it('says nothing happened when nothing did', async () => {
    // A vault that held no key for this account is a true answer rather than
    // a failure, and the screen has a sentence for it.
    expect(
      await openVault(opening({ open: async () => ({ imported: 0 }) }), 'x'),
    ).toEqual({ opened: true, imported: 0 })
  })
})

describe('the two refusals that look alike', () => {
  it('tells a wrong passphrase from a file that is not a vault', async () => {
    // Collapsing these is the mistake `RecoveryKeyEntry` already refuses:
    // one sends somebody back to what they typed, the other back to which
    // file they chose, and a person told the wrong one hunts in the wrong
    // place.
    expect(
      await openVault(
        opening({
          open: () => Promise.reject(refusal('wrong_passphrase')),
        }),
        'x',
      ),
    ).toEqual({ opened: false, because: 'wrong-passphrase' })

    expect(
      await openVault(
        opening({
          open: () => Promise.reject(refusal('malformed_payload')),
        }),
        'x',
      ),
    ).toEqual({ opened: false, because: 'not-a-vault' })
  })

  it('answers `failed` for a cause it does not recognise', async () => {
    // Rather than guessing one of the two. Inventing a refusal would send
    // somebody looking in a place the product picked for them.
    expect(
      await openVault(
        opening({ open: () => Promise.reject(new Error('no space')) }),
        'x',
      ),
    ).toEqual({ opened: false, because: 'failed' })
  })

  it('reads the kind and never the message', async () => {
    // A message is a sentence somebody may translate; a kind is a contract.
    // This one says the right words and carries no kind at all.
    expect(
      await openVault(
        opening({
          open: () => Promise.reject(new Error('wrong_passphrase')),
        }),
        'x',
      ),
    ).toEqual({ opened: false, because: 'failed' })
  })
})

describe('the picker', () => {
  it('says cancelled, which the screen shows nothing for', async () => {
    expect(
      await openVault(
        opening({ choose: async () => ({ picked: false, cancelled: true }) }),
        'x',
      ),
    ).toEqual({ opened: false, because: 'cancelled' })
  })

  it('does not call a picker failure a cancel', async () => {
    // Saying « vous avez annulé » to somebody who did not is the product
    // telling them what they did.
    expect(
      await openVault(
        opening({ choose: async () => ({ picked: false, cancelled: false }) }),
        'x',
      ),
    ).toEqual({ opened: false, because: 'failed' })
  })

  it('survives a picker that throws instead of answering', async () => {
    expect(
      await openVault(
        opening({ choose: () => Promise.reject(new Error('no provider')) }),
        'x',
      ),
    ).toEqual({ opened: false, because: 'failed' })
  })

  it('never opens anything when the file was not chosen', async () => {
    let asked = false
    await openVault(
      opening({
        choose: async () => ({ picked: false, cancelled: true }),
        open: async () => {
          asked = true
          return { imported: 0 }
        },
      }),
      'x',
    )

    expect(asked).toBe(false)
  })
})
