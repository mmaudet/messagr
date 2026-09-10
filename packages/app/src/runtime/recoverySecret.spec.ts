import { describe, expect, it } from 'vitest'

import { keepRecoverySecret, readRecoverySecret } from './recoverySecret'
import type { SecretStore } from './sessionStore'

function store(
  held: string | null = null,
): SecretStore & { held: string | null } {
  const it_ = {
    held,
    read: async () => it_.held,
    write: async (value: string) => {
      it_.held = value
    },
  }
  return it_
}

const refusing: SecretStore = {
  read: async () => {
    throw new Error('the keystore is locked')
  },
  write: async () => {
    throw new Error('the keystore is locked')
  },
}

describe('the password kept for coming back', () => {
  it('is written and read as itself', async () => {
    const keeping = store()
    expect(await keepRecoverySecret(keeping, 'a-drawn-password')).toBe(true)
    expect(await readRecoverySecret(keeping)).toBe('a-drawn-password')
  })

  it('answers nothing on a device that never kept one', async () => {
    // Claimed before this existed, or a keystore that would not write. The
    // caller's answer is the same either way and it is the old behaviour.
    expect(await readRecoverySecret(store())).toBeNull()
  })

  it('reads an empty entry as nothing rather than as a password', async () => {
    expect(await readRecoverySecret(store(''))).toBeNull()
  })

  it('reports a keystore that refused rather than pretending', async () => {
    expect(await keepRecoverySecret(refusing, 'a-drawn-password')).toBe(false)
  })

  it('answers nothing when the keystore will not be read', async () => {
    // A locked device, or an entry invalidated by a credential change.
    // Ordinary rather than exceptional, exactly as `loadSession` says.
    expect(await readRecoverySecret(refusing)).toBeNull()
  })
})
