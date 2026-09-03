const path = require('path')
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config')

/**
 * Yarn hoists this app's dependencies to the workspace root's node_modules,
 * not to this package's own. Metro's default configuration crawls only the
 * project root, so without the two additions below it fails to resolve
 * packages that are present on disk. This is the documented Metro monorepo
 * configuration.
 *
 * https://reactnative.dev/docs/metro#adding-support-for-monorepos
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, '../..')

const config = {
  watchFolders: [workspaceRoot],
  resolver: {
    nodeModulesPaths: [
      path.resolve(projectRoot, 'node_modules'),
      path.resolve(workspaceRoot, 'node_modules'),
    ],
  },
}

module.exports = mergeConfig(getDefaultConfig(projectRoot), config)
