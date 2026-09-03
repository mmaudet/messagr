module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    // matrix-js-sdk's entry point uses `export * as ns from '...'`, which the
    // React Native preset does not transform. Without this the bundle fails
    // to build with "Export namespace should be first transformed by
    // @babel/plugin-transform-export-namespace-from".
    '@babel/plugin-transform-export-namespace-from',

    // Bakes the four MESSAGR_SESSION_* values into the bundle at build time,
    // read from the environment the bundler itself runs in. There is no
    // product screen yet to type a session into, so this is how a
    // provisioned account's credentials reach a build without ever being
    // committed. Restricted to `include`: an unlisted `process.env.X` stays a
    // real runtime lookup, which is what the rest of this codebase's
    // `process.env` reads (none, today) would need if any existed.
    [
      'transform-inline-environment-variables',
      {
        include: [
          'MESSAGR_SESSION_HOMESERVER',
          'MESSAGR_SESSION_USER_ID',
          'MESSAGR_SESSION_DEVICE_ID',
          'MESSAGR_SESSION_ACCESS_TOKEN',
        ],
      },
    ],
  ],
}
