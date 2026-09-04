import type { IdentityStatus } from 'react-native-matrix-crypto'
import { describe, expect, it } from 'vitest'

import {
  establishCrossSigningIdentity,
  type IdentityMachineOps,
} from './crossSigningIdentity'
import type { DrainResult } from './pump'

const NOTHING_TO_SEND: DrainResult = {
  sent: 0,
  failed: 0,
  sentKinds: [],
  failures: [],
}

const SENT_THE_BATCH: DrainResult = {
  sent: 2,
  failed: 0,
  sentKinds: ['signing_keys_upload', 'keys_query'],
  failures: [],
}

const SETTLED: IdentityStatus = {
  accountKeysFetched: true,
  identityKnown: true,
  privateKeysHeld: true,
  accountKeysAnswerUnsettled: false,
  identityPublicationPending: false,
}

function crypto(kind: string): Error {
  // The library brands its errors and exports a type guard, but that guard is
  // a *value* export from a package whose import installs a native bootstrap,
  // which this module may not carry. Reading `kind` defensively is what a
  // consumer on this side of an FFI boundary should do anyway.
  return Object.assign(new Error(kind), { kind })
}

interface Recorder extends IdentityMachineOps {
  calls: string[]
}

function machine(
  behaviour: {
    bootstrap?: () => Promise<void>
    create?: () => Promise<void>
    status?: Partial<IdentityStatus>
  } = {},
): Recorder {
  const calls: string[] = []
  return {
    calls,
    getIdentityStatus: async () => ({ ...SETTLED, ...behaviour.status }),
    bootstrapCrossSigning: async () => {
      calls.push('bootstrap')
      await behaviour.bootstrap?.()
    },
    createCrossSigningIdentity: async () => {
      calls.push('create')
      await behaviour.create?.()
    },
  }
}

/** A drain that answers each call from a queue, then repeats the last answer. */
function drainer(answers: DrainResult[]) {
  const calls: DrainResult[] = []
  return {
    calls,
    drain: async () => {
      const next = answers[calls.length] ?? answers[answers.length - 1]
      const result = next ?? NOTHING_TO_SEND
      calls.push(result)
      return result
    },
  }
}

