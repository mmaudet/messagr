import { describe, expect, it } from 'vitest'

import type { BackupAcceptedFrom } from './acceptBackup'
import { acceptanceGate } from './acceptanceGate'

/** A promise the test settles when it chooses, as a slow homeserver would. */
function pending<T>() {
  let settle: (value: T) => void = () => undefined
  let refuse: (cause: unknown) => void = () => undefined
  const promise = new Promise<T>((resolve, reject) => {
    settle = resolve
    refuse = reject
  })
  return { promise, settle, refuse }
}

const ACCEPTED: BackupAcceptedFrom = {
  accepted: true,
  restoreKey: 'EsTx aaaa bbbb cccc',
}

describe('one acceptance at a time', () => {
  // #284, found in review. A first tap failed on a slow network and the card
  // said « Réessayez ». Nothing showed the retry running, so more taps started
  // more acceptances, each with its own key and version: the screen could end
  // on one key while the keystore kept another, which the next launch turns on.
  it('runs nothing while an acceptance is still running', () => {
    const gate = acceptanceGate()
    const first = pending<BackupAcceptedFrom>()
    let secondRan = false

    gate.run(() => first.promise)
    const second = gate.run(async () => {
      secondRan = true
      return ACCEPTED
    })

    expect(second).toBeNull()
    expect(secondRan).toBe(false)
  })

  it('lets the next acceptance run once the last has ended, even one that threw', async () => {
    // `acceptBackupFrom` does not reject, and the gate does not count on it:
    // a gate left shut would keep the button inert until the next launch.
    const gate = acceptanceGate()
    const first = pending<BackupAcceptedFrom>()

    const running = gate.run(() => first.promise)
    first.refuse(new Error('the native module never installed'))
    await running?.catch(() => undefined)

    expect(gate.run(async () => ACCEPTED)).not.toBeNull()
  })

  it('answers what the screen shows: the key, or the failure', async () => {
    const gate = acceptanceGate()

    expect(await gate.run(async () => ACCEPTED)).toEqual({
      show: 'key',
      restoreKey: 'EsTx aaaa bbbb cccc',
    })
    expect(
      await gate.run(async (): Promise<BackupAcceptedFrom> => ({
        accepted: false,
        failedAt: 'publishing',
      })),
    ).toEqual({ show: 'failure' })
  })
})
