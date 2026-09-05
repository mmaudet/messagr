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
 */
export type LogLevel = 'info' | 'warn' | 'error'

export interface LogFields {
  readonly [key: string]: unknown
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
  const line = event + ' ' + render(fields)
  if (level === 'error') {
    console.error(line)
  } else if (level === 'warn') {
    console.warn(line)
  } else {
    console.log(line)
  }
}
