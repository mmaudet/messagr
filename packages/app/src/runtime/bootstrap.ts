import { installMissingCapabilities, REACT_NATIVE_PROVIDERS } from './polyfills'

/**
 * Runs before anything that needs a patched runtime.
 *
 * Imported for its side effect by `index.js`, ahead of the application
 * itself, because matrix-js-sdk reaches for `crypto.getRandomValues` inside
 * `createClient` and would fail on a runtime that had not been patched yet.
 */
export const polyfillReport = installMissingCapabilities(
  globalThis,
  REACT_NATIVE_PROVIDERS,
)
