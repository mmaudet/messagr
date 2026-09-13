import { describe, expect, it } from 'vitest'

import {
  startCallPermissions,
  type Allowed,
  type CallPermission,
  type PermissionPorts,
} from './permissions'

// When a call asks the telephone for its microphone and its camera. The
// telephone here is a script: what is granted is a set the test holds, and
// every dialog is recorded and answers what the test says it answers.

/** Ports over what is granted, keeping every dialog that was shown. */
function telephone(
  granted: readonly CallPermission[] = [],
  refused: readonly CallPermission[] = [],
) {
  const held = new Set<CallPermission>(granted)
  const dialogs: CallPermission[][] = []
  const ports: PermissionPorts = {
    granted: async permission => held.has(permission),
    request: async permissions => {
      dialogs.push([...permissions])
      const yes = permissions.filter(one => !refused.includes(one))
      for (const one of yes) held.add(one)
      return yes
    },
  }
  return { ports, dialogs }
}

/** Every continuation already queued has run. */
async function settled(): Promise<void> {
  await new Promise(resolve => setImmediate(resolve))
}

describe('a call that rings', () => {
  it('asks for the microphone when it rings in front, and for the camera too when it offers a picture', async () => {
    const audio = telephone()
    startCallPermissions(audio.ports, true).ringing({
      callId: 'call-audio',
      video: false,
    })
    await settled()
    expect(audio.dialogs).toEqual([['microphone']])

    const video = telephone()
    startCallPermissions(video.ports, true).ringing({
      callId: 'call-video',
      video: true,
    })
    await settled()
    expect(video.dialogs).toEqual([['microphone', 'camera']])
  })

  it('asks only for what has not been granted yet, and for nothing once both have', async () => {
    const half = telephone(['microphone'])
    startCallPermissions(half.ports, true).ringing({
      callId: 'call-video',
      video: true,
    })
    await settled()
    expect(half.dialogs).toEqual([['camera']])

    const both = telephone(['microphone', 'camera'])
    startCallPermissions(both.ports, true).ringing({
      callId: 'call-video',
      video: true,
    })
    await settled()
    expect(both.dialogs).toEqual([])
  })

  it('waits for the application to come in front when the call rang behind it, and forgets a call that stopped ringing meanwhile', async () => {
    const woken = telephone()
    const asking = startCallPermissions(woken.ports, false)
    asking.ringing({ callId: 'call-audio', video: false })
    await settled()
    expect(woken.dialogs).toEqual([])

    asking.foreground(true)
    await settled()
    expect(woken.dialogs).toEqual([['microphone']])

    const missed = telephone()
    const late = startCallPermissions(missed.ports, false)
    late.ringing({ callId: 'call-audio', video: false })
    late.ringing(null)
    late.foreground(true)
    await settled()
    expect(missed.dialogs).toEqual([])
  })

  it('asks once for a call, however often it hears that call ring, and again for the next one', async () => {
    // Refused, so that nothing granted in between can stand in for the rule:
    // every one of these gestures would open the dialog again otherwise.
    const refusing = telephone([], ['microphone'])
    const asking = startCallPermissions(refusing.ports, true)
    asking.ringing({ callId: 'call-first', video: false })
    asking.ringing({ callId: 'call-first', video: false })
    asking.foreground(false)
    asking.foreground(true)
    await settled()
    expect(refusing.dialogs).toEqual([['microphone']])

    asking.ringing(null)
    asking.ringing({ callId: 'call-second', video: false })
    await settled()
    expect(refusing.dialogs).toEqual([['microphone'], ['microphone']])
  })
})

describe('a call being placed', () => {
  it('asks before its invitation leaves, and is not placed without the microphone', async () => {
    const granting = telephone()
    const video = await startCallPermissions(
      granting.ports,
      true,
    ).beforePlacing({ video: true })
    expect(granting.dialogs).toEqual([['microphone', 'camera']])
    expect(video).toEqual({
      allowed: true,
      wants: { video: true },
      cameraRefused: false,
    })

    const refusing = telephone([], ['microphone'])
    const audio = await startCallPermissions(
      refusing.ports,
      true,
    ).beforePlacing()
    expect(refusing.dialogs).toEqual([['microphone']])
    expect(audio).toMatchObject({
      allowed: false,
      failure: { kind: 'no-microphone' },
    })
  })

  it('is placed without a picture when only the camera was refused', async () => {
    // A whole call still, as #199 decided and as the screen's own sentence
    // says: « L’appel continue sans votre image ».
    const refusing = telephone([], ['camera'])
    const allowed = await startCallPermissions(
      refusing.ports,
      true,
    ).beforePlacing({ video: true })
    expect(allowed).toEqual({
      allowed: true,
      wants: { video: false },
      cameraRefused: true,
    })
  })
})

describe('a call being answered', () => {
  it('asks nothing: it waits for the dialog the ring opened, and is not answered without the microphone', async () => {
    // A dialog that stays on screen until the person closes it -- which is
    // how an answer pressed from a notification meets the ring's own dialog.
    const held = new Set<CallPermission>()
    const dialogs: CallPermission[][] = []
    let close: ((granted: readonly CallPermission[]) => void) | undefined
    const ports: PermissionPorts = {
      granted: async permission => held.has(permission),
      request: async permissions => {
        dialogs.push([...permissions])
        return await new Promise(resolve => {
          close = granted => {
            for (const one of granted) held.add(one)
            resolve(granted)
          }
        })
      },
    }
    const asking = startCallPermissions(ports, true)
    asking.ringing({ callId: 'call-audio', video: false })

    let answered: Allowed | undefined
    const answering = asking.beforeAnswering().then(allowed => {
      answered = allowed
    })
    await settled()
    expect(answered).toBeUndefined()

    close?.([])
    await answering
    expect(answered).toMatchObject({
      allowed: false,
      failure: { kind: 'no-microphone' },
    })
    expect(dialogs).toEqual([['microphone']])
  })
})
