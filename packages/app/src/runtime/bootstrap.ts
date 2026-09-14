import { logger } from 'matrix-js-sdk/lib/logger'

import { keepTheSdkToWarnings } from './log'
import { ensureRuntimeGapsClosed, REACT_NATIVE_PROVIDERS } from './polyfills'

/**
 * Runs before anything that needs a patched runtime.
 *
 * Imported for its side effect by `index.js`, ahead of the application
 * itself, because matrix-js-sdk reaches for `crypto.getRandomValues` inside
 * `createClient` and would fail on a runtime that had not been patched yet.
 */
export const polyfillReport = ensureRuntimeGapsClosed(
  globalThis,
  REACT_NATIVE_PROVIDERS,
)

// AHEAD OF THE LIBRARY FOR ITS LOGGER TOO. A logger matrix-js-sdk makes takes
// its parent's factory when it is made, and the library makes one while its
// modules load: kept to warnings any later, that one would still write every
// line in a store build. See `keepTheSdkToWarnings`.
keepTheSdkToWarnings(logger)
