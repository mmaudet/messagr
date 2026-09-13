const path = require('path')
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config')

/**
 * Yarn hoists this app's dependencies to the workspace root's node_modules,
 * not to this package's own. Metro's default configuration crawls only the
 * project root, so without watchFolders and nodeModulesPaths it fails to
 * resolve packages that are present on disk. This is the documented Metro
 * monorepo configuration.
 *
 * https://reactnative.dev/docs/metro#adding-support-for-monorepos
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, '../..')

// matrix-js-sdk declares @matrix-org/matrix-sdk-crypto-wasm as a hard
// dependency and reaches it only from initRustCrypto, which this application
// never calls: ADR-0001 puts the cryptography in the native bridge and allows
// exactly one implementation in the binary.
//
// Metro resolves it anyway. Left alone, the bundle carries the package's
// JavaScript half, including an `import.meta.url` that Hermes cannot evaluate,
// so the second crypto backend is present as dead weight that can still throw.
// Stubbing it out is what makes the ADR's invariant true of the artifact
// rather than only of the intent.
const CRYPTO_WASM = '@matrix-org/matrix-sdk-crypto-wasm'

// THE FLAGS BABEL INLINES ARE PART OF THE CACHE KEY.
//
// `babel.config.js` bakes two environment variables into the bundle, and a
// transform is cached on its source and its options, not on the environment
// it ran in. So a bundle built after a bench build on the same machine was
// served the bench's transforms: the send probe, measured once, and now the
// whole log, in a release bundle that should carry the trace alone.
// `cacheVersion` is hashed into every transform's key (Metro's
// `Transformer.js`), which makes a flag that changed a transform redone
// rather than a stale one shipped. No `--reset-cache` to remember.
const defaults = getDefaultConfig(projectRoot)
const INLINED = ['MESSAGR_SEND_PROBE', 'MESSAGR_WHOLE_LOG']

const config = {
  cacheVersion: [
    defaults.cacheVersion,
    ...INLINED.map(name => `${name}=${process.env[name] ?? ''}`),
  ].join(' '),
  watchFolders: [workspaceRoot],
  resolver: {
    nodeModulesPaths: [
      path.resolve(projectRoot, 'node_modules'),
      path.resolve(workspaceRoot, 'node_modules'),
    ],
    resolveRequest: (context, moduleName, platform) => {
      if (
        moduleName === CRYPTO_WASM ||
        moduleName.startsWith(`${CRYPTO_WASM}/`)
      ) {
        return { type: 'empty' }
      }
      return context.resolveRequest(context, moduleName, platform)
    },
  },
}

module.exports = mergeConfig(defaults, config)
