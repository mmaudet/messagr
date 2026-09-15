import { describe, expect, it } from 'vitest'

import type { BackupAcceptedFrom } from './acceptBackup'
import { acceptance } from './acceptanceGate'

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

describe('one acceptance at a time, whatever mounts the screen', () => {
  // #284, found in review twice. First: more taps started more acceptances,
  // each with its own key and version. Then: the gate and the key lived in one
  // mount of App, and on Android 7 to 11 a back press, or a change of font size
  // or language, gives a new mount while JavaScript runs on. The key went to a
  // mount nobody sees, and a fresh gate let a second acceptance start.
  it('starts nothing while an acceptance is still running', () => {
    const backup = acceptance()
    const first = pending<BackupAcceptedFrom>()
    let secondRan = false

    expect(backup.start(() => first.promise)).toBe(true)
    expect(
      backup.start(async () => {
        secondRan = true
        return ACCEPTED
      }),
    ).toBe(false)
    expect(secondRan).toBe(false)
  })

  it('starts again once the last has settled, even one that threw', async () => {
    // `acceptBackupFrom` does not reject, and this does not count on it: a
    // gate left shut would keep the button inert for as long as JavaScript
    // runs.
    const backup = acceptance()
    backup.start(async () => {
      throw new Error('the native module never installed')
    })
    await settled()

    expect(backup.start(async () => ACCEPTED)).toBe(true)
  })

  it('hands the key to the screen that is mounted', async () => {
    const backup = acceptance()
    const shown: unknown[] = []
    backup.receive(what => shown.push(what))
    backup.start(async () => ACCEPTED)
    await settled()

    expect(shown).toEqual([{ show: 'key', restoreKey: 'EsTx aaaa bbbb cccc' }])
  })

  it('hands a failure to the screen that is mounted, a throw included', async () => {
    const backup = acceptance()
    const shown: unknown[] = []
    backup.receive(what => shown.push(what))
    backup.start(async (): Promise<BackupAcceptedFrom> => ({
      accepted: false,
      failedAt: 'publishing',
    }))
    await settled()
    backup.start(async () => {
      throw new Error('the native module never installed')
    })
    await settled()

    expect(shown).toEqual([{ show: 'failure' }, { show: 'failure' }])
  })

  it('keeps a key that settled while no screen was mounted, for the next one', async () => {
    // The whole of the remount: the acceptance went through with no App to
    // show its key, and the next App has to show it, once.
    const backup = acceptance()
    backup.start(async () => ACCEPTED)
    await settled()

    const first: unknown[] = []
    const second: unknown[] = []
    backup.receive(what => first.push(what))
    backup.receive(what => second.push(what))

    expect(first).toEqual([{ show: 'key', restoreKey: 'EsTx aaaa bbbb cccc' }])
    expect(second).toEqual([])
  })

  it('lets a failure go when no screen was mounted to say it', async () => {
    // Nobody saw the screen that was waiting: a card drawn on whatever mounts
    // next would be about nothing on it.
    const backup = acceptance()
    backup.start(async (): Promise<BackupAcceptedFrom> => ({
      accepted: false,
      failedAt: 'publishing',
    }))
    await settled()

    const shown: unknown[] = []
    backup.receive(what => shown.push(what))

    expect(shown).toEqual([])
  })

  it('keeps handing to the screen mounted last when an earlier one lets go', async () => {
    // A new mount can take over before the old one has unmounted, and the old
    // one letting go must not leave the new one deaf.
    const backup = acceptance()
    const old: unknown[] = []
    const current: unknown[] = []
    const releaseOld = backup.receive(what => old.push(what))
    backup.receive(what => current.push(what))
    releaseOld()
    backup.start(async () => ACCEPTED)
    await settled()

    expect(current).toEqual([
      { show: 'key', restoreKey: 'EsTx aaaa bbbb cccc' },
    ])
    expect(old).toEqual([])
  })

  it('says whether an acceptance is running, and tells watchers when that changes', async () => {
    // What a screen mounted mid-acceptance draws « Activation… » from.
    const backup = acceptance()
    const first = pending<BackupAcceptedFrom>()
    let told = 0
    backup.subscribe(() => {
      told += 1
    })

    backup.start(() => first.promise)
    expect(backup.running()).toBe(true)
    first.settle(ACCEPTED)
    await settled()

    expect(backup.running()).toBe(false)
    expect(told).toBe(2)
  })
})

/** Lets every promise that can settle now settle, and their callbacks run. */
function settled(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}
