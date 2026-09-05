import { describe, expect, it, vi } from 'vitest'

import { CURRENT_FORM, migrateKeystoreForm } from './keystoreForm'
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

const refusing = (message: string): SecretStore => ({
  read: async () => {
    throw new Error(message)
  },
  write: async () => {
    throw new Error(message)
  },
})

const FOREGROUND = true
const BACKGROUND = false

describe('migrateKeystoreForm', () => {
  it('rewrites a value stored in the old form, and marks it', async () => {
    const value = store('a-passphrase')
    const marker = store(null)
    const migration = await migrateKeystoreForm(value, marker, FOREGROUND)
    expect(migration).toEqual({ outcome: 'rewritten', marked: true })
    expect(value.held).toBe('a-passphrase')
    expect(marker.held).toBe(CURRENT_FORM)
  })

  it('does nothing at all once the marker says the entry has moved', async () => {
    const value = { read: vi.fn(), write: vi.fn() }
    const migration = await migrateKeystoreForm(
      value as unknown as SecretStore,
      store(CURRENT_FORM),
      FOREGROUND,
    )
    expect(migration).toEqual({ outcome: 'current', marked: true })
    expect(value.read).not.toHaveBeenCalled()
    expect(value.write).not.toHaveBeenCalled()
  })

  it('answers current on a background wake, since the marker is itself in the new form', async () => {
    const migration = await migrateKeystoreForm(
      store('a-passphrase'),
      store(CURRENT_FORM),
      BACKGROUND,
    )
    expect(migration.outcome).toBe('current')
  })

  it('does not attempt a migration on a background wake', async () => {
    const value = { read: vi.fn(), write: vi.fn() }
    const migration = await migrateKeystoreForm(
      value as unknown as SecretStore,
      store(null),
      BACKGROUND,
    )
    expect(migration.outcome).toBe('deferred')
    expect(migration.marked).toBe(false)
    // The whole point: reading the old form needs the device unlocked, and a
    // failure there is indistinguishable from one that has not been.
    expect(value.read).not.toHaveBeenCalled()
  })

  it('marks a fresh installation without writing a value it does not have', async () => {
    const value = store(null)
    const marker = store(null)
    const migration = await migrateKeystoreForm(value, marker, FOREGROUND)
    expect(migration).toEqual({ outcome: 'nothing-stored', marked: true })
    expect(value.held).toBeNull()
    expect(marker.held).toBe(CURRENT_FORM)
  })

  it('treats an empty stored value as nothing stored', async () => {
    const migration = await migrateKeystoreForm(
      store(''),
      store(null),
      FOREGROUND,
    )
    expect(migration.outcome).toBe('nothing-stored')
  })

  it('leaves the old value intact when it cannot be read, and says so', async () => {
    const migration = await migrateKeystoreForm(
      refusing('the keystore is locked'),
      store(null),
      FOREGROUND,
    )
    expect(migration.outcome).toBe('failed')
    expect(migration.marked).toBe(false)
    expect(migration.reason).toContain('the keystore is locked')
  })

  it('leaves the old value intact when the write back is refused, and says so', async () => {
    const value: SecretStore = {
      read: async () => 'a-passphrase',
      write: async () => {
        throw new Error('the keystore refused')
      },
    }
    const marker = store(null)
    const migration = await migrateKeystoreForm(value, marker, FOREGROUND)
    expect(migration.outcome).toBe('failed')
    expect(migration.reason).toContain('the keystore refused')
    // Never marked on a failure, so the next launch tries again rather than
    // believing an entry moved that did not.
    expect(marker.held).toBeNull()
  })

  it('reports a rewrite that could not be marked as a rewrite, because it was one', async () => {
    const value = store('a-passphrase')
    const migration = await migrateKeystoreForm(
      value,
      refusing('the keystore refused'),
      FOREGROUND,
    )
    expect(migration).toEqual({ outcome: 'rewritten', marked: false })
    expect(value.held).toBe('a-passphrase')
  })

  it('attempts the migration when the marker cannot be read, rather than assuming either way', async () => {
    const value = store('a-passphrase')
    const marker: SecretStore = {
      read: async () => {
        throw new Error('unreadable')
      },
      write: async () => {},
    }
    const migration = await migrateKeystoreForm(value, marker, FOREGROUND)
    expect(migration.outcome).toBe('rewritten')
  })

  it('is idempotent: a second run finds the marker and stops', async () => {
    const value = store('a-passphrase')
    const marker = store(null)
    await migrateKeystoreForm(value, marker, FOREGROUND)
    const second = await migrateKeystoreForm(value, marker, FOREGROUND)
    expect(second.outcome).toBe('current')
    expect(value.held).toBe('a-passphrase')
  })
})
