import { describe, expect, it, vi } from 'vitest'

import {
  acceptBackup,
  acceptBackupFrom,
  type AcceptBackupDeps,
} from './acceptBackup'
import {
  forgetBackupCommitment,
  readBackupCommitment,
  rememberBackupCommitment,
  type BackupCommitment,
} from './backupCommitment'
import { rememberBackupAsked, shouldOfferBackup } from './backupPrompt'
import type { SecretStore } from './sessionStore'

/** A store backed by one variable, which is what the real one is. */
function store(initial: string | null = null): SecretStore {
  const held = { value: initial }
  return {
    read: async () => held.value,
    write: async (value: string) => {
      held.value = value
    },
  }
}

/** A keystore that does not answer, as a launch can find it. */
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
    rememberAsked: async () => true,
    createKeyBackup: () => SETUP,
    publishVersion: async () => '947281',
    remember: async commitment => {
      kept.push(commitment)
      return true
    },
    enable: async (sealingKey, version) => {
      enabled.push([sealingKey, version])
    },
    forget: async () => true,
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

describe('what an acceptance leaves behind', () => {
  // #291, on the telephone that invited to the trial of 13 September 2026.
  // The backup was accepted in the morning, and the first message from the
  // person invited brought the offer back.
  //
  // The offer records the question before it is answered. Réglages accepted
  // without recording anything, so the one thing left between a message
  // received and the offer was a commitment that exists and reads back --
  // and an acceptance that stopped short, or a keystore that did not answer
  // at the next launch, leaves none. Each case goes through the real
  // sequence and the real decision, with the stores a relaunch reads.
  it.each<{
    readonly when: string
    readonly over: Partial<AcceptBackupDeps>
    readonly commitmentAnswersNextLaunch: boolean
  }>([
    {
      when: 'the homeserver refused it',
      over: {
        publishVersion: async () => {
          throw new Error('502')
        },
      },
      commitmentAnswersNextLaunch: true,
    },
    {
      when: 'the keystore did not keep the commitment',
      over: { remember: async () => false },
      commitmentAnswersNextLaunch: true,
    },
    {
      when: 'it went through and its commitment does not answer at the next launch',
      over: {},
      commitmentAnswersNextLaunch: false,
    },
  ])(
    'offers nothing once a message arrives, when $when',
    async ({ over, commitmentAnswersNextLaunch }) => {
      const commitment = store()
      const asked = store()
      await acceptBackup(
        deps({
          remember: kept => rememberBackupCommitment(commitment, kept),
          rememberAsked: () => rememberBackupAsked(asked),
          ...over,
        }),
      )

      const reading = await shouldOfferBackup({
        commitment: commitmentAnswersNextLaunch ? commitment : refusing(),
        asked,
        received: store('yes'),
      })

      expect(reading.decision).toEqual({ offer: false })
    },
  )

  it('leaves nothing for the next launch to turn on when enabling fails', async () => {
    // Remembering comes before enabling, and a failure hands no key back. A
    // commitment left in the keystore is one `resumeKeyBackup` turns on at the
    // next launch: a backup under a key nobody was shown, and Réglages saying
    // the messages are kept.
    const commitment = store()
    await acceptBackup(
      deps({
        remember: kept => rememberBackupCommitment(commitment, kept),
        forget: () => forgetBackupCommitment(commitment),
        enable: async () => {
          throw new Error('malformed_identifier')
        },
      }),
    )

    expect(await readBackupCommitment(commitment)).toBeNull()
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

describe('accepting from a screen', () => {
  // #284. Both screens ran the acceptance and, when it failed, drew nothing
  // and wrote nothing: the offer closed, Réglages stayed as it was, and the
  // person was left believing their keys were kept. Since #314 a failed
  // acceptance also counts as an answer, so the offer never comes back to
  // catch it.
  it('hands back the key to show, and writes nothing about a failure', async () => {
    let outcome: unknown
    const lines = await linesWrittenDuring(async () => {
      outcome = await acceptBackupFrom('offer', () => acceptBackup(deps()))
    })

    expect(outcome).toEqual({
      accepted: true,
      restoreKey: 'EsTx aaaa bbbb cccc',
    })
    expect(lines).toEqual([])
  })

  it.each<{
    readonly failedAt: 'publishing' | 'remembering' | 'enabling'
    readonly over: Partial<AcceptBackupDeps>
  }>([
    {
      failedAt: 'publishing',
      over: {
        publishVersion: async () => {
          throw new Error('502')
        },
      },
    },
    { failedAt: 'remembering', over: { remember: async () => false } },
    {
      failedAt: 'enabling',
      over: {
        enable: async () => {
          throw new Error('malformed_identifier')
        },
      },
    },
  ])(
    'answers a failure at $failedAt, and writes where it stopped and from which screen',
    async ({ failedAt, over }) => {
      let outcome: unknown
      const lines = await linesWrittenDuring(async () => {
        outcome = await acceptBackupFrom('settings', () =>
          acceptBackup(deps(over)),
        )
      })

      expect(outcome).toEqual({ accepted: false, failedAt })
      expect(lines).toEqual([
        `MESSAGR_BACKUP_ACCEPT_FAILED {"from":"settings","failedAt":"${failedAt}"}`,
      ])
    },
  )

  it('writes that line in a store build too', async () => {
    // What the Play and TestFlight builds are to `log.ts`: `__DEV__` false,
    // and neither flag a bench sets on a bundle it is going to read. A store
    // build writes only what TRACE names, and this line is the one a tester's
    // telephone can give back about an acceptance that did not go through.
    vi.stubGlobal('__DEV__', false)
    vi.stubEnv('MESSAGR_SEND_PROBE', '')
    vi.stubEnv('MESSAGR_WHOLE_LOG', '')
    try {
      const lines = await linesWrittenDuring(() =>
        acceptBackupFrom('offer', () =>
          acceptBackup(deps({ remember: async () => false })),
        ),
      )

      expect(lines).toEqual([
        'MESSAGR_BACKUP_ACCEPT_FAILED {"from":"offer","failedAt":"remembering"}',
      ])
    } finally {
      vi.unstubAllGlobals()
      vi.unstubAllEnvs()
    }
  })

  it('answers an acceptance that threw as a failure, and writes why', async () => {
    // `createKeyBackup` sits outside every `try` in `acceptBackup`, and the
    // bridge throws from it when its native module never installed. Both
    // screens caught the rejection and drew nothing.
    let outcome: unknown
    const lines = await linesWrittenDuring(async () => {
      outcome = await acceptBackupFrom('offer', () =>
        acceptBackup(
          deps({
            createKeyBackup: () => {
              throw new Error('the native module never installed')
            },
          }),
        ),
      )
    })

    expect(outcome).toEqual({ accepted: false, failedAt: 'thrown' })
    expect(lines).toEqual([
      'MESSAGR_BACKUP_ACCEPT_FAILED {"from":"offer","failedAt":"thrown","because":"the native module never installed"}',
    ])
  })

  it('never writes the cause of a throw in a store build', async () => {
    // Whatever threw, its message is not the trace's to carry: a transport
    // error names the homeserver, and a refusal can name the account.
    vi.stubGlobal('__DEV__', false)
    vi.stubEnv('MESSAGR_SEND_PROBE', '')
    vi.stubEnv('MESSAGR_WHOLE_LOG', '')
    try {
      const lines = await linesWrittenDuring(() =>
        acceptBackupFrom('settings', () =>
          Promise.reject(
            new Error(
              'M_UNKNOWN_TOKEN: @rabr642vve6v:messagr.eu at https://messagr.eu/_matrix/client/v3/room_keys/version',
            ),
          ),
        ),
      )

      expect(lines).toEqual([
        'MESSAGR_BACKUP_ACCEPT_FAILED {"from":"settings","failedAt":"thrown"}',
      ])
    } finally {
      vi.unstubAllGlobals()
      vi.unstubAllEnvs()
    }
  })
})