describe('establishCrossSigningIdentity', () => {
  it('publishes the identity this device already holds', async () => {
    const m = machine()
    const d = drainer([SENT_THE_BATCH])
    await expect(
      establishCrossSigningIdentity(m, d.drain, 'restored-session'),
    ).resolves.toEqual({ established: true, how: 'published' })
    expect(m.calls).toEqual(['bootstrap'])
  })

  it('sends the batch the bootstrap queued, rather than leaving it in the machine', async () => {
    // The machine queues; nothing leaves the device until the pump sends it.
    // An identity "established" but never uploaded is one the server has
    // never heard of.
    const d = drainer([SENT_THE_BATCH])
    await establishCrossSigningIdentity(machine(), d.drain, 'restored-session')
    expect(d.calls).toHaveLength(1)
  })

  it('asks the server first when it has not been asked, then tries again', async () => {
    // The refusal is not a failure: the call queues the key query on its way
    // out, so the remedy is to send it and ask again.
    let asked = false
    const m = machine({
      bootstrap: async () => {
        if (!asked) {
          asked = true
          throw crypto('account_keys_not_fetched')
        }
      },
    })
    const d = drainer([
      { sent: 1, failed: 0, sentKinds: ['keys_query'], failures: [] },
      SENT_THE_BATCH,
    ])
    await expect(
      establishCrossSigningIdentity(m, d.drain, 'restored-session'),
    ).resolves.toEqual({ established: true, how: 'published' })
    expect(m.calls).toEqual(['bootstrap', 'bootstrap'])
  })

  it('stops asking when the answer came back and still settled nothing', async () => {
    // A different situation wearing the same refusal, and the library is
    // explicit that calling again does exactly the same thing. The reachable
    // cause is a user id whose server name differs in case from the
    // homeserver's own, which no number of retries will fix.
    const m = machine({
      bootstrap: async () => {
        throw crypto('account_keys_not_fetched')
      },
      status: { accountKeysFetched: false, accountKeysAnswerUnsettled: true },
    })
    const d = drainer([NOTHING_TO_SEND])
    const result = await establishCrossSigningIdentity(
      m,
      d.drain,
      'account-just-created',
    )
    expect(result.established).toBe(false)
    if (!result.established) expect(result.reason).toContain('case')
    // Asked once and stopped, rather than spending every round on it.
    expect(m.calls).toEqual(['bootstrap'])
    expect(d.calls).toHaveLength(0)
  })

  it('creates the account first identity when this launch created the account', async () => {
    const m = machine({
      bootstrap: async () => {
        throw crypto('identity_not_known')
      },
    })
    const d = drainer([SENT_THE_BATCH])
    await expect(
      establishCrossSigningIdentity(m, d.drain, 'account-just-created'),
    ).resolves.toEqual({ established: true, how: 'created' })
    expect(m.calls).toEqual(['bootstrap', 'create'])
  })

  it('refuses to create one on a launch that only restored a session', async () => {
    // This is the whole reason the two calls are separate on the library's
    // surface. Creating an identity over one the account already has resets
    // the trust of every device and every person who verified it, there is no
    // undo, and nothing afterwards can detect it. A key query answer is only
    // true of the instant the server sent it -- so the entitlement has to
    // come from something this application knows and the library cannot:
    // that this very launch created the account, by spending a single-use
    // invitation.
    const m = machine({
      bootstrap: async () => {
        throw crypto('identity_not_known')
      },
    })
    const result = await establishCrossSigningIdentity(
      m,
      drainer([NOTHING_TO_SEND]).drain,
      'restored-session',
    )
    expect(result.established).toBe(false)
    expect(m.calls).toEqual(['bootstrap'])
    expect(m.calls).not.toContain('create')
  })

  it('reports a publication left unacknowledged without finishing it on a restore', async () => {
    // The one state where the account still has no identity and this device
    // holds one: created here, never acknowledged by a homeserver, and it
    // survives a relaunch because the identity is on disk and the publication
    // was in memory.
    //
    // The library's remedy is the same create call again -- and its next
    // sentence is why that must not be automatic: "which is why finishing is
    // a decision". The incident it reports measuring is exactly this shape: a
    // device in this state, answered honestly that the account has no
    // identity, publishing over an identity a second device had legitimately
    // created in the gap. "The launch-time call did it."
    //
    // Finishing needs a fact that outlives the launch that started it. Until
    // something persists it, reporting the state is the safe direction.
    const m = machine({
      bootstrap: async () => {
        throw crypto('identity_not_known')
      },
      status: { identityPublicationPending: true },
    })
    const result = await establishCrossSigningIdentity(
      m,
      drainer([SENT_THE_BATCH]).drain,
      'restored-session',
    )
    expect(result.established).toBe(false)
    expect(m.calls).not.toContain('create')
  })

  it('does not claim an identity the machine does not report holding', async () => {
    // A call that did not throw is not the same fact as an identity that
    // exists. The acceptance criterion asks for the machine's own state, so
    // the state is read back rather than inferred from an absence of errors.
    const m = machine({
      status: { identityKnown: false, privateKeysHeld: false },
    })
    const result = await establishCrossSigningIdentity(
      m,
      drainer([SENT_THE_BATCH]).drain,
      'restored-session',
    )
    expect(result.established).toBe(false)
  })

  it('does not report "none" for an identity it just created but could not publish', async () => {
    // Creation is irreversible, so a 401 leaves an identity that exists on
    // this device and nowhere else. Saying "none" would hide it; saying
    // "established" is the error the library names outright.
    const m = machine({
      bootstrap: async () => {
        throw crypto('identity_not_known')
      },
      status: { identityPublicationPending: true },
    })
    const d = drainer([
      {
        sent: 0,
        failed: 1,
        sentKinds: [],
        failures: [{ kind: 'signing_keys_upload', status: 401 }],
      },
    ])
    const result = await establishCrossSigningIdentity(
      m,
      d.drain,
      'account-just-created',
    )
    expect(result.established).toBe(false)
    expect(result).toHaveProperty('publicationPending', true)
    if (!result.established) {
      expect(result.reason).toContain('created here')
      expect(result.reason).toContain('interactive authentication')
    }
  })

  it('never creates an identity over one another device published', async () => {
    // This device joins that identity, it does not replace it. Joining is a
    // verification, which is another ticket; refusing here is what keeps this
    // one from destroying it.
    const m = machine({
      bootstrap: async () => {
        throw crypto('identity_already_exists')
      },
    })
    const result = await establishCrossSigningIdentity(
      m,
      drainer([NOTHING_TO_SEND]).drain,
      'account-just-created',
    )
    expect(result.established).toBe(false)
    if (!result.established) expect(result.reason).toContain('another device')
    expect(m.calls).not.toContain('create')
  })

  it('says when the server asked for interactive authentication', async () => {
    // The first upload for an account that has no identity needs none, since
    // Matrix 1.11. A server that asks anyway refuses with 401, and this
    // application holds no password to answer with -- it deliberately never
    // kept the one the claim returned. Naming it is what stops a 401 here
    // from reading as a generic upload failure.
    const m = machine({
      bootstrap: async () => {
        throw crypto('identity_not_known')
      },
    })
    const d = drainer([
      {
        sent: 0,
        failed: 1,
        sentKinds: [],
        failures: [{ kind: 'signing_keys_upload', status: 401 }],
      },
    ])
    const result = await establishCrossSigningIdentity(
      m,
      d.drain,
      'account-just-created',
    )
    expect(result.established).toBe(false)
    if (!result.established) {
      expect(result.reason).toContain('interactive authentication')
    }
  })

  it('reports a failed upload without claiming the identity was published', async () => {
    const m = machine({
      bootstrap: async () => {
        throw crypto('identity_not_known')
      },
    })
    const d = drainer([
      {
        sent: 0,
        failed: 1,
        sentKinds: [],
        failures: [{ kind: 'signing_keys_upload', status: 500 }],
      },
    ])
    const result = await establishCrossSigningIdentity(
      m,
      d.drain,
      'account-just-created',
    )
    expect(result.established).toBe(false)
    if (!result.established) {
      expect(result.reason).toContain('signing_keys_upload')
    }
  })

  it('reports an unrecognised refusal rather than treating it as absence', async () => {
    const m = machine({
      bootstrap: async () => {
        throw crypto('store_unavailable')
      },
    })
    const result = await establishCrossSigningIdentity(
      m,
      drainer([NOTHING_TO_SEND]).drain,
      'account-just-created',
    )
    expect(result.established).toBe(false)
    expect(m.calls).not.toContain('create')
  })

  it('stops instead of asking the server forever', async () => {
    // A machine that never stops saying it has not asked would otherwise loop
    // for as long as the launch lasts.
    const m = machine({
      bootstrap: async () => {
        throw crypto('account_keys_not_fetched')
      },
      status: { accountKeysFetched: false },
    })
    const result = await establishCrossSigningIdentity(
      m,
      drainer([{ sent: 1, failed: 0, sentKinds: ['keys_query'], failures: [] }])
        .drain,
      'restored-session',
    )
    expect(result.established).toBe(false)
    if (!result.established) expect(result.reason).toContain('settle')
  })
})
