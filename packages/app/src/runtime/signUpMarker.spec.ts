import { describe, expect, it } from 'vitest'

import type { SecretStore } from './sessionStore'
import {
  clearSignUp,
  isSignUpUnfinished,
  markSignUpStarted,
} from './signUpMarker'

function store(initial: string | null = null) {
  let held = initial
  const written: (string | null)[] = []
  const secrets: SecretStore = {
    read: async () => held,
    write: async value => {
      held = value
      written.push(value)
    },
  }
  return { secrets, written, current: () => held }
}

const refuses: SecretStore = {
  read: async () => {
    throw new Error('keystore unavailable')
  },
  write: async () => {
    throw new Error('keystore unavailable')
  },
}

describe('the sign-up marker', () => {
  it('says nothing is unfinished on a device that never signed up here', async () => {
    await expect(isSignUpUnfinished(store().secrets)).resolves.toBe(false)
  })

  it('remembers that a sign-up started', async () => {
    const s = store()
    await markSignUpStarted(s.secrets)
    await expect(isSignUpUnfinished(s.secrets)).resolves.toBe(true)
  })

  it('forgets it once the sign-up finished', async () => {
    const s = store()
    await markSignUpStarted(s.secrets)
    await clearSignUp(s.secrets)
    await expect(isSignUpUnfinished(s.secrets)).resolves.toBe(false)
  })

  it('treats a keystore it cannot read as no permission, never as permission', async () => {
    // This marker is the entitlement to make the one destructive call on the
    // crypto library's surface. A read that failed and was taken as "yes"
    // would hand that call to every launch on a device whose keystore is
    // merely locked.
    await expect(isSignUpUnfinished(refuses)).resolves.toBe(false)
  })

  it('reports a marker it could not write rather than pretending it did', async () => {
    // A sign-up that started and was not recorded is one no later launch can
    // finish. The caller can at least say so.
    await expect(markSignUpStarted(refuses)).resolves.toBe(false)
  })

  it('reports a marker it could not clear', async () => {
    // Worse than it looks: a marker that will not clear leaves every later
    // launch entitled to the destructive call, forever.
    await expect(clearSignUp(refuses)).resolves.toBe(false)
  })

  it('reads an unrecognised value as nothing rather than as something', async () => {
    // Whatever wrote it, it was not this. Guessing in the permissive
    // direction is the one mistake this file exists to avoid.
    await expect(isSignUpUnfinished(store('yes please').secrets)).resolves.toBe(
      false,
    )
  })

  it('clears by writing, not by leaving the old value in place', async () => {
    const s = store()
    await markSignUpStarted(s.secrets)
    await clearSignUp(s.secrets)
    expect(s.written).toHaveLength(2)
    expect(s.current()).not.toBe(s.written[0])
  })
})
