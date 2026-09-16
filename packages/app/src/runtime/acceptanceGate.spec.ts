import { describe, expect, it } from 'vitest'

import type { BackupAcceptedFrom } from './acceptBackup'
import { acceptance } from './acceptanceGate'
import type { BackupReplacedFrom } from './replaceBackup'

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

const REPLACED: BackupReplacedFrom = {
  replaced: true,
  restoreKey: 'EsTx dddd eeee ffff',
  oldRetired: true,
}

describe('one gesture on the backup at a time, a replacement included', () => {
  // #284, found in review: a second tap on « Oui, remplacer ma clé » started a
  // second replacement, because the replacement ran outside this gate. Two
  // replacements, or one beside an acceptance, publish two versions, and the
  // keystore ends holding either one.
  it('starts no replacement while an acceptance is running', async () => {
    const backup = acceptance()
    const accepting = pending<BackupAcceptedFrom>()
    let replacementRan = false

    expect(backup.start(() => accepting.promise)).toBe(true)
    expect(
      backup.replace(async () => {
        replacementRan = true
        return REPLACED
      }),
    ).toBe(false)
    await settled()
    expect(replacementRan).toBe(false)
  })

  it('starts neither an acceptance nor a second replacement while a replacement is running', async () => {
    // The second tap the review found, and its mirror: an acceptance begun
    // from the offer while the key is being replaced.
    const backup = acceptance()
    const replacing = pending<BackupReplacedFrom>()
    let anotherRan = false

    expect(backup.replace(() => replacing.promise)).toBe(true)
    expect(
      backup.replace(async () => {
        anotherRan = true
        return REPLACED
      }),
    ).toBe(false)
    expect(
      backup.start(async () => {
        anotherRan = true
        return ACCEPTED
      }),
    ).toBe(false)
    await settled()
    expect(anotherRan).toBe(false)
  })

  it("hands a replacement's key to the screen mounted, with whether the old key still opens", async () => {
    // What a replacement adds to its key: an old version that would not go
    // still opens the old backup, and the key screen has to say so.
    const backup = acceptance()
    const shown: unknown[] = []
    backup.receive(what => shown.push(what))
    backup.replace(async (): Promise<BackupReplacedFrom> => ({
      replaced: true,
      restoreKey: 'EsTx dddd eeee ffff',
      oldRetired: false,
    }))
    await settled()

    expect(shown).toEqual([
      { show: 'key', restoreKey: 'EsTx dddd eeee ffff', oldStillOpens: true },
    ])
  })

  it("hands a replacement's failure to the screen mounted, with where it stopped, a throw included", async () => {
    // What the screen may say depends on the step: « rien n'a changé » only
    // before the publish. A rejection is `thrown`, as `replaceBackupFrom`
    // answers one, because `replaceBackup` lets a throw out only before it.
    const backup = acceptance()
    const shown: unknown[] = []
    backup.receive(what => shown.push(what))
    backup.replace(async (): Promise<BackupReplacedFrom> => ({
      replaced: false,
      failedAt: 'enabling',
    }))
    await settled()
    backup.replace(async () => {
      throw new Error('the native module never installed')
    })
    await settled()

    expect(shown).toEqual([
      { show: 'replacementFailure', failedAt: 'enabling' },
      { show: 'replacementFailure', failedAt: 'thrown' },
    ])
  })
})

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

  it('keeps a key that settled while no screen was mounted, until the key screen is done with it', async () => {
    // The whole of the remount: the acceptance went through with no App to
    // show its key, and the next App has to show it, until somebody has said
    // they put it away.
    const backup = acceptance()
    backup.start(async () => ACCEPTED)
    await settled()

    const first: unknown[] = []
    const second: unknown[] = []
    backup.receive(what => first.push(what))
    backup.keyDone()
    backup.receive(what => second.push(what))

    expect(first).toEqual([{ show: 'key', restoreKey: 'EsTx aaaa bbbb cccc' }])
    expect(second).toEqual([])
  })

  it('hands a key again to the next screen when the one it went to was going away', async () => {
    // #284, found in review: a mount lets go in its passive cleanup, after it
    // has stopped drawing. A key that settled in between went to a screen that
    // could no longer show it, and the next mount received nothing: a backup
    // whose key nobody has seen.
    const backup = acceptance()
    const going: unknown[] = []
    const next: unknown[] = []
    const letGo = backup.receive(what => going.push(what))
    backup.start(async () => ACCEPTED)
    await settled()
    letGo()
    backup.receive(what => next.push(what))

    expect(going).toEqual([{ show: 'key', restoreKey: 'EsTx aaaa bbbb cccc' }])
    expect(next).toEqual([{ show: 'key', restoreKey: 'EsTx aaaa bbbb cccc' }])
  })

  it('hands a key to no later screen once the key screen is done with it', async () => {
    // « Montrée une fois »: once somebody has said they put it away, no copy
    // is left for a later mount to draw.
    const backup = acceptance()
    backup.receive(() => undefined)
    backup.start(async () => ACCEPTED)
    await settled()
    backup.keyDone()

    const later: unknown[] = []
    backup.receive(what => later.push(what))

    expect(later).toEqual([])
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

  it('says which gesture is running, and tells watchers when that changes', async () => {
    // What a screen mounted mid-gesture draws « Activation… » or
    // « Remplacement… » from, and what leaves every other button inert.
    const backup = acceptance()
    const accepting = pending<BackupAcceptedFrom>()
    const replacing = pending<BackupReplacedFrom>()
    let told = 0
    backup.subscribe(() => {
      told += 1
    })

    backup.start(() => accepting.promise)
    expect(backup.running()).toBe('accept')
    accepting.settle(ACCEPTED)
    await settled()
    expect(backup.running()).toBe(null)

    backup.replace(() => replacing.promise)
    expect(backup.running()).toBe('replace')
    replacing.settle(REPLACED)
    await settled()

    expect(backup.running()).toBe(null)
    expect(told).toBe(4)
  })
})

/** Lets every promise that can settle now settle, and their callbacks run. */
function settled(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}
