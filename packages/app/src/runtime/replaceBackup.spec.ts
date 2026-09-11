import { describe, expect, it } from 'vitest'

import { replaceBackup, type ReplaceBackupDeps } from './replaceBackup'

const SETUP = {
  restoreKey: 'EsTx-2WeD-3rFv-4tGb',
  sealingKey: 'c3VyZmFjZQ',
  versionRequest: { algorithm: 'm.megolm_backup.v1.curve25519-aes-sha2' },
}

/** What the homeserver and the keystore did, in order. */
function deps(over: Partial<ReplaceBackupDeps> = {}) {
  const done: string[] = []
  const retired: string[] = []
  const base: ReplaceBackupDeps = {
    createKeyBackup: () => {
      done.push('made')
      return SETUP
    },
    currentVersion: async () => {
      done.push('read')
      return '947281'
    },
    publishVersion: async () => {
      done.push('published')
      return '580042'
    },
    remember: async () => {
      done.push('remembered')
      return true
    },
    enable: async () => {
      done.push('enabled')
    },
    retire: async version => {
      done.push('retired')
      retired.push(version)
    },
    ...over,
  }
  return { deps: base, done, retired }
}

describe('replacing the recovery key', () => {
  it('hands back a new key and retires what the old one opened', async () => {
    const { deps: d, retired } = deps()

    const outcome = await replaceBackup(d)

    expect(outcome).toEqual({
      replaced: true,
      restoreKey: SETUP.restoreKey,
      oldRetired: true,
    })
    expect(retired).toEqual(['947281'])
  })

  it('reads the old version BEFORE publishing the new one', async () => {
    // The whole reason this is not read from the commitment, and the whole
    // reason it is step one: after the publish, `GET /room_keys/version`
    // answers with the NEW version, so there is no second chance to learn
    // the old one. Asserted on the order rather than on the result, because
    // the result is identical either way until a homeserver is involved.
    const { deps: d, done } = deps()

    await replaceBackup(d)

    expect(done.indexOf('read')).toBeLessThan(done.indexOf('published'))
  })

  it('retires last, after the new version is enabled', async () => {
    // Between enabling and retiring, both versions stand -- two keys opening
    // two backups, both the person's. The other order has a window where the
    // old backup is gone and the new one is not yet running: a device that
    // stops there has no backup and a key that opens nothing.
    const { deps: d, done } = deps()

    await replaceBackup(d)

    expect(done).toEqual([
      'read',
      'made',
      'published',
      'remembered',
      'enabled',
      'retired',
    ])
  })
})

describe('when the old backup will not go', () => {
  it('says the replacement worked and the old key still opens', async () => {
    // THE OUTCOME THAT MUST NOT BE ROUNDED UP. Somebody replaces a key
    // because they have lost track of the old one; telling them it is done
    // while that key still opens everything is the one lie this screen can
    // tell that matters.
    const { deps: d } = deps({
      retire: async () => {
        throw new Error('410 Gone')
      },
    })

    expect(await replaceBackup(d)).toEqual({
      replaced: true,
      restoreKey: SETUP.restoreKey,
      oldRetired: false,
    })
  })

  it('retires nothing, and says so as success, when there was none', async () => {
    // A device whose backup was never made, or was retired from elsewhere.
    // Nothing stands because nothing was there, which is the same fact for
    // the person holding a key.
    const { deps: d, retired } = deps({ currentVersion: async () => null })

    expect(await replaceBackup(d)).toMatchObject({ oldRetired: true })
    expect(retired).toEqual([])
  })

  it('carries on when the homeserver will not say what it holds', async () => {
    // Refusing to replace here would leave somebody who has lost control of
    // their key with no way forward at all. The cost is a version left
    // standing, and `oldRetired` is not what says so -- nothing was found to
    // retire, so it reports the same as having none.
    const { deps: d, retired } = deps({
      currentVersion: async () => {
        throw new Error('502 Bad Gateway')
      },
    })

    expect(await replaceBackup(d)).toMatchObject({ replaced: true })
    expect(retired).toEqual([])
  })
})

describe('the guard against deleting what was just made', () => {
  it('retires nothing when the homeserver answered the same version twice', async () => {
    // A homeserver that reuses an identifier, or whose publish was a no-op
    // because a version already existed. Without the guard the retirement
    // destroys the backup enabled moments earlier: the person holds a key
    // that opens nothing and the screen has told them it is done.
    //
    // Remove the `previous === published` check in `replaceBackup.ts` and
    // this fails with `retired` holding "947281" -- the version it had just
    // enabled.
    const { deps: d, retired } = deps({ publishVersion: async () => '947281' })

    expect(await replaceBackup(d)).toMatchObject({
      replaced: true,
      oldRetired: true,
    })
    expect(retired).toEqual([])
  })

  it('still retires when the two differ, which is every ordinary case', async () => {
    // The control. Without it the test above could pass because nothing is
    // ever retired, which would be a guard that guards by doing nothing.
    const { deps: d, retired } = deps()

    await replaceBackup(d)

    expect(retired).toEqual(['947281'])
  })
})

describe('when the replacement itself fails', () => {
  it.each([
    ['publishing', { publishVersion: async () => Promise.reject(new Error()) }],
    ['remembering', { remember: async () => false }],
    ['enabling', { enable: async () => Promise.reject(new Error()) }],
  ] as const)('reports %s, and retires nothing', async (failedAt, broken) => {
    // Nothing is retired on any of these paths, and that is the property
    // that matters rather than the label: a failed replacement must leave
    // the old key opening exactly what it opened before.
    const { deps: d, retired } = deps(broken as Partial<ReplaceBackupDeps>)

    expect(await replaceBackup(d)).toEqual({ replaced: false, failedAt })
    expect(retired).toEqual([])
  })
})
