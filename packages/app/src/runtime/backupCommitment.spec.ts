import { describe, expect, it } from 'vitest'

import {
  forgetBackupCommitment,
  readBackupCommitment,
  rememberBackupCommitment,
} from './backupCommitment'
import type { SecretStore } from './sessionStore'

/** A store backed by one variable, which is what the real one is. */
function store(initial: string | null = null): SecretStore & {
  held: string | null
} {
  const held = {
    held: initial,
    read: async () => held.held,
    write: async (value: string) => {
      held.held = value
    },
  }
  return held
}

/** A store that refuses, which is the case with a wrong answer available. */
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

const COMMITMENT = { sealingKey: 'c3VyZmFjZQ', version: '947281' }

describe('what this device needs to keep writing to its backup', () => {
  it('gives back what was written', async () => {
    const kept = store()

    expect(await rememberBackupCommitment(kept, COMMITMENT)).toBe(true)
    expect(await readBackupCommitment(kept)).toEqual(COMMITMENT)
  })

  it('never turns the version into a number', async () => {
    // Six digits with a leading zero: Continuwuity 26.7.2 answers with a
    // six-digit integer where Synapse answers with a counter from "1", and
    // the specification makes the field opaque. A round trip through a
    // number would lose the zero and the homeserver would answer for some
    // other backup or for none.
    const kept = store()
    await rememberBackupCommitment(kept, { ...COMMITMENT, version: '047281' })

    expect((await readBackupCommitment(kept))?.version).toBe('047281')
  })

  it('says nothing is committed on a device that never accepted', async () => {
    expect(await readBackupCommitment(store())).toBeNull()
  })

  it('says nothing is committed when the keystore refuses', async () => {
    // The direction that matters. Answering "committed" here would leave a
    // device believing it backs up while it does not, and somebody relying
    // on that finds out at the worst possible moment.
    expect(await readBackupCommitment(refusing())).toBeNull()
  })

  it('treats a damaged entry as no commitment at all', async () => {
    // Half a commitment is worse than none: a version with no key backs
    // nothing up, and a key with no version is refused by the bridge, which
    // treats an empty version as the absence of one. The answer is the same
    // as for an absent entry because what a caller does about either is the
    // same -- offer to set one up.
    for (const damaged of [
      'not json at all',
      '{}',
      'null',
      '[]',
      '"a string"',
      JSON.stringify({ sealingKey: 'c3VyZmFjZQ' }),
      JSON.stringify({ version: '947281' }),
      JSON.stringify({ sealingKey: '', version: '947281' }),
      JSON.stringify({ sealingKey: 'c3VyZmFjZQ', version: '' }),
      JSON.stringify({ sealingKey: 7, version: '947281' }),
    ]) {
      expect(await readBackupCommitment(store(damaged))).toBeNull()
    }
  })

  it('reports a write it could not keep, rather than pretending', async () => {
    // Not the cost of a repeated screen, unlike the promise flag: the
    // version exists on the homeserver by now, and a device that cannot
    // remember it will never write to it. The caller has to be able to say
    // so.
    expect(await rememberBackupCommitment(refusing(), COMMITMENT)).toBe(false)
  })

  it('stops writing to a version once the commitment is forgotten', async () => {
    const kept = store()
    await rememberBackupCommitment(kept, COMMITMENT)

    expect(await forgetBackupCommitment(kept)).toBe(true)
    expect(await readBackupCommitment(kept)).toBeNull()
  })

  it('forgetting is a local act and the caller can tell when it failed', async () => {
    expect(await forgetBackupCommitment(refusing())).toBe(false)
  })

  it('keeps the two halves as one value, so half of it cannot exist', async () => {
    const kept = store()
    await rememberBackupCommitment(kept, COMMITMENT)

    // One entry, one write. A store interrupted between two writes would
    // otherwise leave a version with no key, which backs nothing up while
    // reading as though something were set up.
    expect(JSON.parse(kept.held ?? '')).toEqual(COMMITMENT)
  })
})
