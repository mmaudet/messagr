module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    // matrix-js-sdk's entry point uses `export * as ns from '...'`, which the
    // React Native preset does not transform. Without this the bundle fails
    // to build with "Export namespace should be first transformed by
    // @babel/plugin-transform-export-namespace-from".
    '@babel/plugin-transform-export-namespace-from',
  ],
}
