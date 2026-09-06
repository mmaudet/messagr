import { execFileSync } from 'node:child_process'

import { device } from 'detox'

/**
 * What the application says about itself, read from its own log.
 *
 * # Why not from the screen
 *
 * It used to be. Every probe was rendered into a scrolling readout and the
 * suite asserted on the words — which meant every assertion was really an
 * assertion about scroll position, and `readout.ts` carries the four
 * continuous-integration failures that cost: a block inserted rather than
 * appended, a focusable button pulling the readout down to reach it, and a
 * label rendered exactly right and merely not 75 per cent visible. All three
 * were correct behaviour reported as product failures.
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
  readonly pump: unknown
  readonly send: unknown
  readonly received: { readonly received: boolean; readonly reason?: string }
  readonly history: { readonly claimed: string }
}

/** Empties the device's log, so a relaunch cannot read the run before it. */
export function forgetTheLog(): void {
  execFileSync('adb', ['-s', device.id, 'logcat', '-c'])
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
    const dumped = execFileSync('adb', ['-s', device.id, 'logcat', '-d'], {
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
