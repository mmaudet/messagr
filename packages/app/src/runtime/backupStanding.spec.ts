import { describe, expect, it } from 'vitest'

import { backupStanding, type BackupFacts } from './backupStanding'

/** A device backing up to the version its account currently holds. */
const SENDING: BackupFacts = {
  device: { enabled: true, total: 1240, backedUp: 1240 },
  account: '947281',
  writesTo: '947281',
}

describe('what Réglages may say about the backup', () => {
  it('says it is sending only when the account holds the version this device writes to', () => {
    // #323's first state, and the only one that may say « vos messages sont
    // sauvegardés ». `enabled` alone does not prove it: it means
    // `enableKeyBackup` was called in this process, and says nothing about
    // what the homeserver holds now.
    expect(backupStanding(SENDING)).toEqual({
      standing: 'sending',
      backedUp: 1240,
      total: 1240,
    })
  })

  it('says another backup replaced this one when the account holds a different version', () => {
    // #323's second state. The bridge goes on answering `enabled`, the local
    // count stagnates, and every upload is refused with
    // `M_WRONG_ROOM_KEYS_VERSION`. The screen said « sauvegardés » throughout.
    expect(backupStanding({ ...SENDING, account: '580042' })).toEqual({
      standing: 'superseded',
    })
  })

  it('says the same when the version this device writes to is gone from the account', () => {
    // Retired from another device, or by whoever holds the account. The
    // ticket puts « disparu ou remplacée » in one state on purpose: what the
    // person can do about either is the same two things.
    expect(backupStanding({ ...SENDING, account: null })).toEqual({
      standing: 'superseded',
    })
  })

  it('says the same when nothing here records which version this device writes to', () => {
    // The bridge is on and the keystore holds no commitment -- it refused to
    // answer, or it was never written. Nothing durable leaves this device
    // either way: `resumeKeyBackup` reads that entry and the next launch
    // resumes nothing, which is exactly what « plus rien ne part d'ici »
    // says. Claiming the first state here would be claiming what cannot be
    // checked, which is the whole complaint of #323.
    expect(backupStanding({ ...SENDING, writesTo: null })).toEqual({
      standing: 'superseded',
    })
  })

  it('says a backup exists that this device does not feed', () => {
    // #323's third state, and the one where an interrupted acceptance shows:
    // the version was published and the bridge was never turned on.
    expect(
      backupStanding({
        device: { enabled: false, total: 12, backedUp: 0 },
        account: '947281',
        writesTo: null,
      }),
    ).toEqual({ standing: 'dormant' })
  })

  it('says there is no backup when the account holds none and the bridge is off', () => {
    expect(
      backupStanding({
        device: { enabled: false, total: 12, backedUp: 0 },
        account: null,
        writesTo: null,
      }),
    ).toEqual({ standing: 'none' })
  })

  it('claims nothing when the homeserver did not answer', () => {
    // #323's fifth state. Not « pas de sauvegarde » and not « sauvegardés »:
    // those are the two states this must never be mistaken for, which is why
    // it is a state of its own rather than a default.
    expect(backupStanding({ ...SENDING, account: 'unanswered' })).toEqual({
      standing: 'unchecked',
    })
  })

  it('claims nothing when the homeserver did not answer and the bridge is off either', () => {
    // The same answer from the other side: a device whose bridge says off
    // cannot tell « aucune sauvegarde » from « une sauvegarde que cet
    // appareil n'alimente pas » without the account's answer.
    expect(
      backupStanding({
        device: { enabled: false, total: 0, backedUp: 0 },
        account: 'unanswered',
        writesTo: null,
      }),
    ).toEqual({ standing: 'unchecked' })
  })

  it('says the device could not read itself before anything about the account', () => {
    // A bridge that did not answer says nothing about the backup, and the
    // sentence for that already exists and is not the homeserver's. Asserted
    // with the account unanswered too, so the order is what is being proved.
    expect(
      backupStanding({ device: null, account: 'unanswered', writesTo: null }),
    ).toEqual({ standing: 'unreadable' })
    expect(
      backupStanding({ device: null, account: '947281', writesTo: '947281' }),
    ).toEqual({ standing: 'unreadable' })
  })

  it('carries both counts, so the screen can say what is still on its way', () => {
    // The progress line and the proof line are drawn from these, and only
    // the first state has either: a device that is not sending has no number
    // worth showing.
    expect(
      backupStanding({
        ...SENDING,
        device: { enabled: true, total: 1240, backedUp: 3 },
      }),
    ).toEqual({ standing: 'sending', backedUp: 3, total: 1240 })
  })
})
