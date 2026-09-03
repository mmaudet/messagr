import { computeCapabilityReport, type CapabilityReport } from './capabilities'

/**
 * Closes the runtime gaps matrix-js-sdk needs closed, and only those.
 *
 * The set was measured rather than assumed. On React Native 0.87.1, iOS and
 * Android alike report exactly two failures: `crypto.getRandomValues`, which
 * is absent, and `TextDecoder`, which is absent. `Promise.withResolvers`,
 * `TextEncoder`, `URL` and `URLSearchParams` all pass a behavioural check,
 * including the query-parsing case where React Native's `URL` shim was
 * expected to give way. Nothing is polyfilled for them, because replacing a
 * working implementation adds a risk without closing a gap.
 *
 * Providers install through `require` rather than a top-level import so that
 * a capability the runtime already supplies is never overwritten: a
 * side-effecting import would patch the global before anything could ask
 * whether it needed patching.
 */
export interface CapabilityProvider {
  /** The `CapabilityReport` key this provider closes. */
  readonly name: keyof Omit<CapabilityReport, 'missing'>
  readonly install: (scope: object) => void
}

export interface PolyfillReport {
  /** Capabilities that were missing, and now work. */
  readonly installed: readonly string[]
  /** Capabilities the runtime already supplied. */
  readonly alreadyPresent: readonly string[]
  /** Capabilities that still fail. Anything here is a defect, not a state. */
  readonly stillMissing: readonly string[]
}

export function installMissingCapabilities(
  scope: object,
  providers: readonly CapabilityProvider[],
): PolyfillReport {
  const before = computeCapabilityReport(scope)
  const alreadyPresent = Object.entries(before)
    .filter(([name, ok]) => name !== 'missing' && ok === true)
    .map(([name]) => name)

  for (const provider of providers) {
    if (!before.missing.includes(provider.name)) {
      continue
    }
    try {
      provider.install(scope)
    } catch {
      // Left for the report below: a provider that could not run leaves its
      // capability missing, which is what the caller has to know.
    }
  }

  const after = computeCapabilityReport(scope)
  const installed = before.missing.filter(name => !after.missing.includes(name))

  return { installed, alreadyPresent, stillMissing: after.missing }
}

/** The providers for the two gaps React Native 0.87.1 actually leaves open. */
export const REACT_NATIVE_PROVIDERS: readonly CapabilityProvider[] = [
  {
    // Patches globalThis.crypto on load. matrix-js-sdk reaches for it inside
    // createClient, before any request is made, so without this the client
    // cannot be constructed at all.
    name: 'getRandomValues',
    install: () => {
      require('react-native-get-random-values')
    },
  },
  {
    // Only the decoder is taken. The package also exports a TextEncoder, and
    // assigning it would replace one that already passes its check.
    name: 'textDecoder',
    install: scope => {
      const { TextDecoder } = require('text-encoding-polyfill')
      ;(scope as { TextDecoder?: unknown }).TextDecoder = TextDecoder
    },
  },
]
