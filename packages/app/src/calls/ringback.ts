import { DEFAULT_INVITE_LIFETIME_MS, type CallState } from './machine'
import { TICK_PERIOD_MS } from './transport'

/**
 * When the caller's own tone sounds, and -- the part that was missing --
 * when it has to stop.
 *
 * # A TONE THAT NOTHING BOUNDED (#294)
 *
 * The tone starts with the audio session and stops on a transition: the
 * machine expires the invitation, the state leaves `outgoingInvite`, and
 * `callPump.ts` stops the tone on the way past. Every link in that chain
 * but the last is a JavaScript timer -- the machine learns its own deadline
 * from a ticker running once a second -- and a timer is suspended along with
 * the application that owns it.
 *
 * The tone is not. It is a `MediaPlayer` on the far side of a native module,
 * and it goes on looping through a suspension that has frozen everything
 * able to stop it. So a caller who puts the application away while it rings
 * can hear his telephone ring for as long as he leaves it there, minutes
 * after the far end stopped being allowed to answer.
 *
 * # TWO RULES, AND NEITHER OF THEM COUNTS TICKS
 *
 * **The deadline is an instant, read from the clock.** Taken when the
 * invitation leaves, and compared against `now()` at every single thing
 * reported here. A suspension that swallowed ninety ticks costs nothing:
 * the first report after it finds the deadline behind us, whether or not the
 * machine has noticed.
 *
 * **The tone is given up when the application leaves the front.** This is
 * the half that works while nothing at all is running, and it is the only
 * one that can: leaving the front is the last moment the application is able
 * to act, so the tone is stopped there rather than left sounding behind a
 * frozen timer. It is taken again on the way back, if the invitation is
 * still alive -- so a caller who glances at something else and returns hears
 * what he heard before.
 *
 * A note on what "in front" is not. The screen going dark against a cheek is
 * the proximity sensor, not the application leaving: `react-native-incall-
 * manager` takes a `PROXIMITY_SCREEN_OFF_WAKE_LOCK` and the activity stays
 * resumed under it. The tone exists for exactly that person -- their screen
 * is off and the tone is the only report of the call that reaches them --
 * and this rule is written not to touch them.
 *
 * # Pure, like every other module under `src/calls/`
 *
 * The telephone is three ports. `runtime/callAudio.ts` binds them to the
 * platform, and the deciding happens here, where a ninety-second lifetime
 * can be exercised in under a millisecond.
 */

/**
 * How long the tone may sound after the invitation goes out.
 *
 * The invitation's own lifetime less one tick, which is what
 * `transport.ts` gives the machine to wait for: the far end counts the
 * lifetime from when it received the invite, so the caller stops a period
 * early rather than a period late. Computed from the two rather than
 * written again, because a tone outliving the call it reports is the whole
 * of this file.
 */
export const RINGBACK_LIFETIME_MS = DEFAULT_INVITE_LIFETIME_MS - TICK_PERIOD_MS

/** The telephone, as a tone needs it. */
export interface RingbackPorts {
  /**
   * The clock, read at every decision rather than counted between them.
   * Nothing here holds a timer of its own: that is the failure being fixed.
   */
  readonly now: () => number
  /** Sound the tone again, after it was given up. */
  readonly play: () => void
  /** Stop it. */
  readonly silence: () => void
}

export interface Ringback {
  /**
   * A call this device is placing has taken the audio session, and the tone
   * is sounding with it.
   *
   * Told rather than asked for: the platform starts the two together -- one
   * call into the native module, which is what puts the tone in the call's
   * own audio mode rather than beside it.
   */
  readonly began: () => void
  /** The call's state, as the machine reports it. */
  readonly state: (state: CallState) => void
  /** Whether the application is in front, told every time that changes. */
  readonly foreground: (inFront: boolean) => void
  /** The audio session has been given back, and the tone went with it. */
  readonly over: () => void
}

export function startRingback(ports: RingbackPorts, active: boolean): Ringback {
  let inFront = active
  /** Whether this device is the one waiting on an answer. */
  let waiting = false
  /**
   * When the tone may sound until, or `null` while the invitation has not
   * left yet.
   *
   * `null` rather than a deadline guessed at `began`: between taking the
   * audio session and the invitation leaving there is a relay to ask for, a
   * microphone to open, and on a first call a dialog somebody has to answer.
   * A deadline counted from the earlier of the two would cut the tone short
   * of the call it reports.
   */
  let untilMs: number | null = null
  /** Whether the tone is sounding now, so that nothing is asked for twice. */
  let sounding = false

  /** Sounds or silences the tone, if that is not what it is already doing. */
  function apply(): void {
    const alive =
      waiting && inFront && (untilMs === null || ports.now() <= untilMs)
    if (alive === sounding) return
    if (!alive) {
      sounding = false
      ports.silence()
      return
    }
    // TAKEN BACK ONLY FOR AN INVITATION THAT LEFT. `waiting` is true from the
    // audio session onwards, and between the session and the invitation
    // there is a relay to ask for and a microphone to open -- either of
    // which refuses, leaving a tone sounding on a call that will never ring.
    // Stopping it there is right; starting it again when somebody comes back
    // to that screen is not. The tone returns when the invitation reports
    // itself gone, which is the moment `untilMs` exists.
    if (untilMs === null) return
    sounding = true
    ports.play()
  }

  return {
    began: () => {
      waiting = true
      untilMs = null
      // The platform started it with the session, so this is a fact rather
      // than a request -- and `apply` gives it up at once when the
      // application was not in front to begin with.
      sounding = true
      apply()
    },

    state: next => {
      if (next.call === 'outgoingInvite') {
        // The first report is the invitation leaving, which is the instant
        // the far end starts counting from. Later reports of the same state
        // must not move it, or a call that ticks its state once a second
        // would push its own deadline ahead of itself for ever.
        if (untilMs === null) untilMs = ports.now() + RINGBACK_LIFETIME_MS
      } else {
        // Picked up, refused, ended: whatever it is, it is not somebody
        // waiting on an answer any more. A tone still playing under
        // somebody's voice is the loudest possible way of saying the
        // application has lost track of its own call.
        waiting = false
        untilMs = null
      }
      apply()
    },

    foreground: now => {
      inFront = now
      apply()
    },

    over: () => {
      waiting = false
      untilMs = null
      // Nothing is silenced here: giving the audio session back took the
      // tone with it, and asking the platform to stop something it has
      // already stopped is how a teardown grows an order it has to keep.
      sounding = false
    },
  }
}
