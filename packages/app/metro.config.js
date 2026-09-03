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

const config = {
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

module.exports = mergeConfig(getDefaultConfig(projectRoot), config)
