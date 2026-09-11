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

/** The answer alone, for the tests that are only about the answer. */
async function decides(over: Partial<BackupPromptStores> = {}) {
  return (await shouldOfferBackup(stores(over))).decision
}

describe('whether to offer the backup, having read every fact', () => {
  it('says nothing on a device where nothing has arrived', async () => {
    expect(await decides()).toEqual({ offer: false })
  })

  it('offers once the first message from somebody else has arrived', async () => {
    expect(await decides({ received: store('yes') })).toEqual({ offer: true })
  })

  it('never asks twice, whatever the answer was', async () => {
    expect(
      await decides({ received: store('yes'), asked: store('yes') }),
    ).toEqual({ offer: false })
  })

  it('says nothing when the keys are already going somewhere', async () => {
    expect(
      await decides({ received: store('yes'), commitment: store(COMMITTED) }),
    ).toEqual({ offer: false })
  })

  it('treats a damaged commitment as none, so the offer can still be made', async () => {
    // `backupCommitment.ts` answers null for a half-written entry, and the
    // consequence reaches here: a device whose commitment is unusable is a
    // device backing nothing up, and it should be offered a working one
    // rather than left believing it has one.
    expect(
      await decides({
        received: store('yes'),
        commitment: store('{"version":"1"}'),
      }),
    ).toEqual({ offer: true })
  })
})

describe('telling a working refusal from a broken one', () => {
  it('names the store it could not read, and stays silent anyway', async () => {
    // Both halves matter. The silence is the behaviour -- a device that
    // cannot read its own flags is having a bad day, and confiding a secret
    // to keep for ever is not what to do in the middle of one. The name is
    // what makes that silence distinguishable from the three silences that
    // mean the feature is working.
    const reading = await shouldOfferBackup(stores({ received: refusing() }))

    expect(reading.decision).toEqual({ offer: false })
    expect(reading.unreadable).toEqual(['received'])
  })

  it('names an unreadable asked flag, which defaults the other way', async () => {
    // `asked` falls to TRUE where `received` falls to false, and both fall
    // towards silence: the one state this prompt must never reach is asking
    // again somebody who already said no.
    const reading = await shouldOfferBackup(
      stores({ received: store('yes'), asked: refusing() }),
    )

    expect(reading.decision).toEqual({ offer: false })
    expect(reading.asked).toBe(true)
    expect(reading.unreadable).toEqual(['asked'])
  })

  it('says nothing was unreadable when everything answered', async () => {
    // The line a device proof reads on a healthy device. Without this
    // assertion the field could be populated by accident and mean nothing.
    const reading = await shouldOfferBackup(stores({ received: store('yes') }))

    expect(reading.unreadable).toEqual([])
    expect(reading.decision).toEqual({ offer: true })
  })

  it('carries the three facts, not only the answer', async () => {
    // A refusal has four causes and they look identical from outside. Three
    // are the feature working and one is the feature absent; these fields
    // are what tells them apart.
    const reading = await shouldOfferBackup(
      stores({ received: store('yes'), commitment: store(COMMITTED) }),
    )

    expect(reading).toMatchObject({
      backedUp: true,
      asked: false,
      received: true,
      unreadable: [],
    })
    expect(reading.decision).toEqual({ offer: false })
  })
})

describe('recording what happened', () => {
  it('remembers that the question was put', async () => {
    const asked = store()

    expect(await rememberBackupAsked(asked)).toBe(true)
    expect(await decides({ received: store('yes'), asked })).toEqual({
      offer: false,
    })
  })

  it('remembers the first message that arrived', async () => {
    const received = store()

    expect(await rememberReceived(received)).toBe(true)
    expect(await decides({ received })).toEqual({ offer: true })
  })

  it('writing the same flag again changes nothing', async () => {
    // Called on every received message rather than only the first, because
    // reading to save a write on a value that never changes is two
    // operations where there was one.
    const received = store()
    await rememberReceived(received)
    await rememberReceived(received)

    expect(await decides({ received })).toEqual({ offer: true })
  })

  it('reports a flag it could not keep, rather than pretending', async () => {
    expect(await rememberBackupAsked(refusing())).toBe(false)
    expect(await rememberReceived(refusing())).toBe(false)
  })
})
