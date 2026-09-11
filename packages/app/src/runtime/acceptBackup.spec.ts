import { describe, expect, it, vi } from 'vitest'

import { acceptBackup, type AcceptBackupDeps } from './acceptBackup'
import type { BackupCommitment } from './backupCommitment'

const SETUP = {
  restoreKey: 'EsTx aaaa bbbb cccc',
  sealingKey: 'c3VyZmFjZQ',
  versionRequest: {
    algorithm: 'm.megolm_backup.v1.curve25519-aes-sha2',
    auth_data: { public_key: 'c3VyZmFjZQ' },
  },
}

function deps(over: Partial<AcceptBackupDeps> = {}): AcceptBackupDeps & {
  kept: BackupCommitment[]
  enabled: [string, string][]
} {
  const kept: BackupCommitment[] = []
  const enabled: [string, string][] = []
  return {
    kept,
    enabled,
    createKeyBackup: () => SETUP,
    publishVersion: async () => '947281',
    remember: async commitment => {
      kept.push(commitment)
      return true
    },
    enable: async (sealingKey, version) => {
      enabled.push([sealingKey, version])
    },
    ...over,
  }
}

describe('accepting the backup', () => {
  it('hands back the key to show, once', async () => {
    const d = deps()

    expect(await acceptBackup(d)).toEqual({
      accepted: true,
      restoreKey: 'EsTx aaaa bbbb cccc',
    })
  })

  it('publishes the body the bridge produced, untouched', async () => {
    const publishVersion = vi.fn(async () => '947281')
    await acceptBackup(deps({ publishVersion }))

    expect(publishVersion).toHaveBeenCalledWith(SETUP.versionRequest)
  })

  it('keeps the sealing key with the version the homeserver chose', async () => {
    const d = deps()
    await acceptBackup(d)

    expect(d.kept).toEqual([{ sealingKey: 'c3VyZmFjZQ', version: '947281' }])
    expect(d.enabled).toEqual([['c3VyZmFjZQ', '947281']])
  })

  it('remembers before it enables, and not the other way round', async () => {
    // The one ordering here that is not arbitrary. Enabling first leaves a
    // device uploading to a version it forgets the moment it is closed, and
    // somebody believing they have a backup that stops when they shut the
    // application.
    const order: string[] = []
    await acceptBackup(
      deps({
        remember: async () => {
          order.push('remember')
          return true
        },
        enable: async () => {
          order.push('enable')
        },
      }),
    )

    expect(order).toEqual(['remember', 'enable'])
  })

  it('never turns the version into a number', async () => {
    // Continuwuity answers with a six-digit integer where Synapse answers
    // with a counter from "1", and the specification makes the field opaque.
    // The leading zero is the assertion: a number would lose it.
    const d = deps({ publishVersion: async () => '047281' })
    await acceptBackup(d)

    expect(d.kept[0]?.version).toBe('047281')
    expect(d.enabled[0]?.[1]).toBe('047281')
  })

  it('says where it failed when the homeserver refuses', async () => {
    const d = deps({
      publishVersion: async () => {
        throw new Error('502')
      },
    })

    expect(await acceptBackup(d)).toEqual({
      accepted: false,
      failedAt: 'publishing',
    })
    // Nothing happened, which is what makes offering again reasonable.
    expect(d.kept).toEqual([])
    expect(d.enabled).toEqual([])
  })

  it('treats an empty version as the homeserver having answered nothing', async () => {
    // The bridge reads an empty version as the absence of one rather than as
    // an opaque identifier, so carrying it would enable a backup that is not
    // one. Refused here, and reported where it came from.
    const d = deps({ publishVersion: async () => '' })

    expect(await acceptBackup(d)).toEqual({
      accepted: false,
      failedAt: 'publishing',
    })
    expect(d.enabled).toEqual([])
  })

  it('does not enable what it could not remember', async () => {
    // A device that enables without remembering backs up until it is closed
    // and then silently stops. Refusing here leaves an unused version on the
    // homeserver, which costs nothing.
    const d = deps({ remember: async () => false })

    expect(await acceptBackup(d)).toEqual({
      accepted: false,
      failedAt: 'remembering',
    })
    expect(d.enabled).toEqual([])
  })

  it('says so when the bridge refuses what the homeserver accepted', async () => {
    const d = deps({
      enable: async () => {
        throw new Error('malformed_identifier')
      },
    })

    expect(await acceptBackup(d)).toEqual({
      accepted: false,
      failedAt: 'enabling',
    })
  })

  it('never hands the restore key back on a failure', async () => {
    // The one value in this sequence that cannot be produced again. A screen
    // that showed it after a failed acceptance would be showing the key to a
    // backup that does not exist -- and the person would keep it.
    for (const broken of [
      deps({
        publishVersion: async () => {
          throw new Error('502')
        },
      }),
      deps({ remember: async () => false }),
      deps({
        enable: async () => {
          throw new Error('nope')
        },
      }),
    ]) {
      const outcome = await acceptBackup(broken)
      expect(outcome.accepted).toBe(false)
      expect(JSON.stringify(outcome)).not.toContain('EsTx')
    }
  })
})
