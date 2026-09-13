module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    // matrix-js-sdk's entry point uses `export * as ns from '...'`, which the
    // React Native preset does not transform. Without this the bundle fails
    // to build with "Export namespace should be first transformed by
    // @babel/plugin-transform-export-namespace-from".
    '@babel/plugin-transform-export-namespace-from',
    // THE LAUNCH PROBE'S SWITCH, AND IT WAS NOT ACTUALLY A SWITCH.
    //
    // `App.tsx` reads `process.env.MESSAGR_SEND_PROBE` and the workflow sets
    // it on the build, on the stated reasoning that "`process.env` is
    // inlined at build time". It is not: React Native's preset inlines
    // `NODE_ENV` and nothing else, and Hermes has no `process.env` to read
    // at runtime -- so the expression was `undefined === '1'` on every
    // device, for ever, and the end-to-end suite lost the one test that
    // proves this application can encrypt a message and read it back.
    //
    // Named explicitly rather than left to inline everything: a plugin that
    // baked the whole environment into a bundle would put whatever the
    // machine happened to be exporting into a file that ships.
    //
    // `MESSAGR_WHOLE_LOG` is the second name, and the same kind of switch.
    // A release bundle writes the trace and nothing else (`log.ts` says
    // which events), because that is the bundle that leaves for a store. A
    // bundle somebody is going to read on a cable says so here: the probe
    // build the device bench runs, or `MESSAGR_WHOLE_LOG=1`, which
    // `scripts/pixel.sh` sets.
    //
    // METRO'S TRANSFORM CACHE DID NOT KNOW ABOUT THE ENVIRONMENT. A bundle
    // built after an end-to-end build, on the same machine, was served the
    // cached transform and shipped the probe -- measured here: the same two
    // commands produced byte-identical bundles until `--reset-cache` was
    // passed, after which one compiled to `!0` and the other to `!1`. With
    // the whole log behind a flag, the same accident would ship every
    // identifier the trace leaves out, so `metro.config.js` now puts both
    // names in the cache key.
    [
      'transform-inline-environment-variables',
      { include: ['MESSAGR_SEND_PROBE', 'MESSAGR_WHOLE_LOG'] },
    ],
  ],
}
