import type { Logger } from 'matrix-js-sdk/lib/logger'

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
 * woke, what became of the pusher, whether the backup was offered and where
 * accepting it stopped, and it names nobody. The whole log is for a build
 * somebody is going to read on a cable, and `writesTheWholeLog` says how a
 * bundle declares that.
 *
 * On Android either one lands in logcat under `ReactNativeJS`. On iOS it
 * lands in the unified log under `com.facebook.react.log`, where React Native
 * writes `info` and `warn` as info messages (`RCTLog.mm`): Console.app shows
 * them only once asked to include info messages.
 *
 * # Except matrix-js-sdk, which writes around it
 *
 * The library logs through a logger of its own, straight to the console. A
 * store build keeps that one to warnings and errors, and takes out of those
 * every word that could name a room, an account or an event:
 * `keepTheSdkToWarnings` says what it wrote before, why it is set before the
 * library loads, and how a line of the library's is read.
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
  // Where accepting the backup stopped, and from which screen, or `replace`
  // for a replacement of the key (#284), and whether a commitment the next
  // launch would turn on could not be forgotten. Never its cause: an error
  // message can carry an account or an address.
  [
    'MESSAGR_BACKUP_ACCEPT_FAILED',
    { from: 'words', failedAt: 'words', forgotten: 'flag' },
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

/** What a store build makes nothing of, in matrix-js-sdk's logger. */
const BELOW_WARNINGS: ReadonlySet<string> = new Set(['trace', 'debug', 'info'])

/** What stands in a line of the library's for a word withheld from it. */
const WITHHELD = '[withheld]'

/**
 * One word of a line the library wrote: what runs up to the next space, or
 * bracket, or quote.
 *
 * None of those separators can be inside a Matrix identifier, and each stays
 * where it is, so a line keeps its shape: `(roomId=...)` reads back as
 * `([withheld])`, and the name a logger prepends still reads as a name.
 */
const WORD = /[^\s[\](){}<>"]+/g

/** A word can end on these without any of it being an identifier's. */
const ENDS_ON = /[.,:;!?]+$/

/** Printable ASCII. Nothing outside it is a word of a line in English. */
const PRINTABLE = /^[!-~]+$/

/** What makes a word more than punctuation. */
const LETTER_OR_DIGIT = /[A-Za-z0-9]/

/** A count, or a status. */
const COUNT = /^[0-9]+$/

/** A directive `console` fills in from one of the arguments after it. */
const DIRECTIVE = /^%[sdifjoOc%]$/

/**
 * Whether a word of a line the library wrote can leave in a store build.
 *
 * `WORDS` decides, for the reason it was written: what it refuses is
 * everything an identifier is made of. Three things pass beside it, and none
 * of them can carry one:
 *
 *   - punctuation alone, so `-->` and a stray `:` stay legible;
 *   - a run of digits, which is a count or a status -- the kind `TRACE` calls
 *     a `count`. An identifier is never one: it carries a sigil or a colon,
 *     and that character is inside this same word;
 *   - a `console` directive, which says nothing of itself and is filled in
 *     from an argument this same test has already read.
 *
 * Trailing punctuation comes off first, because a sentence ends on it and no
 * identifier does. Everything else is withheld, which costs `URGENT`, `ID`
 * and every algorithm name: the price `WORDS` already names.
 */
function saysNobody(word: string): boolean {
  if (PRINTABLE.test(word) && !LETTER_OR_DIGIT.test(word)) return true
  const core = word.replace(ENDS_ON, '')
  return DIRECTIVE.test(core) || COUNT.test(core) || WORDS.test(core)
}

/** A line of the library's, with every word that could name somebody gone. */
function withoutIdentifiers(line: string): string {
  return line.replace(WORD, word => (saysNobody(word) ? word : WITHHELD))
}

/**
 * What an argument the library handed its logger says, as a line to read.
 *
 * An `Error` says its name and its message, which is where a request that
 * failed names what it asked for. Its stack says a bundle's own line numbers
 * and not why anything failed, so it is not worth the room it takes in a
 * buffer of 256 KiB.
 */
function asALine(value: unknown): string {
  if (typeof value === 'string') return value
  if (
    value !== null &&
    typeof value === 'object' &&
    !(value instanceof Error)
  ) {
    return render(value as LogFields)
  }
  try {
    return String(value)
  } catch {
    // A `toString` that throws. The rule the whole module is about holds
    // here too: a log must not be able to take down what it is logging.
    return WITHHELD
  }
}

/**
 * The library's own logger, under a name read like everything else.
 *
 * The name is in none of the messages: the method the library's factory makes
 * puts it there itself, out of `this` (`logger.js`). And it is a room often
 * enough to matter -- `rust-crypto.js` names each room's encryptor after its
 * room, so that name is on every line that encryptor ever writes. The call is
 * made on a logger whose `prefix` has been read, rather than on the logger.
 */
function underAReadName(logger: unknown): unknown {
  const named = logger as { prefix?: unknown } | null | undefined
  if (typeof named?.prefix !== 'string') return logger
  const read = Object.create(named) as { prefix: string }
  read.prefix = withoutIdentifiers(named.prefix)
  return read
}

/**
 * Keeps matrix-js-sdk's own logger to warnings and errors in a store build.
 *
 * # What it wrote
 *
 * The library does not log through this module. It has a logger of its own
 * that writes straight to the console, and a client made without one is handed
 * it, with every request that client makes (`client.js`). On the Play build
 * 135, 14 September 2026, a line went out for each request and another for its
 * answer, beside the trace and not through it:
 * `FetchHttpApi: --> GET https://messagr.eu/_matrix/client/v3/sync?timeout=xxx`.
 *
 * # How, and why before the library loads
 *
 * That logger is a `loglevel` logger, which its type does not say: each of its
 * methods is made by its `methodFactory` whenever it is rebuilt. So a store
 * build hands it a factory that makes nothing below a warning, and rebuilds it.
 * A child takes its parent's factory at the moment it is made and never
 * afterwards (`getChild`, in the library's `logger.js`), and the library makes
 * one while its modules load (`models/room-sticky-events.js`). That is why
 * `bootstrap.ts` calls this, ahead of everything `index.js` loads after it.
 *
 * # Warnings and errors still go out, word by word
 *
 * They are the lines that say why the library failed, so a store build keeps
 * them. It does not keep whom they name (#319): twenty-seven lines of
 * matrix-js-sdk 42.3.0 warn or error with a room in them -- among them
 * `Room ${room.roomId}: ignoring crypto event with invalid algorithm ...`
 * (`rust-crypto.js`) -- and the page this application publishes says the lines
 * it leaves on a telephone carry no identifier at all.
 *
 * So every word of them is read before it goes out, by the test `TRACE`
 * applies to a field: a word that could be a room, an account, an event, a
 * device, a token or an address is replaced by `[withheld]`, and what is left
 * is the part that says what went wrong. The name the logger prepends is read
 * the same way, and so is each argument the library hands over, an error
 * among them.
 *
 * A line is read rather than dropped because dropping it would leave a
 * failure with nothing said about it at all, and rewritten here rather than
 * asked of the library, which has no such setting.
 *
 * A debug bundle and a bundle built to be read keep every line whole, as
 * `writesTheWholeLog` says.
 */
export function keepTheSdkToWarnings(sdk: Logger): void {
  if (writesTheWholeLog()) return
  // A `loglevel` logger, whatever its declared type says. See above.
  const made = sdk as unknown as {
    methodFactory: (
      method: string,
      level: number,
      name: string | symbol | undefined,
    ) => (...message: unknown[]) => void
    rebuild: () => void
  }
  const make = made.methodFactory
  made.methodFactory = (method, level, name) => {
    if (BELOW_WARNINGS.has(method)) return () => undefined
    const write = make(method, level, name)
    // Not an arrow: the method the library's factory makes reads the
    // logger's name off `this`, and `underAReadName` is what it reads.
    return function (this: unknown, ...message: unknown[]): void {
      write.apply(
        underAReadName(this),
        message.map(value => withoutIdentifiers(asALine(value))),
      )
    }
  }
  made.rebuild()
}

/**
 * An event written when what it says changes, rather than each time it is
 * said.
 *
 * #291. `MESSAGR_BACKUP_OFFER` is decided each time a conversation draws, and
 * a conversation draws again on every sync cycle that touches it. On build
 * 135, during a call, that was the same line ten times in seventeen seconds,
 * and a telephone's log buffer holds 256 KiB: a line repeated pushes out the
 * ones that would have explained something.
 *
 * Compared on what the caller hands over, serialised by `render`, which does
 * not throw.
 *
 * `forget` has the next line written whatever it says. The caller says when,
 * because only the caller knows what a new occasion to read the event is: for
 * the backup offer, a conversation being opened.
 */
export function logWhenChanged(event: string): {
  readonly log: (level: LogLevel, fields: LogFields) => void
  readonly forget: () => void
} {
  let last: string | null = null
  return {
    log: (level, fields) => {
      const said = render(fields)
      if (said === last) return
      last = said
      logEvent(level, event, fields)
    },
    forget: () => {
      last = null
    },
  }
}
