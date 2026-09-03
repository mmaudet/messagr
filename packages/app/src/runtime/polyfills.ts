import { getErrorMessage } from './errors'
import { computeRuntimeGapReport, type RuntimeGapName } from './runtimeGaps'

/**
 * Closes the gaps matrix-js-sdk needs closed, and only those.
 *
 * The set was measured rather than assumed. On React Native 0.87.1, an iOS
 * simulator, an Android emulator and an Android phone all report exactly two
 * failures: `crypto.getRandomValues`, which matrix-js-sdk reaches for inside
 * `createClient`, and `TextDecoder`, which it uses to read the UTF-8 bodies
 * of the responses it parses. `Promise.withResolvers`, `TextEncoder`, `URL`
 * and `URLSearchParams` all pass a behavioural check, including the
 * query-parsing case where React Native's `URL` shim was expected to give
 * way. Nothing is installed for those, because replacing a working
 * implementation adds a risk without closing a gap.
 *
 * Providers install through `require` rather than a top-level import so that
 * a facility the runtime already supplies is never overwritten: a
 * side-effecting import patches the global before anything can ask whether it
 * needed patching.
 */
export type InstallOutcome =
  { readonly ok: true } | { readonly ok: false; readonly reason: string }

export interface GapProvider {
  readonly name: RuntimeGapName
  readonly install: (globals: object) => InstallOutcome
}

export interface PolyfillReport {
  /** Gaps that were open, and are now closed. */
  readonly installed: readonly RuntimeGapName[]
  /** Facilities the runtime already supplied. */
  readonly alreadyPresent: readonly RuntimeGapName[]
  /** Gaps that remain, with why. Anything here is a defect, not a state. */
  readonly stillMissing: readonly {
    readonly name: RuntimeGapName
    readonly reason: string
  }[]
}

export function ensureRuntimeGapsClosed(
  globals: object,
  providers: readonly GapProvider[],
): PolyfillReport {
  const before = computeRuntimeGapReport(globals)
  const failures = new Map<RuntimeGapName, string>()

  for (const provider of providers) {
    if (!before.missing.includes(provider.name)) {
      continue
    }
    const outcome = provider.install(globals)
    if (!outcome.ok) {
      failures.set(provider.name, outcome.reason)
    }
  }

  const after = computeRuntimeGapReport(globals)

  return {
    installed: before.missing.filter(name => !after.missing.includes(name)),
    alreadyPresent: (Object.keys(before.working) as RuntimeGapName[]).filter(
      name => before.working[name],
    ),
    stillMissing: after.missing.map(name => ({
      name,
      reason: failures.get(name) ?? 'no provider closes this gap',
    })),
  }
}

function guarded(
  install: (globals: object) => void,
): (globals: object) => InstallOutcome {
  return globals => {
    try {
      install(globals)
      return { ok: true }
    } catch (cause: unknown) {
      return { ok: false, reason: getErrorMessage(cause) }
    }
  }
}

/** The providers for the two gaps React Native 0.87.1 actually leaves open. */
export const REACT_NATIVE_PROVIDERS: readonly GapProvider[] = [
  {
    // Patches globalThis.crypto on load. matrix-js-sdk reaches for it inside
    // createClient, before any request is made, so without this the client
    // cannot be constructed at all.
    name: 'getRandomValues',
    install: guarded(() => {
      require('react-native-get-random-values')
    }),
  },
  {
    // Only the decoder is taken. The package also exports a TextEncoder, and
    // assigning it would replace one that already passes its check.
    name: 'textDecoder',
    install: guarded(globals => {
      const polyfill = require('text-encoding-polyfill') as {
        TextDecoder: unknown
      }
      ;(globals as { TextDecoder?: unknown }).TextDecoder = polyfill.TextDecoder
    }),
  },
]
