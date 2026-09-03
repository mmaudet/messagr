/**
 * Which JavaScript engine is actually running, read from the marker the
 * engine installs rather than from build configuration.
 *
 * The same reasoning `newArchitecture.ts` states for the New Architecture
 * applies here, and this ticket is the reason it matters: the release build
 * could not find `hermesc` at all, and the tempting way out was to set
 * `hermesEnabled=false`, which silently swaps the engine for JSC. That is a
 * product decision about startup time and memory, not a build fix. A
 * `gradle.properties` line saying `hermesEnabled=true` cannot tell anyone
 * which engine a given APK ended up with; this can.
 */
export interface HermesReport {
  /** Hermes is the engine executing this bundle. */
  readonly present: boolean
  /**
   * The release version Hermes names for itself, when it names one.
   *
   * `null` rather than absent so the report has one shape: reading a missing
   * version off a screen or a log line should not require knowing whether the
   * field was omitted or empty.
   */
  readonly version: string | null
}

interface HermesMarker {
  readonly HermesInternal?: {
    getRuntimeProperties?: () => Record<string, unknown>
  } | null
}

const RELEASE_VERSION_KEY = 'OSS Release Version'

export function computeHermesReport(scope: object = globalThis): HermesReport {
  const hermes = (scope as HermesMarker).HermesInternal

  if (hermes == null) {
    return { present: false, version: null }
  }

  return { present: true, version: readVersion(hermes) }
}

function readVersion(hermes: {
  getRuntimeProperties?: () => Record<string, unknown>
}): string | null {
  if (typeof hermes.getRuntimeProperties !== 'function') {
    return null
  }

  // `getRuntimeProperties` is Hermes' own internal surface, not a contract it
  // publishes to applications, so it is called defensively: the marker is
  // what answers this module's question, and the version is corroboration
  // that must not be able to turn a working probe into a crash.
  try {
    const version = hermes.getRuntimeProperties()[RELEASE_VERSION_KEY]
    return typeof version === 'string' ? version : null
  } catch {
    return null
  }
}
