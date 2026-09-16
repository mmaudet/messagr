import { describe, expect, it, vi } from 'vitest'

import {
  failedReplacementSentence,
  replaceBackup,
  replaceBackupFrom,
  type ReplaceBackupDeps,
} from './replaceBackup'

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
    rememberAsked: async () => true,
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
    forget: async () => {
      done.push('forgotten')
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
  it('reports a failure to publish, and retires nothing at all', async () => {
    // Nothing reached the homeserver, so there is nothing to take back and
    // the old key opens exactly what it opened before.
    const { deps: d, retired } = deps({
      publishVersion: async () => Promise.reject(new Error()),
    })

    expect(await replaceBackup(d)).toEqual({
      replaced: false,
      failedAt: 'publishing',
      undone: true,
    })
    expect(retired).toEqual([])
  })

  it('takes the publication back when the keystore would not keep the commitment', async () => {
    // #327, the first half of its constat. vN is published and is the
    // homeserver's current version; the keystore still holds the OLD
    // commitment, and the bridge still writes to the old version -- which the
    // homeserver now refuses with `M_WRONG_ROOM_KEYS_VERSION`, for ever,
    // while Réglages said « sauvegardés ».
    //
    // Retiring vN puts the account back where it was, and the commitment was
    // never overwritten, so nothing at all is left of this gesture.
    const { deps: d, retired } = deps({ remember: async () => false })

    expect(await replaceBackup(d)).toEqual({
      replaced: false,
      failedAt: 'remembering',
      undone: true,
    })
    expect(retired).toEqual(['580042'])
  })

  it('takes it back when the bridge refused what the homeserver had accepted', async () => {
    // #327, the second half. vN is published and its key was never shown to
    // anybody, so a restore on a new telephone reads vN and refuses the old
    // key with `wrong-key` -- the person's whole past, behind a key that
    // exists nowhere.
    //
    // `undone` is false all the same, and that is not a detail: the old
    // commitment was overwritten and then forgotten (#284), so this device
    // stops feeding the backup it goes back to. The account is as it was and
    // this telephone is not, which is what Réglages now says on its own.
    const { deps: d, retired } = deps({
      enable: async () => Promise.reject(new Error('malformed_identifier')),
    })

    expect(await replaceBackup(d)).toEqual({
      replaced: false,
      failedAt: 'enabling',
      undone: false,
    })
    expect(retired).toEqual(['580042'])
  })

  it('says so when the keystore refused twice to forget the new commitment', async () => {
    // #284, found in review: the acceptance answers `forgotten: false` and the
    // replacement dropped it. It is the one failure that leaves a commitment
    // the next launch turns on -- and it now points at a version this has
    // just retired, which is worse rather than better, and is exactly why
    // nothing downstream may lose the flag.
    const { deps: d } = deps({
      enable: async () => Promise.reject(new Error('malformed_identifier')),
      forget: async () => false,
    })

    expect(await replaceBackup(d)).toEqual({
      replaced: false,
      failedAt: 'enabling',
      undone: false,
      forgotten: false,
    })
  })

  it('answers a step that throws once the new version is published, and takes it back too', async () => {
    // #284, found in review. Past the publish, the homeserver holds the new
    // version as its current one, and a rejection says nothing of that: the
    // screen answered every one with « rien n'a changé ».
    //
    // Nothing here can tell which step threw -- a `remember` that rejected
    // leaves the old commitment, a `forget` that rejected leaves the new one
    // -- so the version goes and the answer claims nothing about the
    // keystore.
    const { deps: d, retired } = deps({
      remember: async () => {
        throw new Error('keystore unavailable')
      },
    })

    expect(await replaceBackup(d)).toEqual({
      replaced: false,
      failedAt: 'thrownAfterPublishing',
      undone: false,
    })
    expect(retired).toEqual(['580042'])
  })

  it('claims nothing was left behind when the retirement itself failed', async () => {
    // The homeserver took the new version and will not take it back. vN
    // stands, it is current, and the sentence « rien n'a changé » would be a
    // lie -- which is the whole reason this is reported rather than assumed.
    const { deps: d } = deps({
      remember: async () => false,
      retire: async () => {
        throw new Error('502 Bad Gateway')
      },
    })

    expect(await replaceBackup(d)).toEqual({
      replaced: false,
      failedAt: 'remembering',
      undone: false,
    })
  })

  it('keeps the guard when it takes a publication back, and retires nothing', async () => {
    // A homeserver that answered the same identifier twice. The retirement
    // after a SUCCESS is guarded against this already; without the same guard
    // here, a failed replacement would delete the backup that was there
    // before it -- the one case where taking the gesture back is worse than
    // leaving it.
    const { deps: d, retired } = deps({
      publishVersion: async () => '947281',
      remember: async () => false,
    })

    expect(await replaceBackup(d)).toEqual({
      replaced: false,
      failedAt: 'remembering',
      undone: false,
    })
    expect(retired).toEqual([])
  })

  it('takes back a first version published on an account that had none', async () => {
    // Nothing to compare it against, and nothing behind it: retiring leaves
    // the account with no backup, which is where it started.
    const { deps: d, retired } = deps({
      currentVersion: async () => null,
      remember: async () => false,
    })

    expect(await replaceBackup(d)).toMatchObject({ undone: true })
    expect(retired).toEqual(['580042'])
  })
})

