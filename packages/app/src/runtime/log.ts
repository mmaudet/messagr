/**
 * The one place this application writes to the console.
 *
 * Committed code does not call `console` directly, so that what the product
 * emits stays one grep away and can be given a real destination later without
 * touching call sites.
 *
 * # A log must not be able to take down what it is logging
 *
 * This used to be one `JSON.stringify(fields)`. On the first real device run
 * of the vouching gesture, the launch died with
 * `TypeError: cyclical structure in JSON object` -- thrown by that stringify,
 * inside the effect that drives the whole launch, so the *report* killed the
 * thing it was reporting on. Every screen below it stayed empty, and the only
 * evidence of what had actually happened was the exception from the line
 * whose job was to say so.
 *
 * A field that cannot be serialised is now dropped and named. The rest of the
 * event still goes out, and the log says which field it lost, which is both
 * more useful than the crash and more useful than silence.
 *
 * That a value reached here unserialisable is still a defect at its own call
 * site. This makes it a defect that reports itself instead of one that
 * presents as a blank screen.
 *
 * # A store build writes the trace, and nothing else
 *
 * Nothing here used to tell a release bundle from a debug one. A build
 * installed from a store track wrote every event whole -- a call's identifier
 * and its session description among them -- to a log that adb, a bug report
 * and any application holding READ_LOGS can read, which is the same reason
 * the launch report carries no credential.
 *
 * So a store build writes the trace (#285): the events `TRACE` lists, with
 * only the fields it names, each of which must read as a flag, a count or
 * words. What is left says how a call moved and ended, what a notification
 * woke, what became of the pusher and whether the backup was offered, and it
 * names nobody. The whole log is for a build somebody is going to read on a
 * cable, and `writesTheWholeLog` says how a bundle declares that.
 *
 * On Android either one lands in logcat under `ReactNativeJS`. On iOS it
 * lands in the unified log under `com.facebook.react.log`, where React Native
 * writes `info` and `warn` as info messages (`RCTLog.mm`): Console.app shows
 * them only once asked to include info messages.
 */
export type LogLevel = 'info' | 'warn' | 'error'

export interface LogFields {
  readonly [key: string]: unknown
}

type Kind = 'flag' | 'count' | 'words'

interface Shape {
  readonly [field: string]: Kind | Shape
}

/**
 * Words: a state named by one of this code's unions, or a reason it wrote.
 * Letters, joined inside a word by a capital or an underscore (`inCall`,
 * `user_hangup`) and between words by a space or a comma.
 *
 * Everything an identifier is made of is refused: a digit, a sigil, a colon,
 * a dot, a slash, two capitals in a row. That keeps out an account, a room,
 * an event, a device, a token and an address, which is the point. It also
 * withholds an error message that carries any of them, which is the price.
 */
const WORDS =
  /^[A-Za-z][a-z']*(?:[A-Z_][a-z']+)*(?:(?:, ?| )[A-Za-z][a-z']*(?:[A-Z_][a-z']+)*)*$/

function passes(kind: Kind, value: unknown): boolean {
  if (kind === 'flag') return typeof value === 'boolean'
  if (kind === 'count') {
    return typeof value === 'number' && Number.isFinite(value)
  }
  return typeof value === 'string' && WORDS.test(value)
}

/**
 * The trace: the events a store build writes, and what each may carry.
 *
 * These are the lines that tell apart failures nobody can see from outside a
 * telephone. Adding one is deciding what leaves on every installed device, so
 * each field is named with what it must read as, and nothing is let through
 * by default.
 */
const TRACE = new Map<string, Shape>([
  // How a call moved, and how it ended. `callId` and the invite's `offer`
  // are left out: the first names the call, the second carries its session
  // description.
  [
    'MESSAGR_CALL_STATE',
    {
      call: 'words',
      autoAccept: 'flag',
      secondsLeft: 'count',
      reason: { ended: 'words', reason: 'words' },
    },
  ],
  // What a notification woke, and why it could not look.
  ['MESSAGR_WOKE', { drew: 'words', count: 'count', reason: 'words' }],
  ['MESSAGR_WAKE_BLIND', { reason: 'words' }],
  ['MESSAGR_WAKE_UNAVAILABLE', { reason: 'words' }],
  // What became of the pusher.
  ['MESSAGR_PUSH_REGISTERED', {}],
  ['MESSAGR_PUSH_NOT_REGISTERED', { reason: 'words' }],
  ['MESSAGR_PUSH_REMOVED', {}],
  // Whether the backup was offered, and what that decision read.
  [
    'MESSAGR_BACKUP_OFFER',
    {
      offer: 'flag',
      backedUp: 'flag',
      asked: 'flag',
      received: 'flag',
      unreadable: 'words',
    },
  ],
])

