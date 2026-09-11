import { describe, expect, it } from 'vitest'

import { shareKeyVault, type Vaulting } from './shareKeyVault'

const ARMOUR = '-----BEGIN MEGOLM SESSION DATA-----\nAdnk…\n-----END…'

function platform(over: Partial<Vaulting> = {}) {
  const did: string[] = []
  const written = new Map<string, string>()
  const deps: Vaulting = {
    create: async () => {
      did.push('created')
      return ARMOUR
    },
    temporary: '/tmp/messagr',
    write: async (path, text) => {
      did.push('wrote')
      written.set(path, text)
    },
    share: async () => {
      did.push('shared')
    },
    forget: async path => {
      did.push('forgot')
      written.delete(path)
    },
    name: () => 'vault-0001',
    ...over,
  }
  return { deps, did, written }
}

describe('handing the vault over', () => {
  it('creates it, writes it, shares it, and removes it', async () => {
    const { deps, did, written } = platform()

    expect(await shareKeyVault(deps, 'un mot de passe')).toEqual({
      shared: true,
    })
    expect(did).toEqual(['created', 'wrote', 'shared', 'forgot'])
    expect(written.size).toBe(0)
  })

  it('writes the armour the bridge produced, under a .txt', async () => {
    // `.txt` because that is what the armour is and what every platform lets
    // somebody keep, mail and reopen. An invented extension is a file the
    // operating system offers no application for, which is a vault nobody
    // can put anywhere.
    const seen: { path?: string; text?: string } = {}
    const { deps } = platform({
      write: async (path, text) => {
        seen.path = path
        seen.text = text
      },
      forget: async () => undefined,
    })

    await shareKeyVault(deps, 'un mot de passe')

    expect(seen.path).toBe('/tmp/messagr/vault-0001.txt')
    expect(seen.text).toBe(ARMOUR)
  })
})

describe('the file does not survive the gesture', () => {
  it('removes it when the share sheet refuses', async () => {
    // THE CASE THE `finally` EXISTS FOR. Somebody who dismisses the share
    // sheet, or a platform that throws on cancel, would otherwise leave a
    // file that opens everything ever said sitting in a cache.
    const { deps, did, written } = platform({
      share: async () => {
        throw new Error('the share sheet was dismissed')
      },
    })

    expect(await shareKeyVault(deps, 'un mot de passe')).toEqual({
      shared: false,
      reason: 'the share sheet was dismissed',
    })
    expect(did).toContain('forgot')
    expect(written.size).toBe(0)
  })

  it('removes it when the write itself failed halfway', async () => {
    const { deps, did } = platform({
      write: async () => {
        throw new Error('no space left on device')
      },
    })

    expect(await shareKeyVault(deps, 'x')).toMatchObject({ shared: false })
    expect(did).toContain('forgot')
  })

  it('says it was shared even when the file would not delete', async () => {
    // A temporary file that will not delete is one the system clears on its
    // own. Reporting it would replace the sentence about the vault with one
    // about housekeeping, on the screen of somebody who has just done the
    // thing successfully.
    const { deps } = platform({
      forget: async () => {
        throw new Error('the file is locked')
      },
    })

    expect(await shareKeyVault(deps, 'x')).toEqual({ shared: true })
  })
})

describe('when there is no vault to make', () => {
  it('unlinks nothing, because nothing was written', async () => {
    // A passphrase the bridge refuses, or a device with no crypto machine.
    // Reaching the `finally` here would unlink a path nothing wrote --
    // harmless today and exactly the kind of thing that stops being harmless
    // when the name stops being unique.
    const { deps, did } = platform({
      create: async () => {
        throw new Error('not_initialised')
      },
    })

    expect(await shareKeyVault(deps, 'x')).toEqual({
      shared: false,
      reason: 'not_initialised',
    })
    expect(did).toEqual([])
  })
})
