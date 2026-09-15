import { describe, expect, it } from 'vitest'

import {
  backupHoldsBack,
  backupOnScreen,
  type BackupDrawn,
} from './backupOnScreen'

/** Sauvegarde, open in Réglages, with nothing over it. */
const SAUVEGARDE: BackupDrawn = {
  backupPrompt: null,
  openScope: null,
  tab: 'settings',
  backupOpen: true,
  restorePrompt: null,
}

/** A conversation, open from the list. */
const CONVERSATION: BackupDrawn = {
  ...SAUVEGARDE,
  openScope: '!room:bench.example',
  tab: 'chat',
  backupOpen: false,
}

describe('Android back, for the backup', () => {
  // #284, found in review: back was held everywhere while an acceptance ran, a
  // conversation included. A keychain write or an `enableKeyBackup` that never
  // settles left back dead until the process died.
  it('is left alone in a conversation while an acceptance runs', () => {
    expect(backupHoldsBack(backupOnScreen(CONVERSATION), 'accept')).toBe(false)
  })

  it('is left alone on Réglages, once Sauvegarde is left, while a replacement runs', () => {
    const settings = { ...SAUVEGARDE, backupOpen: false }

    expect(backupHoldsBack(backupOnScreen(settings), 'replace')).toBe(false)
  })

  it('is held on Sauvegarde while a gesture runs, where what comes of it is said', () => {
    expect(backupHoldsBack(backupOnScreen(SAUVEGARDE), 'accept')).toBe(true)
    expect(backupHoldsBack(backupOnScreen(SAUVEGARDE), 'replace')).toBe(true)
  })

  it('is left alone on Sauvegarde when nothing runs', () => {
    expect(backupHoldsBack(backupOnScreen(SAUVEGARDE), null)).toBe(false)
  })

  it('is held while the offer or the key screen covers everything, whatever runs', () => {
    // Both cover a conversation as well: they are drawn over the whole of the
    // application, and their buttons are the way out.
    const offer = { ...CONVERSATION, backupPrompt: 'offering' } as const
    const key = {
      ...CONVERSATION,
      backupPrompt: { restoreKey: 'EsTx aaaa bbbb cccc' },
    }

    expect(backupHoldsBack(backupOnScreen(offer), null)).toBe(true)
    expect(backupHoldsBack(backupOnScreen(offer), 'accept')).toBe(true)
    expect(backupHoldsBack(backupOnScreen(key), null)).toBe(true)
  })
})

describe('Sauvegarde, as the screen a failure is said on', () => {
  // #284, found in review: the restore overlay covers Sauvegarde, and a failure
  // that settled then was said behind it, card and announcement both.
  it('is not the screen showing under the restore overlay', () => {
    const offered = {
      ...SAUVEGARDE,
      restorePrompt: { stage: 'offering', unreadable: 3 },
    }
    const entering = { ...SAUVEGARDE, restorePrompt: { stage: 'entering' } }

    expect(backupOnScreen(offered).backupScreen).toBe(false)
    expect(backupOnScreen(entering).backupScreen).toBe(false)
  })

  it('is the screen showing with nothing over it', () => {
    expect(backupOnScreen(SAUVEGARDE).backupScreen).toBe(true)
  })
})
