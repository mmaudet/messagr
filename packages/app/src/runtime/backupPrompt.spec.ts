import { describe, expect, it } from 'vitest'

import {
  rememberBackupAsked,
  rememberReceived,
  shouldOfferBackup,
  type BackupPromptStores,
} from './backupPrompt'
import type { SecretStore } from './sessionStore'

function store(initial: string | null = null): SecretStore {
  const held = { value: initial }
  return {
    read: async () => held.value,
    write: async (value: string) => {
      held.value = value
    },
  }
}

function refusing(): SecretStore {
  return {
    read: async () => {
      throw new Error('keystore unavailable')
    },
    write: async () => {
      throw new Error('keystore unavailable')
    },
  }
}

const COMMITTED = JSON.stringify({
  sealingKey: 'c3VyZmFjZQ',
  version: '947281',
})

function stores(over: Partial<BackupPromptStores> = {}): BackupPromptStores {
  return {
    commitment: store(),
    asked: store(),
    received: store(),
    ...over,
  }
}

describe('whether to offer the backup, having read every fact', () => {
  it('says nothing on a device where nothing has arrived', async () => {
    expect(await shouldOfferBackup(stores())).toEqual({ offer: false })
  })

  it('offers once the first message from somebody else has arrived', async () => {
    expect(await shouldOfferBackup(stores({ received: store('yes') }))).toEqual(
      { offer: true },
    )
  })

  it('never asks twice, whatever the answer was', async () => {
    expect(
      await shouldOfferBackup(
        stores({ received: store('yes'), asked: store('yes') }),
      ),
    ).toEqual({ offer: false })
  })

  it('says nothing when the keys are already going somewhere', async () => {
    expect(
      await shouldOfferBackup(
        stores({ received: store('yes'), commitment: store(COMMITTED) }),
      ),
    ).toEqual({ offer: false })
  })

  it('stays silent when the received flag cannot be read', async () => {
    // A device that cannot read its own flags is having a bad day, and
    // interrupting somebody to hand them a secret to keep for ever is not
    // what to do in the middle of one.
    expect(await shouldOfferBackup(stores({ received: refusing() }))).toEqual({
      offer: false,
    })
  })

  it('stays silent when the asked flag cannot be read, which is the opposite default', async () => {
    // `received` defaults false and `asked` defaults TRUE, and both fall the
    // same way: towards silence. The one state this prompt must never reach
    // is asking again somebody who already said no, and an unreadable store
    // cannot rule that out.
    expect(
      await shouldOfferBackup(
        stores({ received: store('yes'), asked: refusing() }),
      ),
    ).toEqual({ offer: false })
  })

  it('treats a damaged commitment as none, so the offer can still be made', async () => {
    // `backupCommitment.ts` answers null for a half-written entry, and the
    // consequence reaches here: a device whose commitment is unusable is a
    // device backing nothing up, and it should be offered a working one
    // rather than left believing it has one.
    expect(
      await shouldOfferBackup(
        stores({
          received: store('yes'),
          commitment: store('{"version":"1"}'),
        }),
      ),
    ).toEqual({ offer: true })
  })
})

describe('recording what happened', () => {
  it('remembers that the question was put', async () => {
    const asked = store()

    expect(await rememberBackupAsked(asked)).toBe(true)
    expect(
      await shouldOfferBackup(stores({ received: store('yes'), asked })),
    ).toEqual({ offer: false })
  })

  it('remembers the first message that arrived', async () => {
    const received = store()

    expect(await rememberReceived(received)).toBe(true)
    expect(await shouldOfferBackup(stores({ received }))).toEqual({
      offer: true,
    })
  })

  it('writing the same flag again changes nothing', async () => {
    // Called on every received message rather than only the first, because
    // reading to save a write on a value that never changes is two
    // operations where there was one.
    const received = store()
    await rememberReceived(received)
    await rememberReceived(received)

    expect(await shouldOfferBackup(stores({ received }))).toEqual({
      offer: true,
    })
  })

  it('reports a flag it could not keep, rather than pretending', async () => {
    expect(await rememberBackupAsked(refusing())).toBe(false)
    expect(await rememberReceived(refusing())).toBe(false)
  })
})
