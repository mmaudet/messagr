import { execFileSync } from 'node:child_process'

import { device } from 'detox'

/**
 * What the application says about itself, read from its own log.
 *
 * # Why not from the screen
 *
 * It used to be. Every probe was rendered into a scrolling readout and the
 * suite asserted on the words — which meant every assertion was really an
 * assertion about scroll position. Four continuous-integration failures were
 * paid for that -- a block inserted rather than appended, a focusable button
 * pulling the readout down to reach it, a label rendered exactly right and
 * merely not 75 per cent visible -- and every one of them was correct
 * behaviour reported as a product failure.
 *
 * The readout is gone with #105 — it was the application before there were
 * screens, and a person installing Messagr should never have seen it. What
 * survives is the thing that actually found the defects: `MESSAGR_RUNTIME`,
 * one line of structured JSON carrying every probe. Reading that is not a
 * workaround for the screen's removal; it is what the suite should have read
 * all along. It cannot be scrolled off, it cannot be truncated by a layout,
 * and it says the same thing whatever the product's screens become.
 *
 * # It reads the device's log, not a file
 *
 * `adb logcat -d` against the device Detox is driving. The serial matters:
 * a developer with a phone plugged in and two emulators running would
 * otherwise read whichever one adb picked.
 */

export interface RuntimeReport {
  readonly architecture: {
    readonly enabled: boolean
    readonly bridgeless: boolean
    readonly turboModules: boolean
    readonly fabric: boolean
  }
  readonly hermes: { readonly present: boolean; readonly version?: string }
  readonly bridge: { readonly loaded: boolean; readonly coreVersion?: string }
  readonly gaps: { readonly missing: readonly string[] }
  readonly client: { readonly created: boolean; readonly homeserver?: string }
  readonly entry: { readonly entered: boolean; readonly claimed: boolean }
  readonly session:
    | 'not-configured'
    | {
        readonly synced: boolean
        readonly roomCount?: number
        readonly durationMs?: number
      }
  /**
   * Typed only as far as the suite asserts, on purpose.
   *
   * The application's own types are the truth about these; restating them
   * here in full would be a second declaration to keep in step, and the day
   * it drifted the suite would be asserting about a shape nothing produces.
   * What is named below is what a test reads.
   */
  readonly pump:
    | 'not-configured'
    | {
        readonly outcome: 'not-started' | 'sync-required'
        readonly reason: string
      }
    | {
        readonly outcome: 'ran'
        readonly report: {
          readonly deviceKeysVerified: boolean
          readonly oneTimeKeysOnServer: number | null
          readonly sharingStrategy: string
          readonly identity: {
            readonly established: boolean
            readonly how?: string
            readonly reason?: string
          }
        }
      }
  readonly send:
    | 'not-run'
    | {
        readonly sent: boolean
        readonly reason?: string
        readonly intactDecrypted?: boolean
        readonly tamper?: 'refused' | 'accepted' | 'not-attempted'
      }
  readonly received:
    | 'not-run'
    | {
        readonly received: boolean
        readonly reason?: string
        /**
         * Who the event says wrote it.
         *
         * Named `claimed` throughout because that is all it is: decrypting an
         * event proves which key wrote it and nothing about who holds that
         * key. The screen says « Se présente comme » for the same reason.
         */
        /** Which event was read, so a screen can be checked against it. */
        readonly eventId?: string
        readonly claimedSender?: string
        readonly body?: string
      }
  readonly history: { readonly claimed: string }
  /**
   * The store's own continuity.
   *
   * `minted` on a relaunch means the passphrase did not survive, so this
   * device opened a new and empty store and lost every room key the old one
   * held. Nothing else anywhere would say so -- which is why it is in the
   * report rather than left behind with the readout that used to carry it.
   */
  readonly passphrase: 'minted' | 'reused' | null
  readonly signUp: 'unfinished' | 'complete' | null
  readonly keystoreForm: unknown
}

/** What a `NotchedButton` measured, once one has laid out. */
export interface GeometryReport {
  readonly height: number
  readonly leg: number
  readonly touchTargetMet: boolean
  readonly floor: number
}

/**
 * The device Detox is driving, named rather than assumed.
 *
 * The serial matters: a developer with a phone plugged in and two emulators
 * running would otherwise read whichever one adb picked. And when it is
 * missing, `adb -s undefined` fails with a message about a device that does
 * not exist, which is a long way from what actually went wrong.
 */
