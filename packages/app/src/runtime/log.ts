/**
 * The one place this application writes to the console.
 *
 * Committed code does not call `console` directly, so that what the product
 * emits stays one grep away and can be given a real destination later without
 * touching call sites.
 */
export type LogLevel = 'info' | 'warn' | 'error'

export interface LogFields {
  readonly [key: string]: unknown
}

export function logEvent(
  level: LogLevel,
  event: string,
  fields: LogFields,
): void {
  const line = event + ' ' + JSON.stringify(fields)
  // eslint-disable-next-line no-console
  if (level === 'error') {
    console.error(line)
  } else if (level === 'warn') {
    console.warn(line)
  } else {
    console.log(line)
  }
}