/**
 * What of an event leaves in a store build.
 *
 * A field the shape does not name is left out without a word: that is the
 * shape doing its job. A named field whose value reads as anything else is
 * withheld and named, because that is a call site handing the trace what it
 * was not declared to carry, and the line should say so. Each value is read
 * inside its own guard, for the reason `render` gives.
 */
function traced(shape: Shape, fields: LogFields): Record<string, unknown> {
  const kept: Record<string, unknown> = {}
  const withheld: string[] = []
  for (const key of Object.keys(fields)) {
    if (!Object.prototype.hasOwnProperty.call(shape, key)) continue
    const kind = shape[key]
    let value: unknown
    try {
      value = fields[key]
    } catch {
      withheld.push(key)
      continue
    }
    if (typeof kind !== 'string') {
      if (typeof value === 'object' && value !== null) {
        kept[key] = traced(kind, value as LogFields)
      } else {
        withheld.push(key)
      }
    } else if (passes(kind, value)) {
      kept[key] = value
    } else {
      withheld.push(key)
    }
  }
  if (withheld.length > 0) kept._withheld = withheld
  return kept
}

/**
 * Whether this build writes every event whole, rather than the trace.
 *
 * A debug bundle does. So does anything outside a bundle, where there is no
 * `__DEV__` at all: that is where the unit tests run.
 *
 * So does a release bundle built to be read, and only the environment it was
 * built in can say so, inlined by `babel.config.js`. The device bench builds
 * its bundle with `MESSAGR_SEND_PROBE=1` (`.github/workflows/device.yml`) and
 * then reads that log; `scripts/pixel.sh` sets `MESSAGR_WHOLE_LOG=1`. A store
 * build sets neither, and `metro.config.js` keeps both in the transform cache
 * key, so a bundle built for one cannot be handed the other's transforms.
 */
function writesTheWholeLog(): boolean {
  if (typeof __DEV__ === 'undefined' || __DEV__) return true
  return (
    process.env.MESSAGR_SEND_PROBE === '1' ||
    process.env.MESSAGR_WHOLE_LOG === '1'
  )
}

/**
 * Serialises what it can, and names what it cannot.
 *
 * Field by field rather than in one pass: one unserialisable value must cost
 * its own field and not the whole event.
 */
function render(fields: LogFields): string {
  try {
    return JSON.stringify(fields)
  } catch {
    const kept: Record<string, unknown> = {}
    const lost: string[] = []
    // `Object.keys` and not `Object.entries`: reading the values is itself
    // what can throw, and the hostile field here is a getter. Keys are safe
    // to take; each value is then read inside its own guard.
    for (const key of Object.keys(fields)) {
      try {
        const value = fields[key]
        JSON.stringify(value)
        kept[key] = value
      } catch {
        lost.push(key)
      }
    }
    kept._unserialisable = lost
    try {
      return JSON.stringify(kept)
    } catch {
      // Both passes failed, which means the failure is not in any one field:
      // a getter that throws, a proxy, a `toJSON` that does. Say so rather
      // than throw, because throwing is the behaviour this function exists to
      // stop.
      return `{"_unserialisable":"the whole event","_fields":${JSON.stringify(
        lost,
      )}}`
    }
  }
}

export function logEvent(
  level: LogLevel,
  event: string,
  fields: LogFields,
): void {
  let written = fields
  if (!writesTheWholeLog()) {
    const shape = TRACE.get(event)
    if (shape === undefined) return
    written = traced(shape, fields)
  }
  const line = event + ' ' + render(written)
  if (level === 'error') {
    console.error(line)
  } else if (level === 'warn') {
    console.warn(line)
  } else {
    console.log(line)
  }
}