function driving(): string {
  const id: unknown = device.id
  if (typeof id !== 'string' || id === '') {
    throw new Error(
      'Detox has not allocated a device yet, so there is no log to read. ' +
        'Every call here belongs inside a hook or a test, after the runner ' +
        'has a device.',
    )
  }
  return id
}

/** Empties the device's log, so a relaunch cannot read the run before it. */
export function forgetTheLog(): void {
  execFileSync('adb', ['-s', driving(), 'logcat', '-c'])
}

/**
 * Waits for the launch to report, and hands back what it said.
 *
 * Polls rather than tails: a single `logcat -d` is a snapshot, and the line
 * arrives whenever the launch effect finishes — which includes a network
 * round trip, so it is seconds rather than milliseconds.
 */
export async function whatItReported(
  timeoutMs = 90000,
): Promise<RuntimeReport> {
  const until = Date.now() + timeoutMs
  let lastError = 'nothing was read'
  while (Date.now() < until) {
    const dumped = execFileSync('adb', ['-s', driving(), 'logcat', '-d'], {
      maxBuffer: 64 * 1024 * 1024,
    }).toString()
    // The last one, not the first: a relaunch inside one test file logs
    // again, and the newest is the one being asserted about.
    const lines = dumped
      .split('\n')
      .filter(line => line.includes('MESSAGR_RUNTIME'))
    const line = lines.at(-1)
    if (line !== undefined) {
      const at = line.indexOf('MESSAGR_RUNTIME')
      const json = line.slice(at + 'MESSAGR_RUNTIME'.length).trim()
      try {
        return JSON.parse(json) as RuntimeReport
      } catch (cause: unknown) {
        // A line split across two logcat records. Worth retrying rather than
        // failing: the next dump has it whole.
        lastError = `MESSAGR_RUNTIME was not parseable: ${String(cause)}`
      }
    }
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  throw new Error(`the application never reported (${lastError})`)
}

/** The session, narrowed. `not-configured` is a launch with no account. */
export function syncedSession(report: RuntimeReport): {
  readonly synced: boolean
  readonly roomCount?: number
  readonly durationMs?: number
} {
  if (report.session === 'not-configured') {
    throw new Error('the launch had no session to sync')
  }
  return report.session
}

/**
 * One structured line, whichever it is.
 *
 * `MESSAGR_RUNTIME` is not the only thing worth reading: the geometry is
 * measured when a button lays out, and the sync loop reports as it changes
 * state. Both arrive after the launch report and neither can be folded into
 * it -- a launch report written before any layout would say the geometry was
 * null every time.
 */
async function lastLineOf<T>(
  tag: string,
  accept: (value: T) => boolean,
  timeoutMs: number,
): Promise<T> {
  const until = Date.now() + timeoutMs
  let lastError = `no ${tag} line was read`
  while (Date.now() < until) {
    const dumped = execFileSync('adb', ['-s', driving(), 'logcat', '-d'], {
      maxBuffer: 64 * 1024 * 1024,
    }).toString()
    // Newest first: a state that changes reports more than once, and the
    // question is always about where it got to rather than where it began.
    const lines = dumped.split('\n').filter(line => line.includes(tag))
    for (const line of lines.reverse()) {
      const at = line.indexOf(tag)
      try {
        const value = JSON.parse(line.slice(at + tag.length).trim()) as T
        if (accept(value)) return value
        lastError = `${tag} was read but not yet what was asked for`
      } catch {
        // Split across two logcat records. The next dump has it whole.
        lastError = `${tag} was not parseable`
      }
    }
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  throw new Error(`${tag}: ${lastError}`)
}

/**
 * The shape a button actually laid out at.
 *
 * The notch is a clip path in the prototype and React Native has none, so it
 * is drawn -- and a unit test can check the path against the polygon (it
 * does) but not that a real layout gave it a real height to follow. This is
 * measured on the promise screen's own action, which is a button somebody
 * presses rather than one rendered for a test to look at.
 */
export function whatItMeasured(timeoutMs = 60000): Promise<GeometryReport> {
  return lastLineOf<GeometryReport>('MESSAGR_GEOMETRY', () => true, timeoutMs)
}

/**
 * The live sync loop, once it is past `starting`.
 *
 * On `running` and not merely on a line existing: `starting` is what the loop
 * says before the homeserver has answered even once, so a loop that never got
 * an answer would satisfy the weaker question while receiving nothing --
 * which is the failure worth catching.
 */
export function whatTheLoopReported(
  timeoutMs = 60000,
): Promise<{ readonly state: string }> {
  return lastLineOf<{ readonly state: string }>(
    'MESSAGR_LIVE_STATE',
    value => value.state === 'running',
    timeoutMs,
  )
}