/** Every line a gesture wrote, whatever the level it wrote it at. */
async function linesWrittenDuring(
  gesture: () => Promise<unknown>,
): Promise<string[]> {
  const lines: string[] = []
  const spies = (['log', 'warn', 'error'] as const).map(method =>
    vi.spyOn(console, method).mockImplementation((...written: unknown[]) => {
      lines.push(String(written[0]))
    }),
  )
  try {
    await gesture()
  } finally {
    for (const spy of spies) spy.mockRestore()
  }
  return lines
}

describe('replacing from the Sauvegarde screen', () => {
  // #284, found in review. A replacement that failed wrote nothing, so a
  // tester's log could not tell one had even been tried, and `forgotten: false`
  // was lost on the way.
  it('writes, in a store build too, where it stopped and that a commitment could not be forgotten', async () => {
    vi.stubGlobal('__DEV__', false)
    vi.stubEnv('MESSAGR_SEND_PROBE', '')
    vi.stubEnv('MESSAGR_WHOLE_LOG', '')
    try {
      const { deps: d } = deps({
        enable: async () => Promise.reject(new Error('malformed_identifier')),
        forget: async () => false,
      })
      let outcome: unknown
      const lines = await linesWrittenDuring(async () => {
        outcome = await replaceBackupFrom(() => replaceBackup(d))
      })

      expect(outcome).toEqual({
        replaced: false,
        failedAt: 'enabling',
        undone: false,
        forgotten: false,
      })
      expect(lines).toEqual([
        'MESSAGR_BACKUP_ACCEPT_FAILED {"from":"replace","failedAt":"enabling","undone":false,"forgotten":false}',
      ])
    } finally {
      vi.unstubAllGlobals()
      vi.unstubAllEnvs()
    }
  })

  it('answers a replacement that threw before publishing as a failure, and writes why', async () => {
    // `replaceBackup` rejects only before the publish, so nothing on the
    // homeserver moved. The screen is answered like any other failure instead
    // of a rejection nobody draws.
    const { deps: d } = deps({
      createKeyBackup: () => {
        throw new Error('the native module never installed')
      },
    })
    let outcome: unknown
    const lines = await linesWrittenDuring(async () => {
      outcome = await replaceBackupFrom(() => replaceBackup(d))
    })

    // `undone: true`: `replaceBackup` lets a throw out only before the
    // publish, so the homeserver was never asked for anything.
    expect(outcome).toEqual({
      replaced: false,
      failedAt: 'thrown',
      undone: true,
    })
    expect(lines).toEqual([
      'MESSAGR_BACKUP_ACCEPT_FAILED {"from":"replace","failedAt":"thrown","undone":true,"because":"the native module never installed"}',
    ])
  })
})

describe('what the Sauvegarde screen says of a replacement that failed', () => {
  // #284, found in review: every failure said « rien n'a changé : votre
  // ancienne clé ouvre toujours votre sauvegarde ». That holds until the
  // publish. From there on the homeserver holds the new version as its
  // current one, and the sentence becomes a lie.
  //
  // #327 made it true again where it can be: a publication taken back whole
  // IS nothing having changed. So the step is no longer what decides the
  // sentence -- what the gesture left behind is -- and the combinations below
  // are the ones `replaceBackup` can actually answer.
  it.each([
    ['publishing', true, 'backup_replace_failed'],
    ['thrown', true, 'backup_replace_failed'],
    ['remembering', true, 'backup_replace_failed'],
    ['remembering', false, 'backup_accept_failed'],
    ['enabling', false, 'backup_accept_failed'],
    ['thrownAfterPublishing', false, 'backup_accept_failed'],
  ] as const)(
    'after a failure at %s with undone %s, says %s',
    (failedAt, undone, sentence) => {
      expect(failedReplacementSentence({ failedAt, undone })).toBe(sentence)
    },
  )
})
