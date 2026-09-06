import type { SecretStore } from './sessionStore'

/**
 * Whether this device asks to be woken when a message arrives.
 *
 * # Why this one is on by default, and receipts are not
 *
 * They look like the same kind of switch and they are opposites.
 *
 * A read receipt publishes something about a person: who read what, and when,
 * legible to the homeserver. Its default is off because a default is a
 * decision made for everybody who never opens Settings, and the decision that
 * costs them nothing is the quiet one.
 *
 * A wake publishes nothing. What crosses the push infrastructure is
 * `{"prio":"high"}` — `services/invitations`, `handlers::wake` — so turning it
 * on tells Google that a device exists and nothing about what it is being told.
 * It is on by default because a messenger that does not tell you a message
 * arrived is not doing the thing it was installed for.
 *
 * What the switch does hand over is the fact of a device being reachable, and
 * somebody who does not want that should be able to say so. That is what the
 * off position is for, and it is a real off: no pusher is registered, so the
 * homeserver has nowhere to send.
 *
 * # Which way it fails
 *
 * A store that cannot be read answers **on**, which is the opposite direction
 * from `receiptSetting.ts` and for the opposite reason. Failing quiet there
 * protects somebody from publishing when they did not ask to; failing quiet
 * here would leave a phone that never rings, with nothing on screen to explain
 * why. Neither failure is silent about anything that matters, and this one is
 * the recoverable direction.
 */

const OFF = 'off'

export async function wakeIsAllowed(store: SecretStore): Promise<boolean> {
  try {
    return (await store.read()) !== OFF
  } catch {
    return true
  }
}

/** `false` when the choice could not be kept, as everywhere else here. */
export async function allowWake(
  store: SecretStore,
  on: boolean,
): Promise<boolean> {
  try {
    // Written both ways rather than deleted for one of them, so that each is
    // a value somebody chose and not the absence of one.
    await store.write(on ? 'on' : OFF)
    return true
  } catch {
    return false
  }
}
