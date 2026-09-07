import { describe, expect, it } from 'vitest'

import {
  RECEIPTS_DEFAULT,
  publishReceipts,
  receiptsArePublished,
} from './receiptSetting'
import type { SecretStore } from './sessionStore'

function store(held: string | null): SecretStore & { held: string | null } {
  const s = {
    held,
    read: async () => s.held,
    write: async (value: string) => {
      s.held = value
    },
  }
  return s
}

const refusing: SecretStore = {
  read: async () => {
    throw new Error('the keystore is locked')
  },
  write: async () => {
    throw new Error('the keystore refused')
  },
}

describe('receiptsArePublished', () => {
  it('takes the default on a device where nobody has chosen', async () => {
    // The default was `false` until 7 September 2026 and is now the
    // constant, so this test moves with the decision instead of pinning one
    // side of it. `receiptSetting.ts` carries the argument for both.
    expect(await receiptsArePublished(store(null))).toBe(RECEIPTS_DEFAULT)
    expect(await receiptsArePublished(store(''))).toBe(RECEIPTS_DEFAULT)
  })

  it('is on once somebody turns it on', async () => {
    const s = store(null)
    await publishReceipts(s, true)
    expect(await receiptsArePublished(s)).toBe(true)
  })

  it('is off again once somebody turns it off', async () => {
    const s = store(null)
    await publishReceipts(s, true)
    await publishReceipts(s, false)
    expect(await receiptsArePublished(s)).toBe(false)
  })

  it('is off when the keystore cannot be read', async () => {
    // The only safe direction. A keystore failing must never be the reason a
    // device starts publishing when its owner did not ask: being silently
    // private is a degraded state somebody can fix, being silently public is
    // one they cannot undo.
    expect(await receiptsArePublished(refusing)).toBe(false)
  })

  it('is off for a value this build does not recognise', async () => {
    expect(await receiptsArePublished(store('perhaps'))).toBe(false)
  })
})

describe('publishReceipts', () => {
  it('writes "off" rather than clearing, so off is a choice somebody made', async () => {
    const s = store(null)
    await publishReceipts(s, false)
    expect(s.held).toBe('off')
  })

  it('reports a refused write, so a screen can say the switch will revert', async () => {
    expect(await publishReceipts(refusing, true)).toBe(false)
  })
})
