import { blindNotification, type Notification } from './notifying'

/**
 * What a device does when it is woken and told nothing.
 *
 * # The wake carries nothing, by construction
 *
 * `services/invitations`, `handlers::wake`: what crosses Firebase is
 * `{"prio":"high"}`. So this cannot start from the message — there is no
 * message. It starts from the only thing the device has, which is its own
 * account, and goes and looks.
 *
 * # Two outcomes, and the quiet one is not a failure
 *
 * If the crypto store opens, the device syncs, decrypts what arrived, and says
 * who and what. If it does not — a phone that has not been unlocked since it
 * was switched on, which is exactly what ADR-0008's accessibility setting
 * bounds — the notification says that something arrived and nothing more.
 *
 * That fallback is the product working, not degrading. A notification that
 * named a sender would mean the name had crossed Firebase; one that guessed
 * would be worse than one that admits it does not know.
 *
 * # Why this is a function of ports
 *
 * Everything here happens in a headless JavaScript context with no screen, no
 * navigation and no application state. Written against the real modules it
 * would be untestable, which for the one path nobody watches run is the worst
 * possible property.
 */

export interface WakeDeps {
  /**
   * Opens the store and derives what arrived, or answers `null` when the
   * store will not open. `null` is the whole reason the blind case exists.
   */
  readonly lookForWhatArrived: () => Promise<WhatWoke | null>
  readonly draw: (notification: Notification) => Promise<void>
  /** Builds what a decrypted arrival says. Injected so wording stays in copy. */
  readonly describe: (arrival: Arrival) => Notification
  /**
   * Draws a ringing call, which is a different thing from a notification: it
   * takes the screen, it has two answers, and it stops when the call does.
   * Injected like the rest, because a headless context is the one place
   * nothing can be observed.
   */
  readonly ring: (calling: Calling) => Promise<void>
}

/** Somebody calling, as a wake found them. */
export interface Calling {
  readonly scope: string
  readonly shown: string
  readonly from: string
}

export interface WhatWoke {
  readonly messages: readonly Arrival[]
  readonly ringing: readonly Calling[]
}

export interface Arrival {
  readonly scope: string
  /** Who it is from, as this device would show them. */
  readonly shown: string
  /** The opening of what they said. */
  readonly preview: string
}

export type WakeOutcome =
  | { readonly drew: 'blind'; readonly reason: string }
  | { readonly drew: 'nothing' }
  | { readonly drew: 'read'; readonly count: number }
  /**
   * A telephone is ringing. Reported apart from `read` because it is the one
   * outcome somebody is waiting on the other end of: a wake that drew a
   * notification and a wake that rang are the same code path and very
   * different events, and the log is all anybody has here.
   */
  | { readonly drew: 'ringing'; readonly count: number }

export async function wake(deps: WakeDeps): Promise<WakeOutcome> {
  let woke: WhatWoke | null
  try {
    woke = await deps.lookForWhatArrived()
  } catch (cause: unknown) {
    // A LOOK THAT FAILED STILL MEANS SOMETHING ARRIVED.
    //
    // The homeserver woke this device because it had something to deliver.
    // Failing to fetch it does not unmake that, and staying silent would lose
    // the notification entirely -- which is the failure a person notices.
    await deps.draw(blindNotification())
    return { drew: 'blind', reason: reasonOf(cause) }
  }

  if (woke === null) {
    await deps.draw(blindNotification())
    return { drew: 'blind', reason: 'this device could not open its store' }
  }

  // A RINGING TELEPHONE COMES FIRST, AND ALONE.
  //
  // Somebody is holding a telephone waiting for this one to answer, and they
  // have ninety seconds. Drawing message notifications first would spend
  // that budget on lines nobody is waiting on, and a message notification
  // over a ringing call is a call somebody misses. So the call is rung and
  // the messages wait for the next wake, or for the application opening --
  // neither of which anybody is standing on the other end of.
  if (woke.ringing.length > 0) {
    for (const calling of woke.ringing) {
      try {
        await deps.ring(calling)
      } catch {
        // Nothing to report to. The next one is still attempted, for the
        // same reason the message loop below catches its own.
      }
    }
    return { drew: 'ringing', count: woke.ringing.length }
  }

  const arrivals = woke.messages

  // Nothing to say. A wake that finds nothing is ordinary: the message may
  // have been read on another device between the push and this, and drawing
  // "something arrived" for it would be a notification about nothing.
  if (arrivals.length === 0) return { drew: 'nothing' }

  // One per conversation, newest last so that the last one drawn is the one
  // on top. Every arrival is drawn rather than only the newest: two people
  // writing at once is two notifications, which is what a person expects.
  //
  // Each guarded on its own. A platform refusing one notification -- a
  // channel deleted, a quota -- must not swallow the others, and this loop
  // has nobody watching it: there is no screen to show that half of them
  // never appeared.
  for (const arrival of arrivals) {
    try {
      await deps.draw(deps.describe(arrival))
    } catch {
      // Nothing to report to and nothing to retry with. The next one still
      // has to be attempted, which is the whole reason this is caught.
    }
  }
  return { drew: 'read', count: arrivals.length }
}

function reasonOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
